# User E2E Testing

This folder defines the agent-run browser testing workflow for Instatic.

- `protocol.md` explains how an agent should run user-facing E2E audits.
- `feature-matrix.md` lists scenario rows by product area.
- `capabilities.md` expands the capability/access-control E2E rows.
- `run-log-template.md` is copied into `runs/` for each audit.
- `runs/` stores completed run logs.

## Common Requests

Use these prompts with Codex:

- "Run the Core Owner Lifecycle E2E protocol."
- "Run rows MEDIA-001 through MEDIA-003."
- "Run a friction audit of the visual builder."
- "Run the capability E2E scenarios."
- "Retest E2E-20260514-01 from the last run."
- "Promote PUB-001 into automated smoke coverage."

The project-local `instatic-user-e2e` skill should load for those requests and keep the agent focused on browser-observed user behavior.

## Automated Playwright E2E

The scripted regression suite lives outside this folder in `tests/e2e/`.
Automated E2E files use the `*.e2e.ts` suffix so `bun test` does not load
Playwright specs as unit tests.
It complements the agent-run audits above; it does not replace them. Use
Playwright for stable, critical flows where the expected result is
unambiguous, and keep exploratory UX, accessibility, and visual-friction work
in the agent-run protocol.

Run the automated suite with:

```sh
bun run test:e2e:install
bun run test:e2e
```

The Playwright config starts a disposable local stack by default:

- Admin UI: `http://127.0.0.1:5174`
- CMS/public site: `http://127.0.0.1:3002`
- Database: `.tmp/e2e-agent.db`
- Uploads: `.tmp/e2e-uploads`

`scripts/e2e-dev.ts` resets only those `.tmp/e2e-*` paths, then delegates to
`bun run dev` so the browser exercises the same Vite + Bun server path used in
local development. The Vite dev proxy follows the configured CMS `PORT`, which
keeps the Playwright admin UI pointed at the disposable CMS instead of any
regular dev server running on port 3001.

For debugging against a server you started yourself, set
`E2E_REUSE_SERVER=1` and override `E2E_ADMIN_BASE_URL` /
`E2E_PUBLIC_BASE_URL` as needed. Do not use reuse mode for CI or for
regression runs that need a clean database.

The first demonstration spec is `tests/e2e/core-owner-lifecycle.e2e.ts`. It
covers the Core Owner Lifecycle rows that are stable enough for automation:
setup, login/logout, open the Site editor, edit homepage text, save/reload,
step-up-gated publish, visitor-facing public output, and draft/public
isolation after a later unpublished edit.
