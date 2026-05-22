# Page Builder Docs

The documentation tree for Page Builder CMS. This index tells you what to read, in what order, and where to look for what.

If you're an agent: start at `CLAUDE.md` (repo root) for the rules, then come here for the explanations.
If you're a human contributor: start with [`architecture.md`](architecture.md), then read whichever feature or reference page is closest to what you're changing.

---

## How to read this tree

```text
docs/
├── README.md                   ← this file (start here)
├── CONVENTIONS.md              ← how docs in this repo are written (read before authoring)
│
├── architecture.md             ← system overview (start here for orientation)
├── design.md                   ← visual design system (tokens, surfaces, components)
├── server.md                   ← server-side deep dive
├── editor.md                   ← admin + visual editor deep dive
│
├── features/                   ← "what X is and how it works" (per-feature)
│   ├── plugin-system.md
│   ├── editor-preferences.md
│   ├── media.md
│   └── canvas-iframe-per-frame.md
│
├── reference/                  ← short cookbook pages for primitives + patterns
│   ├── page-tree.md
│   ├── database-dialects.md
│   └── typebox-patterns.md
│
├── deployment/                 ← operator docs (running the thing)
├── e2e/                        ← agent-run browser test protocols
└── plans/                      ← in-flight design plans (transient)
```

Three categories, three voices:

- **Top-level docs** are long-lived references that describe the system as it currently is.
- **Feature docs** describe one first-class capability — its architecture, lifecycle, file layout.
- **Reference docs** are short, focused cookbooks for primitives and patterns reused across features.

Plans (`docs/plans/`) describe in-flight work and are deleted when the work ships.

---

## Where to look first

### "I want to understand the system"

1. [`architecture.md`](architecture.md) — the 10-minute orientation. Process layout, layer responsibilities, request lifecycle, publishing pipeline, plugin sandbox, where everything lives.
2. [`design.md`](design.md) — what the editor looks like and why. Tokens, surface system, UI primitives.
3. [`server.md`](server.md) and [`editor.md`](editor.md) — the two deep dives. Pick whichever side you're touching.

### "I want to add a feature"

1. Skim [`architecture.md`](architecture.md) → "Where things live — decision table".
2. Read the feature doc closest to what you're adding (e.g. [`features/plugin-system.md`](features/plugin-system.md) for a plugin SDK extension).
3. Read the relevant reference doc(s) for the primitives you'll touch ([`reference/page-tree.md`](reference/page-tree.md), [`reference/database-dialects.md`](reference/database-dialects.md), [`reference/typebox-patterns.md`](reference/typebox-patterns.md)).
4. Make the change. Verify with `bun test && bun run build && bun run lint`.

### "I want to change the visual design"

1. [`design.md`](design.md) — the principles, tokens, surface systems.
2. `src/styles/globals.css` — the actual tokens.
3. `src/ui/components/` — the actual primitives.
4. If you're adding a new token or surface pattern, update `design.md` in the same change.

### "I want to add a new HTTP endpoint"

1. [`server.md`](server.md) → "Adding a new endpoint".
2. [`reference/typebox-patterns.md`](reference/typebox-patterns.md) for body validation.
3. [`reference/database-dialects.md`](reference/database-dialects.md) if persistence is involved.

### "I want to mutate the page tree"

1. [`reference/page-tree.md`](reference/page-tree.md) — the `NodeTree` primitive and `mutateActiveTree`.
2. [`editor.md`](editor.md) → "Editor store" for how mutations are wired up.

### "I want to write a plugin"

1. [`features/plugin-system.md`](features/plugin-system.md) — the SDK surface, lifecycle, sandbox rules.
2. `examples/plugins/template/` — working example.
3. `src/core/plugin-sdk/capabilities.ts` — permission catalog (source of truth).

### "I want to deploy / operate the CMS"

1. `README.md` (repo root) — install, run, basic commands.
2. [`deployment/README.md`](deployment/README.md) — full deployment matrix (SQLite vs. Postgres, TLS, hosts).
3. [`deployment/backup-restore.md`](deployment/backup-restore.md) — backing up production data.

---

## Doc index

### Top-level

