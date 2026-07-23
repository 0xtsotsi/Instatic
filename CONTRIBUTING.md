# Contributing To Instatic

Thanks for helping improve Instatic. The project is pre-1.0, self-hosted, and intentionally moving quickly, so contributions should favor clean architecture over compatibility shims.

## Start Here

1. Read [README.md](README.md) for product context and local setup.
2. Read [docs/README.md](docs/README.md) for the documentation map.
3. Read [docs/architecture.md](docs/architecture.md) before changing cross-cutting code.
4. For deployment changes, read [docs/deployment/README.md](docs/deployment/README.md).

## Local Development

Use Bun for all project commands:

```sh
bun install
bun run dev
```

The default local database is SQLite at `.tmp/dev.db`. Postgres mode is selected by setting `DATABASE_URL`.

Useful checks:

```sh
bun run build
bun test
bun run lint
```

For Docker changes:

```sh
docker build -t instatic:local .
docker compose -f compose.prod.yml -f compose.sqlite.yml -f compose.build.yml config
```

## Pull Requests

- Keep PRs focused on one problem.
- Include tests for behavior changes.
- Update docs in the same PR when behavior, configuration, public APIs, or deployment instructions change.
- Use TypeBox at untyped boundaries.
- Use existing UI primitives in `src/ui/components/` for admin UI controls.
- Do not add provider SDKs, `zod`, Tailwind, `react-router-dom`, or third-party icon packages.

## Project Conventions

Instatic is pre-release. Do not add deprecation shims or backwards-compatibility wrappers for old internal APIs. If a shape is wrong, update the source of truth and all callers in the same change.

Important rules live in:

- [docs/reference/typebox-patterns.md](docs/reference/typebox-patterns.md)
- [docs/reference/database-dialects.md](docs/reference/database-dialects.md)
- [docs/reference/page-tree.md](docs/reference/page-tree.md)
- [docs/reference/react-compiler.md](docs/reference/react-compiler.md)
- [docs/reference/ui-primitives.md](docs/reference/ui-primitives.md)

## Reporting Security Issues

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## Repository Topology (Fork + Upstream)

This checkout is a **fork** configured as the agent's working copy. Two remotes exist:

| Remote | URL | Role | Push allowed? |
|---|---|---|---|
| `origin` | `https://github.com/0xtsotsi/Instatic.git` | Personal fork — default push target | yes |
| `upstream` | `https://github.com/corebunch/instatic.git` | Release repository (`corebunch/instatic`) | **no** |

### Push destination rules

- **Always push to `origin`.** Plain `git push` goes there. Every local branch has `branch.<name>.pushRemote = origin`, so even with a different fetch remote, push defaults route to the fork.
- **`upstream` is read-only.** Its push URL is set to the literal marker `no_push`, so `git push upstream ...` fails outright.
- **Pre-push hook blocks mistakes.** `.git/hooks/pre-push` refuses any push whose remote name is `upstream` or whose URL matches `github.com/[Cc]ore[Bb]unch/[Ii]nstatic`. Bypass only with `git push --no-verify` when intentionally publishing to the release repo.
- **CI guard exists.** `.github/workflows/guard-upstream-fork.yml` fails any push to `main` that arrives from the upstream release repo (so misrouted history cannot land on `main`). Add this job to the branch-protection required status checks to make it a hard block.

### Syncing with upstream

```sh
git fetch upstream             # pull new releases
git rebase upstream/main       # replay your feature branches onto the latest release
```

### Promoting a fork branch to the release repo

If a feature should land in `CoreBunch/Instatic`:

1. Open a PR on GitHub from the fork branch to `CoreBunch/Instatic:main`.
2. Do **not** push the branch to the upstream remote from your local clone — the hook will refuse it on purpose.

### Verifying the setup

```sh
git remote -v                              # origin = fork, upstream.push = no_push
git branch -vv                             # every branch pushRemote should be 'origin'
git push --dry-run                         # should show fork URL, never upstream
./.git/hooks/pre-push <<<"dummy"           # smoke-test the hook script
```

If `git remote -v` ever shows the upstream's URL on the push line, **stop** and check the config — pushes can leak to the release repo.
