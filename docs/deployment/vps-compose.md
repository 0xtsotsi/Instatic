# VPS Deployment With Docker Compose (Postgres)

This guide covers the Postgres self-host path: CMS app + Postgres + uploaded media on one server. It's the right choice when you have a multi-author editorial team, need horizontal scale-out, or already operate Postgres.

**For most users** (single site, single-author or small team) the simpler default is SQLite — see [sqlite-install.md](sqlite-install.md). SQLite mode runs in one container with no Postgres process, no `.env` file, and no password to manage.

## 1. Prepare The Server

Install Docker Engine and Docker Compose on the VPS. Point your domain to the server if you plan to put a reverse proxy in front of the app.

## 2. Download The Production Files

Create an install directory:

```sh
mkdir -p instatic
cd instatic
```

Download the production Compose and environment templates from the release source:

```sh
curl -fsSLO https://raw.githubusercontent.com/corebunch/instatic/main/compose.prod.yml
curl -fsSLO https://raw.githubusercontent.com/corebunch/instatic/main/.env.production.example
```

Before the public image exists, use the local repository files directly or build from source:

```sh
cp compose.prod.yml /path/on/server/compose.prod.yml
cp .env.production.example /path/on/server/.env.production.example
```

## 3. Create Production Environment

> ⚠️ **Postgres mode requires `POSTGRES_PASSWORD`.** `compose.prod.yml` ships a placeholder default (`CHANGEME_set_POSTGRES_PASSWORD_in_env`) so the file loads in SQLite mode without an `.env`, but a Postgres deployment that does not override this default is insecure. Always set a real password before running `docker compose up -d` against Postgres.

```sh
cp .env.production.example .env
```

Edit `.env` and replace:

```txt
INSTATIC_IMAGE=ghcr.io/corebunch/instatic:latest
POSTGRES_PASSWORD=replace-with-a-long-random-hex-password
```

Generate a safe password with:

```sh
openssl rand -hex 24
```

## 4. Start The Stack

```sh
docker compose -f compose.prod.yml up -d
```

Check status:

```sh
docker compose -f compose.prod.yml ps
curl http://localhost:3001/health
```

Open:

```txt
http://server-ip:3001/admin
```

Create the first admin account in the browser.

## 5. View Logs

```sh
docker compose -f compose.prod.yml logs -f app
docker compose -f compose.prod.yml logs -f postgres
```

## 6. Update

Pull the latest published CMS image and recreate the app container:

```sh
docker compose -f compose.prod.yml pull app
docker compose -f compose.prod.yml up -d
```

Postgres and upload volumes stay attached.

## Build From Source Instead

Most users should pull the published image. Until the image exists, or when developing locally, build from a source checkout with:

```sh
docker compose -f compose.prod.yml -f compose.build.yml up -d --build
```

## Data Safety

`docker compose -f compose.prod.yml down` stops containers and keeps named volumes.

`docker compose -f compose.prod.yml down -v` deletes the Postgres database and uploaded media volumes. Use it only when you intentionally want to wipe the CMS.
