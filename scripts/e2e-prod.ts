/**
 * Disposable PRODUCTION-mode server for automated browser E2E tests.
 *
 * Unlike `e2e-dev.ts` (Vite dev serving the admin SPA + a separate CMS API
 * origin), this wrapper runs the CMS the way a real deploy does: the built
 * `dist/` SPA is served by the Bun server itself, admin and public share ONE
 * origin, and there is no Vite. This is what CI should exercise — it tests the
 * real `serveAdminApp` HTML pipeline and, critically, avoids Vite's on-demand
 * compilation of the authenticated admin shell, which in dev mode costs ~20s on
 * first load (enough to blow past `expectLoggedIn` and fail the whole run).
 *
 * The build is expected to already exist (`bun run build`). Set `E2E_BUILD=1`
 * to build here first — CI typically builds once as a separate step and reuses
 * `dist/` across shards, so building is opt-in.
 *
 * Owns only the `.tmp/e2e-*` data Playwright uses; resets it on every run.
 */
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { bunCommand, bunRunCommand } from './lib/bunCommand'

const DATABASE_PATH = './.tmp/e2e-agent.db'
const UPLOADS_DIR = './.tmp/e2e-uploads'
const STATIC_DIR = './dist'
// Single origin: admin (`/admin`) and public (`/`) are served by one server.
const CMS_PORT = process.env.E2E_CMS_PORT ?? '3002'

if (!existsSync(STATIC_DIR) || process.env.E2E_BUILD === '1') {
  if (!existsSync(STATIC_DIR)) {
    console.error('[e2e-prod] no dist/ found — building once (tsc -b && vite build)…')
  }
  const build = Bun.spawnSync(bunRunCommand('build'), { stdout: 'inherit', stderr: 'inherit' })
  if (build.exitCode !== 0) {
    console.error(`[e2e-prod] build failed (exit ${build.exitCode}).`)
    process.exit(build.exitCode ?? 1)
  }
}

await mkdir('./.tmp', { recursive: true })
await rm(DATABASE_PATH, { force: true })
await rm(`${DATABASE_PATH}-shm`, { force: true })
await rm(`${DATABASE_PATH}-wal`, { force: true })
await rm(UPLOADS_DIR, { force: true, recursive: true })

const child = Bun.spawn(bunCommand('server/index.ts'), {
  env: {
    ...process.env,
    PORT: CMS_PORT,
    DATABASE_URL: `sqlite:${DATABASE_PATH}`,
    UPLOADS_DIR,
    STATIC_DIR,
  },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})

let shuttingDown = false
function stop(signal: NodeJS.Signals): void {
  shuttingDown = true
  if (child.exitCode === null) child.kill(signal)
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

const code = await child.exited
if (!shuttingDown) process.exit(code ?? 1)
