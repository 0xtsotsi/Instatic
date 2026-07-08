import { defineConfig } from '@playwright/test'
import { OWNER_STATE_FILE } from './tests/e2e/helpers/constants'

/**
 * Two run modes, selected by `E2E_MODE`:
 *
 *  - `dev` (default, fast local iteration): the admin SPA is served by Vite on
 *    5174 and the CMS API/public site by the Bun server on 3002 (`e2e:dev`).
 *    Convenient, but Vite compiles the authenticated admin shell on-demand on
 *    first navigation — ~20s cold — which is enough to blow the `expectLoggedIn`
 *    budget and makes the suite timeout-fragile.
 *
 *  - `prod` (CI): the built `dist/` is served by the Bun server itself, admin
 *    (`/admin`) and public (`/`) share ONE origin, no Vite (`scripts/e2e-prod.ts`).
 *    This is what a real deploy serves, and it removes the on-demand-compile
 *    stall entirely, so the suite is fast and stable enough to gate PRs.
 */
const MODE = process.env.E2E_MODE === 'prod' ? 'prod' : 'dev'
const CMS_PORT = process.env.E2E_CMS_PORT ?? '3002'
const CMS_ORIGIN = `http://127.0.0.1:${CMS_PORT}`

// In prod mode admin + public are one origin; in dev the admin is the Vite host.
// Write the resolved values back into the environment so specs and helpers read
// ONE source of truth (`tests/e2e/helpers/constants.ts`) instead of re-deriving
// an origin — a spec that hardcodes the dev port breaks the moment it opens an
// extra browser context in prod mode.
const ADMIN_BASE_URL =
  process.env.E2E_ADMIN_BASE_URL ?? (MODE === 'prod' ? CMS_ORIGIN : 'http://127.0.0.1:5174')
process.env.E2E_ADMIN_BASE_URL = ADMIN_BASE_URL
process.env.E2E_PUBLIC_BASE_URL ??= CMS_ORIGIN

// `workers > 1` requires per-worker backend isolation (see the note on the
// `webServer` block); until that lands, both modes default to a single worker
// and scale out across CI runners via `--shard`.
const WORKERS = Number(process.env.E2E_WORKERS ?? 1)

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: '.tmp/playwright-results',
  fullyParallel: false,
  workers: WORKERS,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '.tmp/playwright-report' }],
  ],
  use: {
    baseURL: ADMIN_BASE_URL,
    screenshot: 'only-on-failure',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    video: 'retain-on-failure',
  },
  // The disposable DB is set up once per run, so first-run setup runs in its own
  // `setup` project. `personas` then creates dedicated tester accounts (each a
  // member of the "team of testers"): specs that must run account-GLOBAL
  // destructive flows — sign out everywhere, change password, toggle MFA — do so
  // against a persona instead of the shared owner, so they can't invalidate the
  // owner session every later spec reuses. Every spec depends on both; specs that
  // need a clean/anonymous session opt out with `test.use({ storageState })`.
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts$/,
    },
    {
      name: 'personas',
      testMatch: /\.setup\.ts$/,
      testIgnore: /auth\.setup\.ts$/,
      dependencies: ['setup'],
    },
    {
      name: 'e2e',
      testMatch: '**/*.e2e.ts',
      dependencies: ['setup', 'personas'],
      use: { storageState: OWNER_STATE_FILE },
    },
  ],
  // In prod mode `/` is the (unpublished) public site, which can 404 before the
  // first publish, so readiness is probed against `/admin` (always 200). Dev's
  // Vite host answers `/` directly. `workers > 1` is intentionally NOT wired to
  // spin up isolated backends here yet: the suite shares one owner account, one
  // DB and one server, and publishing rotates the owner's session token — so
  // parallel workers against a single stack would invalidate each other. Scale
  // out across runners with `--shard=i/N` (each shard boots its own fresh stack)
  // until per-worker isolation lands.
  webServer: {
    command: MODE === 'prod' ? 'bun run scripts/e2e-prod.ts' : 'bun run e2e:dev',
    url: MODE === 'prod' ? `${ADMIN_BASE_URL}/admin` : ADMIN_BASE_URL,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
    timeout: MODE === 'prod' ? 180_000 : 120_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 500 },
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
