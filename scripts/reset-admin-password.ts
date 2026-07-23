#!/usr/bin/env bun
/**
 * One-shot: reset the admin password on a running Instatic instance.
 *
 * Background: a failed password-change attempt in the admin UI can leave the
 * only admin in a lockout window (server/auth/lockout.ts — 5 failed logins →
 * 15 min lock, doubling to a 24 h cap). This script is the escape hatch for
 * the operator when the admin is the *only* admin and the lockout window is
 * too long to wait, or when the change-password attempt set a password the
 * operator no longer knows.
 *
 * The script intentionally runs OUTSIDE the Instatic server, against the
 * Postgres database directly, using the same Bun SQL driver the server uses
 * (server/db/postgres.ts → `new SQL(connectionString)`). The password hash
 * is produced by the same `hashPassword` function the server uses
 * (server/auth/tokens.ts → `Bun.password.hash(..., { algorithm: 'argon2id' })`),
 * so the hash is guaranteed to verify against the live server's
 * `verifyPassword`.
 *
 * Safety properties (deliberately over-engineered for a one-shot):
 *
 *   1. The target email is a required CLI argument. No file-level constant
 *      can point this at a different row, and no commit can leak which
 *      email belongs to which operator.
 *   2. --dry-run is the default. The script prints what it would change and
 *      exits 0 without touching the DB. Pass --apply to actually write.
 *   3. Refuses to run unless DATABASE_URL is set as a shell env var. The
 *      connection string is never read from any file or CLI argument.
 *   4. Refuses to run if the DATABASE_URL host or DB name looks like a
 *      local / dev / test / sqlite fixture. Forces a deliberate override
 *      via --i-know-what-i-am-doing. Railway production Postgres uses
 *      non-standard ports, so we deliberately do NOT flag a :NNNN port
 *      suffix as suspicious.
 *   5. Refuses new passwords under 12 characters (matches the server's
 *      PASSWORD_MIN_LENGTH in server/handlers/cms/users.ts).
 *   6. Prints the row it found (email, locked_until, failed_login_count)
 *      before any UPDATE so the operator can confirm the target is correct.
 *   7. The UPDATE clears failed_login_count and locked_until in the same
 *      statement so the new password takes effect immediately even if a
 *      lockout window was active.
 *
 * Usage (operator runs locally):
 *
 *   # 1. Copy DATABASE_URL from Railway (instatic-postgres service → Variables)
 *   #    into your shell env. NEVER paste it into chat.
 *   export DATABASE_URL='postgresql://...'
 *
 *   # 2. Dry-run (no DB writes):
 *   bun run scripts/reset-admin-password.ts admin@example.com 'NewSecurePassword123!'
 *
 *   # 3. If the dry-run output looks right, apply:
 *   bun run scripts/reset-admin-password.ts admin@example.com 'NewSecurePassword123!' --apply
 *
 * After running with --apply, log in at /admin/ with the new password.
 * Then DELETE this script and commit the deletion. It must not ship in a
 * production deploy — anyone who can run this script against the live DB
 * has full account takeover for any email they pass.
 *
 * Per CLAUDE.md: this script lives in scripts/ alongside the other one-shot
 * tools (generate-secret-key.ts, db-drop.ts). It does NOT touch any file in
 * server/, src/, or migrations.
 */

import { SQL } from 'bun'
import { hashPassword } from '../server/auth/tokens'

const PASSWORD_MIN_LENGTH = 12

/** Patterns that strongly suggest a non-production database. */
const NON_PRODUCTION_HINTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  '/tmp/',
  'dev.db',
  'test.db',
  'local.db',
  'inmemory',
  ':memory:',
  'sqlite:',
]

interface Args {
  email: string
  newPassword: string
  dryRun: boolean
  productionOverride: boolean
}

