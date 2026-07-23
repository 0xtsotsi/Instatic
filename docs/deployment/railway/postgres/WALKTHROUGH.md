# Railway — One-click Deploy via UI (fork build)

Step-by-step instructions for deploying the `0xtsotsi/Instatic` fork to
Railway using the merged one-click template. Takes about 10 minutes; no
local tooling required beyond a GitHub account.

> **Pre-flight: validate before treating the template as canonical.**
> `docs/deployment/railway/postgres/README.md` → "Status" banner explains
> why this is a starting point.

---

## 1. Create the template repo

The merged `template.json` lives at
`docs/deployment/railway/postgres/template.json`. Railway reads
`template.json` from the **root** of a public repo, so copy it into a
small standalone repo.

**In the GitHub UI:**

1. Go to <https://github.com/new>.
2. Repository name: `instatic-railway-postgres`.
3. Owner: `0xtsotsi`.
4. Public repo, no README / no .gitignore (you'll add a clean one).
5. Click **Create repository**.

**In your terminal:**

```sh
git clone https://github.com/0xtsotsi/instatic-railway-postgres.git
cd instatic-railway-postgres

# Copy the merged template to the repo root.
gh repo clone 0xtsotsi/Instatic /tmp/instatic -- --depth 1
cp /tmp/instatic/docs/deployment/railway/postgres/template.json ./template.json

# Add a minimal README so the repo isn't empty.
cat > README.md <<'EOF'
# Instatic on Railway (Postgres)

One-click Railway template for the
[0xtsotsi/Instatic](https://github.com/0xtsotsi/Instatic) fork.

Click **Deploy to Railway** below, or import this repo manually at
<https://railway.com/new>.

Source: see the upstream
[`docs/deployment/railway/postgres/README.md`](https://github.com/0xtsotsi/Instatic/blob/main/docs/deployment/railway/postgres/README.md).
EOF

git add template.json README.md
git commit -m "feat: import Instatic Railway Postgres template"
git push -u origin main
```

## 2. Deploy from Railway

**Option A — "Deploy to Railway" button (preferred):**

After the template repo is public, open
<https://railway.com/new?template=https://github.com/0xtsotsi/instatic-railway-postgres>.

**Option B — Manual import:**

1. Open <https://railway.com/new>.
2. Click **Deploy from GitHub repo**.
3. Select `0xtsotsi/instatic-railway-postgres`.
4. Click **Deploy**.

## 3. Configure on first deploy

Railway will prompt for the template variables:

| Variable          | Default                                          | When to change |
|-------------------|--------------------------------------------------|----------------|
| `INSTATIC_REPO`   | `https://github.com/0xtsotsi/Instatic`           | Point at a different fork or `corebunch/instatic` for upstream builds. |
| `INSTATIC_BRANCH` | `main`                                           | Pin to a semver tag like `v0.0.11` for reproducible upgrades. |

Leave them at defaults for a fresh deploy. Click **Deploy**.

## 4. Watch the build

Railway will:

1. Clone the fork at `INSTATIC_BRANCH`.
2. Run `Dockerfile` to build the image (first build ~3 min, cached after).
3. Create a Postgres service via the `postgres` template.
4. Attach a `instatic-storage` volume at `/app/storage` on the app service.
5. Wait for Postgres to be healthy before starting the app.
6. Health-check `/health` on port `8080`.
7. Generate a public `*.up.railway.app` domain.

If any of these steps fail, the most likely causes are:

| Symptom | Fix |
|---|---|
| Build fails: `Cannot find module ...` | Fork `main` is mid-rebase. Set `INSTATIC_BRANCH` to a known-good tag (e.g. `v0.0.11`). |
| Build fails: `Dockerfile not found` | Railway is reading from the wrong repo. Confirm `INSTATIC_REPO` is exactly `https://github.com/0xtsotsi/Instatic` (no `.git`, no SSH scheme). |
| Postgres stays in "waiting" forever | Template `"template": "postgres"` may have been renamed in Railway's template catalogue. In the Railway UI, add a Postgres database manually and reference its `DATABASE_URL` on the app service instead of using the templated Postgres service. |
| App health check fails on first boot | Check the deploy logs for `EACCES: permission denied, mkdir '/app/storage/...'`. If present, `RAILWAY_RUN_UID=0` is missing — confirm the env var is set. |
| First page load: `Forbidden: invalid origin` | `PUBLIC_ORIGIN` must match the URL Railway assigned. Confirm it's set to `https://${{RAILWAY_PUBLIC_DOMAIN}}` and not blanked out. |

## 5. First-run setup

Once the deploy is healthy:

1. Open the Railway-assigned `*.up.railway.app` URL.
2. The Instatic first-run setup screen loads. Create the **admin account**.
3. **Save the admin credentials to your password manager.** This is the only admin; recovery requires `INSTATIC_SECRET_KEY` plus DB access.
4. From the admin UI, create additional member / client accounts via the Users section.

> **Critical: back up `INSTATIC_SECRET_KEY` now.**
> After the first deploy, open the app service's Variables tab, find
> `INSTATIC_SECRET_KEY`, click the eye icon to reveal it, and copy the
> value into your password manager. Without this key, encrypted server
> secrets (AI provider credentials, plugin secret settings, MFA TOTP
> seeds) cannot be decrypted after a redeploy that rotates the secret.

## 6. Add a custom domain (optional)

You opted out of a custom domain for this deploy. To add one later:

1. In Railway, open the app service → **Settings** → **Domains**.
2. Add your custom domain. Railway will give you a CNAME target.
3. At your DNS provider, add the CNAME.
4. In the app service **Variables** tab, edit `PUBLIC_ORIGIN` to include the new domain as a comma-separated second entry, e.g. `https://${{RAILWAY_PUBLIC_DOMAIN}},https://www.example.com`.
5. Redeploy.

## 7. Backups

| Data | How to back up |
|---|---|
| Postgres database | Enable Railway's managed backups / PITR on the `instatic-postgres` service, or add a sidecar `pg_dump` job for off-platform archives. |
| Uploads + published artefacts (`/app/storage/uploads`, `/app/storage/published`) | Snapshot the `instatic-storage` Railway volume. Trigger a snapshot before any major upgrade. |
| Admin users + reversible secrets (AI credentials, MFA seeds) | Backed up via Postgres dump above, **but only decryptable if** you have a copy of `INSTATIC_SECRET_KEY`. Lose both = lose encrypted secrets. |

## 8. Updates

**Option 1 — automatic via fork `main`** (recommended while iterating):

Set `INSTATIC_BRANCH` back to `main`. Railway will redeploy whenever the
fork's `main` branch gets new commits. Use only when you trust `main` to
not break things.

**Option 2 — pin to a semver tag** (recommended for stable client sites):

```sh
# In your terminal — tag the current fork HEAD when you're ready to ship:
git tag v0.0.12-<client-suffix>
git push origin v0.0.12-<client-suffix>
```

Then in the Railway template variables, set `INSTATIC_BRANCH` to that
tag. To roll forward, push a new tag and update the variable.

## 9. After-deploy checklist

- [ ] First admin created and credentials saved.
- [ ] `INSTATIC_SECRET_KEY` copied into your password manager.
- [ ] At least one member/client account created for the client to log in.
- [ ] Postgres backup schedule enabled.
- [ ] `instatic-storage` volume snapshot taken.
- [ ] Custom domain added (if applicable) + `PUBLIC_ORIGIN` updated.
- [ ] CI on `0xtsotsi/Instatic` is green and the merged PR is on `main`.

---

**You did not need a `RAILWAY_API_TOKEN` for this flow.** If a future
session wants to drive the same deploy programmatically (CI, multiple
client instances, scripted teardown), generate a token at
<https://railway.com/account/tokens> and set it as a **shell env var in
your terminal, never paste it into chat**.