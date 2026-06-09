# Changelog

All notable changes to Instatic will be documented here.

This project is pre-1.0. Breaking changes may appear in minor or patch releases until a stable release line exists.

## Unreleased

## 0.0.2 - 2026-06-09

- Added public repository community files and contribution workflow docs.
- Tightened forwarded-origin handling so `X-Forwarded-Proto` and `X-Forwarded-Host` are trusted only from configured proxy peers.
- Added Render deployment blueprints and refreshed public deployment docs.
- Improved static site import fidelity, including imported runtime behavior and CSS cascade isolation.
- Added editable HTML attributes and path-derived Site Explorer organization.
- Hardened plugin media handling, public forms, AI credential storage, and MFA secret encryption.

## 0.0.1 - 2026-06-08

- First public preview release.
- Self-hosted Bun CMS server with SQLite and Postgres support.
- React admin UI with visual site editor, content/data/media workspaces, publishing pipeline, and plugin runtime.
- Docker image, Compose files, release bundle, and Railway/Render/VPS deployment docs.