| Doc                         | What it covers                                                          |
|-----------------------------|-------------------------------------------------------------------------|
| [architecture.md](architecture.md) | System overview: process, folders, request lifecycle, data model, validation, decision tables |
| [design.md](design.md)      | Visual design system: principles, tokens, surface systems, UI primitives, forbidden patterns |
| [server.md](server.md)      | Server deep dive: boot sequence, router, handlers, auth, DB adapter, publishing, plugin runtime |
| [editor.md](editor.md)      | Admin + editor deep dive: routing, workspaces, editor store, canvas, sidebars, spotlight |
| [CONVENTIONS.md](CONVENTIONS.md) | How docs in this repo are structured and written (read before authoring) |

### Features

| Doc                                                              | What it covers                                                       |
|------------------------------------------------------------------|----------------------------------------------------------------------|
| [features/plugin-system.md](features/plugin-system.md)           | The plugin system end-to-end: package shape, lifecycle, sandbox, SDK, permissions, CLI |
| [features/editor-preferences.md](features/editor-preferences.md) | Catalog-driven local UI preferences for the editor                   |
| [features/media.md](features/media.md)                           | The Media workspace: folders, assets, upload pipeline, storage adapters |
| [features/canvas-iframe-per-frame.md](features/canvas-iframe-per-frame.md) | Per-breakpoint iframe rendering in the visual editor canvas |

### Reference

| Doc                                                          | What it answers                                                  |
|--------------------------------------------------------------|------------------------------------------------------------------|
| [reference/page-tree.md](reference/page-tree.md)             | The `NodeTree<TNode>` primitive — mutations, store routing, cookbook |
| [reference/database-dialects.md](reference/database-dialects.md) | Postgres vs. SQLite — three rules, adapter behaviors, cookbook  |
| [reference/typebox-patterns.md](reference/typebox-patterns.md) | Validating every untyped boundary with TypeBox                  |

### Operations

| Folder                              | Contents                                                          |
|-------------------------------------|-------------------------------------------------------------------|
| [deployment/](deployment/)          | Production install, Docker compose matrix, TLS, backup, releases  |
| [e2e/](e2e/)                        | Agent-run browser E2E protocols and run logs                      |
| [plans/](plans/)                    | In-flight design plans (transient — delete when shipped)          |

---

## Conventions in one paragraph

Every doc has the shape: **one-line scope statement → TL;DR → body sections → Related**. Every claim about code anchors to a real file path. Every invariant links to the gate test (in `src/__tests__/architecture/`) that enforces it. No history, no aspiration, no marketing copy — describe what the system is, not what it could be or what it used to be. If a doc is over ~600 lines, it's doing too much; split it. The full rules are in [CONVENTIONS.md](CONVENTIONS.md).

---

## Source-of-truth pointers

Quick map from "where do I look for X?" to the canonical file:

| Concept                          | Source of truth                                          |
|----------------------------------|----------------------------------------------------------|
| Agent rules and constraints      | `CLAUDE.md` (repo root)                                  |
| Design tokens                    | `src/styles/globals.css`                                 |
| UI primitives                    | `src/ui/components/`                                     |
| Page tree shape                  | `src/core/page-tree/treeSchema.ts`                       |
| Editor store                     | `src/admin/pages/site/store/`                            |
| Server router                    | `server/router.ts`                                       |
| CMS API handlers                 | `server/handlers/cms/`                                   |
| Repositories                     | `server/repositories/`                                   |
| DB adapter interface             | `server/db/client.ts`                                    |
| DB adapters                      | `server/db/postgres.ts`, `server/db/sqlite.ts`            |
| Migrations                       | `server/db/migrations-pg.ts`, `server/db/migrations-sqlite.ts` |
| Plugin SDK                       | `src/core/plugin-sdk/`                                   |
| Plugin permission catalog        | `src/core/plugin-sdk/capabilities.ts`                    |
| Plugin manifest parser           | `src/core/plugins/manifest.ts`                           |
| Plugin sandbox host              | `server/plugins/quickjsHost.ts`, `server/plugins/modulePackVm.ts` |
| Publisher                        | `src/core/publisher/`                                    |
| TypeBox helpers                  | `src/core/utils/typeboxHelpers.ts`                       |
| Architecture gate tests          | `src/__tests__/architecture/*.test.ts`                   |
