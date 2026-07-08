/**
 * Shared constants for the automated Playwright E2E suite.
 *
 * The Playwright `webServer` (`scripts/e2e-dev.ts`) resets the disposable
 * `.tmp/e2e-*` database once per run and then serves a single shared stack:
 * one admin origin, one public origin, one SQLite database. Every spec runs
 * serially against that shared state (`workers: 1`), so these constants are the
 * single source of truth for the owner account and origins.
 */

/** First-run owner created by the `setup` project. Reused by every spec. */
export const OWNER = {
  email: 'owner.e2e@example.com',
  password: 'qwerty123456',
  siteName: 'Automated E2E Site',
} as const

/**
 * Admin origin — the single source of truth for any spec that opens an EXTRA
 * browser context (a second device, an attacker session) and must navigate it to
 * the admin app by absolute URL. Playwright's project `baseURL` only applies to
 * the default context, so manually-created contexts need this. Resolved by
 * `playwright.config.ts` (the Vite host in dev, the single Bun origin in prod)
 * and written into the environment there — never hardcode a port in a spec.
 */
export const ADMIN_BASE_URL =
  process.env.E2E_ADMIN_BASE_URL ?? 'http://127.0.0.1:5174'

/** Public (visitor-facing) origin. Different port → always a fresh context. */
export const PUBLIC_BASE_URL =
  process.env.E2E_PUBLIC_BASE_URL ?? 'http://127.0.0.1:3002'

/**
 * Saved owner authentication state. The `setup` project writes this after
 * first-run setup; specs that opt in start already logged in as the owner.
 */
export const OWNER_STATE_FILE = '.tmp/e2e-owner-state.json'

/**
 * An empty (logged-out) storage state. Specs that **publish** (which triggers a
 * step-up) or **sign out** must opt into this and `login()` fresh, because both
 * actions rotate the session token server-side — reusing the shared owner state
 * would invalidate it for every later spec. Read-only specs keep the fast shared
 * owner state.
 */
export const ANONYMOUS_STATE = { cookies: [], origins: [] }

/**
 * A dedicated "account tester" persona — one member of the team of testers. It
 * exists so that `account.e2e`'s account-GLOBAL destructive flows (sign out
 * everywhere, change password, enable/disable MFA) operate on THIS account
 * instead of the shared owner. Those actions invalidate every session for the
 * account they target; run against the owner they would nuke `OWNER_STATE_FILE`
 * and log out every later spec. Created once by `account-persona.setup.ts`.
 *
 * Given the `Admin` role because account self-management (profile, MFA,
 * password, sessions) is available to any authenticated user — no owner-only
 * privilege is required, so the shared owner stays pristine.
 */
export const ACCOUNT_PERSONA = {
  email: 'account.persona.e2e@example.com',
  password: 'account-persona-pass-12345',
  displayName: 'Account Persona',
  role: 'Admin',
} as const