function parseArgs(argv: readonly string[]): Args {
  const positional = argv.filter((a) => !a.startsWith('--'))
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const email = positional[0]
  const newPassword = positional[1]
  if (!email || !newPassword) {
    throw new Error(
      'Usage: bun run scripts/reset-admin-password.ts <email> <newPassword> [--apply] [--i-know-what-i-am-doing]',
    )
  }
  return {
    email,
    newPassword,
    dryRun: !flags.has('--apply'),
    productionOverride: flags.has('--i-know-what-i-am-doing'),
  }
}

function looksNonProduction(databaseUrl: string): boolean {
  const lower = databaseUrl.toLowerCase()
  return NON_PRODUCTION_HINTS.some((hint) => lower.includes(hint))
}

function log(msg: string): void {
  process.stderr.write(`[reset-admin-password] ${msg}\n`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.newPassword.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `New password is ${args.newPassword.length} characters; minimum is ${PASSWORD_MIN_LENGTH}.`,
    )
  }

  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Set it as a shell env var (e.g. `export DATABASE_URL=...`); never paste connection strings into chat.',
    )
  }

  if (looksNonProduction(databaseUrl) && !args.productionOverride) {
    throw new Error(
      'DATABASE_URL looks like a non-production database (localhost, dev fixture, sqlite, etc.). ' +
        'If this is intentional, pass --i-know-what-i-am-doing to override.',
    )
  }

  const sql = new SQL(databaseUrl)

  try {
    // Step 1: locate the target row. Never assume the email is unique or
    // even present — print whatever we find so the operator can sanity-check.
    const rows = await sql<
      Array<{
        id: string
        email: string
        failed_login_count: number
        locked_until: string | null
        status: string
      }>
    >`SELECT id, email, failed_login_count, locked_until, status
        FROM users
        WHERE email = ${args.email}
        LIMIT 1`

    if (rows.length === 0) {
      throw new Error(
        `No user found with email ${args.email}. Pass the exact email as the first CLI argument.`,
      )
    }
    const row = rows[0]!
    log(`target row:`)
    log(`  id                 = ${row.id}`)
    log(`  email              = ${row.email}`)
    log(`  status             = ${row.status}`)
    log(`  failed_login_count = ${row.failed_login_count}`)
    log(`  locked_until       = ${row.locked_until ?? '<null>'}`)

    // Step 2: produce the new argon2id hash using the same function the
    // server uses. This guarantees verifyPassword will accept it.
    const newHash = await hashPassword(args.newPassword)
    log(`new password hash  = ${newHash.slice(0, 32)}... (argon2id, ${newHash.length} chars)`)

    if (args.dryRun) {
      log('DRY RUN: no DB writes performed. Re-run with --apply to commit.')
      log('DRY RUN: would run:')
      log(`  UPDATE users`)
      log(`    SET password_hash = <new hash>,`)
      log(`        failed_login_count = 0,`)
      log(`        locked_until = NULL,`)
      log(`        password_updated_at = now(),`)
      log(`        updated_at = now()`)
      log(`    WHERE id = '${row.id}';`)
      return
    }

    // Step 3: write the UPDATE. Single statement, all-or-nothing.
    const result = await sql`
      UPDATE users
      SET password_hash = ${newHash},
          failed_login_count = 0,
          locked_until = NULL,
          password_updated_at = now(),
          updated_at = now()
      WHERE id = ${row.id}
      RETURNING id, email, password_updated_at`

    if (result.length === 0) {
      throw new Error('UPDATE matched zero rows — was the row deleted between SELECT and UPDATE?')
    }
    log(`UPDATE applied: ${result.length} row updated.`)
    log(`  id                  = ${result[0]!.id}`)
    log(`  email               = ${result[0]!.email}`)
    log(`  password_updated_at = ${result[0]!.password_updated_at}`)

    log('')
    log('Done. You can now log in at /admin/ with the new password.')
    log('DELETE THIS SCRIPT after use and commit the deletion. Do not ship it.')
  } finally {
    await sql.close()
  }
}

main().catch((err) => {
  process.stderr.write(`[reset-admin-password] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exit(1)
})