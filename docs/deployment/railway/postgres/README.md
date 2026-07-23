# Railway — Postgres template (fork build)

One-click Railway template for Instatic, built from the
[`0xtsotsi/Instatic`](https://github.com/0xtsotsi/Instatic) fork at branch
`main`. Provisions a managed Postgres service plus the Instatic web service,
mounts a persistent volume at `/app/storage` for uploads, and configures the
required runtime env vars per `docs/deployment/railway.md`.

> **Why build from source instead of pinning a published image?** The fork
> publishes no GHCR package, and upstream `ghcr.io/corebunch/instatic:*` does
> not contain fork commits (for example the MCP hardening on `main`). Building
> from the fork's `Dockerfile` guarantees the deployed code matches the fork
> HEAD. Pin `INSTATIC_BRANCH` to a semver tag (e.g. `v0.0.11`) when you want
> reproducible upgrades instead of tracking `main`.

## One-click deploy

Replace `<account>` and push to your own template repo, then point a
"Deploy to Railway" button at it. Railway's button URL form is:

```text
https://railway.com/new?template=https://github.com/<account>/instatic-railway-postgres
```

Use the same pattern as Render's template repositories described in
`docs/deployment/render.md` → "Template Repositories".

## What the template provisions

| Service          | Source                            | Persistent data                |
|------------------|-----------------------------------|--------------------------------|
| `instatic`       | Fork GitHub repo, Dockerfile build | `/app/storage` (uploads)       |
| `instatic-postgres` | Railway Postgres template       | Postgres service volume        |

App env vars set by the template:

```txt
PORT=8080
DATABASE_URL=${{ instatic-postgres.DATABASE_URL }}
UPLOADS_DIR=/app/storage/uploads
STATIC_DIR=/app/dist
INSTATIC_SECRET_KEY=${{secret(43, "abcdef...+/")}}=   (generated at deploy time)
PUBLIC_ORIGIN=https://${{RAILWAY_PUBLIC_DOMAIN}}
RAILWAY_RUN_UID=0
```

Healthcheck path is `/health`, target port is `8080`.

## Programmatic deploy (GraphQL API)

`scripts/deploy-railway.ts` provisions the same stack through the Railway
GraphQL API. It uses the same service / volume layout as this template and
reads the image source from the same fork.

```sh
export RAILWAY_API_TOKEN=...           # https://railway.com/account/tokens
bun run deploy:railway --project "Client CMS"
```

See `scripts/deploy-railway.ts` for flags.

## Backups

- **Postgres**: use Railway's managed backups / PITR on the `instatic-postgres`
  service, or add a sidecar `pg_dump` job for off-platform archives.
- **Uploads**: snapshot the `instatic-storage` Railway volume. It contains
  uploaded media, fonts, plugin packages, and published artefacts under
  `uploads/`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Public URL shows service unavailable | `PORT` and the target port must both be `8080`. |
| Deploy healthcheck fails | Healthcheck path must be `/health`; the app must listen on `PORT`. |
| `EACCES: permission denied, mkdir '/app/storage/...'` in app logs | `RAILWAY_RUN_UID=0` must be set on the app service. |
| First-run setup or login returns `Forbidden: invalid origin` | Confirm `PUBLIC_ORIGIN` matches the URL you opened. Auto-detected `https://${{RAILWAY_PUBLIC_DOMAIN}}` covers one-click deploys; append a custom domain as a second comma-separated entry. |
| Adding AI credentials or enabling TOTP MFA returns 500 | `INSTATIC_SECRET_KEY` must exist and be stable across redeploys. |
| Deploy pulls upstream `corebunch/instatic` instead of the fork | The service is connected to the wrong source. Change the service source to `https://github.com/0xtsotsi/Instatic` with `Builder: Dockerfile`. |