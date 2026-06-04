/**
 * Disposable local server for automated browser E2E tests.
 *
 * This wrapper owns only the `.tmp/e2e-*` data used by Playwright. It resets
 * that data, then delegates to the normal `bun run dev` stack so E2E exercises
 * the same CMS + Vite path a developer uses locally.
 */
import { mkdir, rm } from 'node:fs/promises'

const DATABASE_PATH = './.tmp/e2e-agent.db'
const UPLOADS_DIR = './.tmp/e2e-uploads'
const CMS_PORT = process.env.E2E_CMS_PORT ?? '3002'
const VITE_PORT = process.env.E2E_VITE_PORT ?? '5174'

await mkdir('./.tmp', { recursive: true })
await rm(DATABASE_PATH, { force: true })
await rm(`${DATABASE_PATH}-shm`, { force: true })
await rm(`${DATABASE_PATH}-wal`, { force: true })
await rm(UPLOADS_DIR, { force: true, recursive: true })

const child = Bun.spawn(['bun', 'run', 'dev'], {
  env: {
    ...process.env,
    DATABASE_URL: `sqlite:${DATABASE_PATH}`,
    UPLOADS_DIR,
    PORT: CMS_PORT,
    VITE_PORT,
  },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})

let shuttingDown = false

function forwardSignal(signal: NodeJS.Signals): void {
  shuttingDown = true
  if (child.exitCode === null) child.kill(signal)
}

process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))

const exitCode = await child.exited
process.exit(shuttingDown ? 0 : exitCode)
