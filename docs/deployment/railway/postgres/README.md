# Railway — Postgres template (fork build)

One-click Railway template for Instatic, built from the
[`0xtsotsi/Instatic`](https://github.com/0xtsotsi/Instatic) fork at branch
`main`. Provisions a managed Postgres service plus the Instatic web service,
mounts a persistent volume at `/app/storage` for uploads, and configures the
required runtime env vars per `docs/deployment/railway.md`.

> **Status: starting point, not yet validated against a live Railway project.**
> The template's field shapes (`build.builder`, `volumes[]`, `dependsOn[]`,
> `template: "postgres"`) are derived from Railway's public docs and the
> patterns used by the equivalent Render Blueprint in
> `docs/deployment/render/postgres/render.yaml`, but have **not** been
> confirmed end-to-end against the live `railway.com/new` deploy flow.
> **Validate by clicking through a deploy in the Railway UI before treating
> this as the canonical template.** If any field is rejected, edit
> `template.json` and commit the correction in a follow-up PR.
>

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
PUBLIC_ORIGIN is intentionally NOT set in the template — see 'PUBLIC_ORIGIN' below.
RAILWAY_RUN_UID=0
```

Healthcheck path is `/health`, target port is `8080`.

## PUBLIC_ORIGIN

The template intentionally does **not** set `PUBLIC_ORIGIN` as a service variable. The server's CSRF check (`server/config.ts → resolvePublicOrigins`) auto-detects the public origin from `RAILWAY_PUBLIC_DOMAIN`, which Railway always injects as a real env var at deploy time. The auto-detected value is `https://<RAILWAY_PUBLIC_DOMAIN>` and covers one-click deploys with zero configuration.

If you add a custom domain, set `PUBLIC_ORIGIN` to a comma-separated list:

```txt
PUBLIC_ORIGIN=https://instatic-production-ac53.up.railway.app,https://www.example.com
```

Both entries must be valid URLs (scheme + host, no trailing slash, `https://` not `http://`). The first entry becomes the canonical origin used by `expectedOrigin()`; the full set is matched against by `originAllowed()`.

**Do not** set `PUBLIC_ORIGIN=https://${{RAILWAY_PUBLIC_DOMAIN}}` as a Railway service variable. Railway resolves `${{...}}` only in template `reference` fields, not in regular service env var values. The literal `${{RAILWAY_PUBLIC_DOMAIN}}` causes the value to be dropped by `normalizeOrigin()`, the server falls back to the `Host` header, and the browser's `Origin` header does not match — producing `Forbidden: invalid origin` on first-run setup.

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
| First-run setup or login returns `Forbidden: invalid origin` | The template does not set `PUBLIC_ORIGIN` on purpose — the server auto-detects it from `RAILWAY_PUBLIC_DOMAIN`. If you set `PUBLIC_ORIGIN` to a literal value, it must match the URL you opened exactly (no trailing slash, `https://` not `http://`). To add a custom domain, see the 'PUBLIC_ORIGIN' section above — do **not** include `${{RAILWAY_PUBLIC_DOMAIN}}` syntax; list the literal Railway domain as the first entry. |
| Adding AI credentials or enabling TOTP MFA returns 500 | `INSTATIC_SECRET_KEY` must exist and be stable across redeploys. |
| Deploy pulls upstream `corebunch/instatic` instead of the fork | The service is connected to the wrong source. Change the service source to `https://github.com/0xtsotsi/Instatic` with `Builder: Dockerfile`. |