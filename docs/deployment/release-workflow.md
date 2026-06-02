# Release And Image Publishing Workflow

The public source repository is `github.com/corebunch/instatic`, and production images publish to GitHub Container Registry as:

```txt
ghcr.io/corebunch/instatic:latest
ghcr.io/corebunch/instatic:1.0.0
```

## Release Flow

1. Keep `main` releasable.
2. Merge feature work into `main`.
3. Create a version tag:

```sh
git tag v1.0.0
git push origin v1.0.0
```

4. GitHub Actions builds the Docker image from `Dockerfile`.
5. GitHub Actions pushes:

```txt
ghcr.io/corebunch/instatic:1.0.0
ghcr.io/corebunch/instatic:latest
```

6. GitHub release notes link to:

- `compose.prod.yml`
- `.env.production.example`
- deployment docs

7. Existing VPS installs update with:

```sh
docker compose -f compose.prod.yml pull app
docker compose -f compose.prod.yml up -d
```

## User Install Flow After Public Release

Users should not clone the repository for normal VPS installs. They download the Compose and env templates from GitHub and pull the published image:

```sh
mkdir -p instatic
cd instatic
curl -fsSLO https://raw.githubusercontent.com/corebunch/instatic/main/compose.prod.yml
curl -fsSLO https://raw.githubusercontent.com/corebunch/instatic/main/.env.production.example
cp .env.production.example .env
```

Then they edit `.env`:

```txt
INSTATIC_IMAGE=ghcr.io/corebunch/instatic:latest
POSTGRES_PASSWORD=<random hex password>
```

And start:

```sh
docker compose -f compose.prod.yml up -d
```

## Before Public Release

Until the GHCR image exists, local testing uses the source-build override:

```sh
docker compose -f compose.prod.yml -f compose.build.yml up -d --build
```

Or build and tag an image manually:

```sh
docker build -t ghcr.io/corebunch/instatic:dev .
INSTATIC_IMAGE=ghcr.io/corebunch/instatic:dev docker compose -f compose.prod.yml up -d
```

## GitHub Actions Shape

The release workflow should:

- run tests and build checks.
- log in to GitHub Container Registry with `GITHUB_TOKEN`.
- build `Dockerfile`.
- push a semver tag for `v*` tags.
- push `latest` for releases from `main`.

The exact workflow file should be added when package permissions and image visibility are ready to be tested against the `corebunch` GitHub organization.
