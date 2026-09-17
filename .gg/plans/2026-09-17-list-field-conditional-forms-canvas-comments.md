# Plan: List Field + Conditional Forms + Canvas Comments

**Status:** Draft — awaiting user approval.
**Date:** 2026-09-17
**Author:** GG Coder (in agent-loop with user via Plan mode)

---

## Goal

Land three feature increments in Instatic that close the gap to peer CMSes (Framer / Sanity / Payload / Webflow) and make non-developer authoring of real sites possible end-to-end:

1. **List Field with Repeat binding** (#4) — store arrays of sub-rows on a `DataTable` row, render them as iterated children on the canvas.
2. **Conditional & multistep forms** (#6) — `visibleIf` expressions on form controls + multistep form runtime.
3. **Visitor Comments → Canvas Annotations** (#7) — visitor comments on a published page become pinned annotations on the editor canvas, anchored to the exact `nodeId`.

All three land on existing Instatic primitives:

- `DataField` discriminated union (`src/core/data/schemas.ts`) — extended with `listField`.
- `FormControlBindingSchema` (`src/core/forms/schemas.ts`) — extended with `visibleIf` + `stepId`.
- `Page` / `PageNode` (`src/core/page-tree/pageNode.ts`) — `nodeId` already uniquely anchors every node; reused for comments.
- `FormModule` (`src/modules/base/forms/index.ts`) + `FORM_RUNTIME_JS` — extended, no replacement.
- `LoopModule` (`src/modules/base/loop/index.ts`) — reused as the render target for `#4` via the existing `data.rows` source family.

**Vault references** (verified in `~/.steroids` under tag `instatic`):

- Maily.to `packages/core/src/blocks/layout.tsx:39` — Repeat block reference.
- SurveyJS `packages/survey-core/src/conditions/conditionRunner.ts:5` — `ConditionRunner extends ExpressionRunnerBase`, `runValues(values, properties)`, `getVariables()`.
- BlockNote `examples/07-collaboration/02-liveblocks/src/Threads.tsx` — anchored + floating threads UX.

---

## Non-goals (explicitly out of scope)

- New visual editor surface area beyond PropertiesPanel + a new Annotations panel tab. No re-architecture of the `NodeTree` reducer.
- Plugin SDK for the new primitives. New primitives are first-party only for v1.
- Visitor authentication. Comment authors are anonymous (email field, hashed for spam-prevention).
- Form builder drag-and-drop. v1 uses the existing form canvas + per-field PropertiesPanel; the v1 form builder surface area is unchanged.

---

## Verification limits

- SurveyJS `ConditionRunner` reference is from the public source — its JS expression syntax is established but not portable as-is. We model a minimal subset (`a && b`, `a || b`, `!a`, comparisons, `in […]`) and **reject** user expressions that use unknown identifiers, with a PropertyPanel validator.
- BlockNote Threads.tsx depends on Liveblocks; we read its UX (anchored overlays + floating threads panel) but do not adopt its transport.
- No vault reference exists for Instatic-style `nodeId`-anchored visitor comments over static output; this is novel work bridged by `PageNode.id` already being globally unique in `page.nodes`.

---

## Architecture

### Shared primitive — `nodeId` is the universal anchor

Every canvas node already has a globally unique `nodeId` (key in `page.nodes`). The three features each use it differently:

| Feature              | Anchors to                                | Storage                               |
| -------------------- | ----------------------------------------- | ------------------------------------- |
| #4 List Field        | `fieldId` on `DataTable`                  | cells_json entry holds `unknown[]`    |
| #6 visibleIf         | `control.fieldId` within a form           | baked into `FormControlBindingSchema` |
| #7 Canvas annotation | `nodeId` on `Page` (and `publishVersion`) | new `node_annotations` table          |

Reusing the existing node-id model means **no new primary key strategy** for v1.

---

## Feature #4 — List Field with Repeat binding

### Schema

**Add to `src/core/data/schemas.ts`:**

```ts
const ListFieldItemFieldSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  required: Type.Optional(Type.Boolean()),
  description: Type.Optional(Type.String()),
  type: Type.Union([
    Type.Literal('text'),
    Type.Literal('longText'),
    Type.Literal('number'),
    Type.Literal('boolean'),
    Type.Literal('url'),
    Type.Literal('email'),
    Type.Literal('select'),
  ]),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String(),
        label: Type.String(),
      }),
    ),
  ),
})

const ListFieldSchema = Type.Object({
  type: Type.Literal('listField'),
  ...FieldCommonProps,
  defaultValue: Type.Optional(Type.Array(Type.Unknown())),
  minItems: Type.Optional(Type.Number()),
  maxItems: Type.Optional(Type.Number()),
  itemFields: Type.Array(ListFieldItemFieldSchema),
})

// append to DataFieldSchema discriminated union
export const DataFieldSchema = Type.Union([
  // ...existing 12 variants...
  ListFieldSchema,
])
```

Cell value shape: `cells_json[fieldId]: Array<Record<itemFieldId, unknown>>`. Use `unknown` not the strict record type so cells stay JSON-friendly across migrations (a known pattern in this codebase).

### Coercion / validation

Add to `src/core/forms/validation.ts::coerceFieldValue`:

```ts
case 'listField': {
  if (!Array.isArray(value)) return { ok: false, code: 'invalid_list', message: 'Must be a list.' }
  const max = field.maxItems ?? 100
  if (value.length > max) return { ok: false, code: 'too_many_items', message: `At most ${max} items.` }
  return { ok: true, value }
}
```

List fields are **never writable from public forms** (they are admin-side sub-row collections). Mark with the existing `'unsupported_field'` error pattern for form attempts (same as `pageTree`).

### Render-side: Reuse `base.loop` with a synthetic source

Add a new loop source at `src/core/loops/sources/listField.ts`:

```ts
export const ListFieldSource: LoopEntitySource = {
  id: 'data.listField',
  label: 'List field',
  description: 'Iterate a listField cell of the current page entry.',
  requestDependent: false,
  filterSchema: {/* entryId?, fieldId? */},
  orderByOptions: [{ id: 'index', label: 'Order' }],
  fields: (ctx) =>
    ctx.listField.itemFields.map((f) => ({
      id: f.id,
      label: f.label,
      format: 'plain',
    })),
  fetch: async (ctx) => {
    /* pull entry cell, return items */
  },
  preview: (ctx) => {
    /* synthesize 3 placeholder items */
  },
}
```

The existing `renderLoop()` publisher interceptor in `server/publish/render.ts` handles rendering with `currentEntry.<listFieldId>[i].<itemFieldId>` bindings — **no publisher changes needed**.

### Admin UI

- Properties panel for a `DataField.type === 'listField'`: nested table of `itemFields[]` (id, label, type, required, options for `select`). Add-row/remove-row.
- The Data grid editor (`src/admin/data/...`) renders a mini-grid of sub-rows for `listField` columns, mirroring SurveyJS's `triggers` UX. Existing editors are schema-driven; add a branch.

### Verification

- Unit: `validateFormSubmission({table, controls, values})` rejects unknown sub-fields in `listField` (already does — recursive coercion is explicit).
- Round-trip: create a `listField`, save, re-load, render via Loop, verify HTML.
- Existing `FormValidationError` tests still pass — no behavior change for non-listField fields.

---

## Feature #6 — Conditional + Multistep forms

### Two sub-features

**6a. `visibleIf` on form controls** — show/hide a control based on other controls' values.

**6b. Multistep forms** — group controls into wizard steps; one step visible at a time; previous/next/submit controls.

### 6a. `visibleIf` engine

**Schema additions** in `src/core/forms/schemas.ts`:

```ts
export const FormControlExpressionSchema = Type.String({ minLength: 1, maxLength: 500 })
// Grammar: identifiers are control names (e.g. "framework").
// Supported: comparison (==, !=, <, <=, >, >=), in [...], &&, ||, !, parens.
// Literals: numbers, strings (single-quoted), true, false, null.

export const FormControlBindingSchema = Type.Object({
  // ...existing fields...
  visibleIf: Type.Optional(FormControlExpressionSchema),
  stepId: Type.Optional(Type.String({ minLength: 1 })),
})
```

**New engine** at `src/core/forms/conditions.ts`:

Mirror SurveyJS `ConditionRunner extends ExpressionRunnerBase` but reduced to the grammar above. Public API:

```ts
export interface ExpressionRunner {
  /** Returns true iff the expression evaluates to truthy for these values. */
  runValues(values: Record<string, unknown>, properties?: Record<string, unknown>): boolean
  /** Variable names referenced by the expression. Used to decide which
   *  control changes invalidate dependent evaluations. */
  getVariables(): string[]
  /** Static validator. Returns the first syntax error or null. */
  validate(): string | null
}

export function compileExpression(source: string): ExpressionRunner
```

**Implementation strategy** (no full parser generator — keep dependency surface flat):

1. Tokenize: identifier, number, string (single-quoted), operator (`==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `!`, `(`, `)`, `,`), bracket (`[`, `]`), `in`.
2. Recursive-descent parser → AST.
3. Evaluator: `Identifier → values[name] ?? properties[name]`; unknown identifier → throw `'unknown identifier: <name>'` at `validate()` time.
4. AST shape is the spec — exhaustive `switch` in evaluator (no eval, no Function ctor).

This matches the codebase's pattern (`safeUrl`, escape helpers) of small, no-dep utility modules.

**Snapshot** — bake `visibleIf` into `PublishedFormSnapshot.controls[]`. The publisher already walks the page tree, so `deriveFormSnapshot` is the single insertion point in `src/core/forms/snapshot.ts`:

```ts
controls.push({
  ...controlBindingFromNode(node),
  visibleIf: stringProp(node, 'visibleIf', '') || undefined,
  stepId: stringProp(node, 'stepId', '') || undefined,
})
```

**Browser runtime** — extend `FORM_RUNTIME_JS` with a small `applyVisibleIf()` step. After `connectLabels(form)` and `prepareMessages(form)`:

```js
function applyVisibleIf(form) {
  const runners = collectVisibleIfRunners(form) // [{name, control, runner}]
  const update = () => {
    const values = collectValues(form)
    for (const { control, runner } of runners) {
      const visible = runner.runValues(values)
      control.closest('[data-instatic-form-control-wrapper]').hidden = !visible
    }
  }
  form.addEventListener('input', update)
  form.addEventListener('change', update)
  update()
}
```

The compiled runner is **embedded as data** into the published HTML at publish time (not at runtime — would require shipping a parser to visitors). The published snapshot already has access to all form snapshots, so we serialize `visibleIf` as the raw string and re-parse on the client using the same `compileExpression` function. That keeps `src/core/forms/conditions.ts` isomorphic and self-contained.

### 6b. Multistep runtime

**Schema**: `FormPropsSchema` extended:

```ts
multistep: Type.Boolean({ default: false }),
initialStep: Type.String({ default: '' }),  // optional entry-step id
```

`FormControlBinding` already has `stepId` from 6a. The publisher collects `steps[]` from distinct `stepId` values across controls + the form's own `initialStep`.

**Browser runtime additions** to `FORM_RUNTIME_JS`:

```js
function applyMultistep(form) {
  if (!form.dataset.multistep) return
  const steps = collectSteps(form) // ordered list of step containers
  let current = 0
  // Render prev/next nav inside the form (or rely on existing base.submit per step)
  // On each next: validate controls in current step's containers; if invalid, block.
  // On submit: validate all remaining steps.
}
```

`base.submit` becomes step-aware: if the form has `multistep`, clicking submit on the **last** step submits; earlier steps' submits act as "next" buttons. This reuses existing `base.submit` without a new module.

### Verification

- Unit tests for `compileExpression`:
  - `'framework == "Other"'` returns true when `framework === 'Other'`.
  - `'age >= 18'` returns false for `age = 17`.
  - Unknown identifier rejected at `validate()`.
  - Reconciliation: changing control A re-evaluates dependent controls, not unrelated ones (use `getVariables()` to skip).
- Browser runtime tests with `happy-dom`: control wrapper element hidden when expression false.
- Snapshot regression: existing `PublishedFormSnapshot` JSON tests still pass — added fields are optional.

---

## Feature #7 — Visitor Comments → Canvas Annotations

### Schema

**New migration** `server/db/migrations-{pg,sqlite}/2026-09-17-node-annotations.ts`:

```sql
CREATE TABLE node_annotations (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  page_id TEXT NOT NULL,
  node_id TEXT NOT NULL,         -- matches PageNode.id on the published page
  publish_version INTEGER NOT NULL,
  parent_id TEXT REFERENCES node_annotations(id),
  author_name TEXT NOT NULL,
  author_email_hash TEXT NOT NULL,  -- sha256(lowercased email) for spam dedup
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'resolved'
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE INDEX node_annotations_page_idx ON node_annotations(site_id, page_id, status);
CREATE INDEX node_annotations_thread_idx ON node_annotations(parent_id);
```

**Why not in `data_rows`?** Annotations are site-scoped system state with no schema flexibility needed; a dedicated table avoids polluting the user's `data_tables` list.

### Public POST endpoint

`server/annotations/handler.ts` — `POST /_instatic/annotation` with rate limiting (per-IP + per-node) mirroring `server/forms/rateLimit.ts`:

```ts
POST /_instatic/annotation
{
  pageId: string,
  nodeId: string,        // validated against PublishedPage snapshot
  publishVersion: number, // reject if not the latest
  parentId: string | null,
  authorName: string,
  authorEmail: string,    // hashed server-side, never stored plaintext
  body: string
}
→ 201 { id, createdAt }
```

CSRF protection reuses `originAllowed` from `server/auth/security.ts` (same as public forms).

### Editor API + canvas overlay

`GET /_instatic/admin/annotations?pageId=…&publishVersion=…` returns the annotation threads for a page. Admin-only.

### Annotations panel

`src/admin/pages/editor/tabs/Annotations.tsx` — new tab on the page editor (alongside Page settings). Renders two layered views:

- **Anchored pins** — a small bubble on each annotated `nodeId` in the canvas overlay (`src/admin/canvas/OverlayLayer.tsx`). Implemented as positioned `<button>`s absolutely placed over the canvas DOM. Click → open thread.
- **Floating thread panel** — right-side overlay with collapsible threads (BlockNote UX). Replies update via mutation against `POST /_instatic/annotation`.

This deliberately mirrors BlockNote's `<AnchoredThreads>` + `<FloatingThreads>` split. No liveblocks dependency — REST only. Polling every 30s while the editor is open; future v2 can add SSE.

### Versioning

The `publishVersion` stamp is critical: when the editor restores an old version, the annotation overlay must use the version's annotations, not the latest. This reuses the same pattern as `findPublishedFormSnapshot` in `server/forms/handler.ts:164`.

### Verification

- Public POST: missing origin → 403 (matches `publicFormOriginAllowed`).
- Per-IP rate limit kicks in at 5/min (calibrated against typical comment abuse patterns).
- Annotation against a non-existent `nodeId` → 400 (`nodeId` is validated against `page.nodes` in the snapshot).
- Editor tab renders anchored pin in correct canvas position via `getBoundingClientRect()` on the corresponding DOM element.

---

## Sequencing & shared work

The three features share infrastructure. To avoid re-opening each feature's data model three times:

**Step 1 (shared): Schema bumps**

- `DataFieldSchema` (one union extension).
- `FormControlBindingSchema` (two optional fields).
- New `node_annotations` table migration.

**Step 2 (shared): `compileExpression` engine + isomorphism**

- Lives in `src/core/forms/conditions.ts`, used by both `src/modules/base/forms/` (server-side `validateFormSubmission`) and `FORM_RUNTIME_JS` (client-side, via bundle include).

**Step 3 (feature #4): List Field**

- Schema + coercion + Loop source.
- Admin UI for sub-row grid editor.

**Step 4 (feature #6): Conditional + Multistep forms**

- `visibleIf` plumbing end-to-end (snapshot + runtime).
- Multistep form runtime.
- PropertiesPanel UX for both.

**Step 5 (feature #7): Canvas annotations**

- Migration + public POST + admin GET.
- Annotations panel + canvas overlay pins.

This sequence means steps 1+2 unblock both #4 and #6 in parallel. Step 5 is independent of #6's runtime but benefits from #6's testing patterns.

---

## Risks

| Risk                                                                    | Mitigation                                                                                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `compileExpression` shipped to visitors adds JS payload                 | Tree-shake only the expression evaluator. ~3 KB minified gzipped. Measured at build time.                               |
| Expression complexity grows (users write unmaintainable logic)          | `validate()` rejects at authoring time; runtime surfaces `invisible_field` errors on publish if validation is bypassed. |
| Annotation rate-limit bypass via email rotation                         | Per-node + per-IP dual limit; `author_email_hash` dedups repeat offenders server-side.                                  |
| Annotation overlay misaligned on canvas resize                          | Use ResizeObserver on the canvas root, recompute pin positions. Already used in BlockNote reference.                    |
| `listField` cell migration on existing rows                             | New cell values default to `[]`; old rows with NULL cells fall through existing `?? []` patterns.                       |
| `visibleIf` referencing a field that doesn't exist in the form snapshot | Runtime catches; UI PropertiesPanel validator catches at authoring time.                                                |

---

## Verification criteria (acceptance)

1. **`bun run lint`** and **`bun run typecheck`** clean.
2. **`bun run format:check`** clean.
3. **`bun test`** passes; new tests cover `compileExpression`, `validateFormSubmission` for `listField`, and `node_annotations` rate-limit + origin checks.
4. **Manual smoke**:
   - Create a `DataTable` with a `listField` of two text sub-fields; save a row; render via `base.loop`; verify HTML output iterates `currentEntry.<field>[i].<sub>`.
   - Add `visibleIf: "framework == 'Other'"` to a form control in a CMS form; submit with `framework = Other`; verify the hidden control appears.
   - Post a visitor comment to a page; verify the pin appears in the editor Annotations tab; resolve it; verify it moves to "resolved".
5. **No regressions** in the existing form submission flow (snapshot regression tests + e2e form test).

---

## Steps

1. **Schema & shared engine** — Extend `DataFieldSchema` (`src/core/data/schemas.ts`) with `listField` variant. Extend `FormControlBindingSchema` (`src/core/forms/schemas.ts`) with `visibleIf` + `stepId`. Add `multistep` + `initialStep` to `FormPropsSchema` (`src/modules/base/forms/index.ts`). Create `src/core/forms/conditions.ts` with `compileExpression` + `ExpressionRunner` (no deps; recursive-descent parser for the documented grammar; unit-tested via `src/core/forms/__tests__/conditions.test.ts`).
2. **List Field coercion + admin sub-row editor** — Add `listField` branch to `coerceFieldValue` + `validateCoercedValue` in `src/core/forms/validation.ts`; reject public-form submissions against `listField` with `unsupported_field` (matches existing `pageTree` pattern). In the Data admin grid (`src/admin/data/...`), branch on column type to render a mini-grid editor for `listField` cells with add/remove row.
3. **List Field Loop source** — Create `src/core/loops/sources/listField.ts` implementing `LoopEntitySource` (id `data.listField`, namespaced); self-register via `src/core/loops/sources/index.ts`. Verify publisher `renderLoop()` resolves `currentEntry.<listFieldId>[i].<subFieldId>` without publisher changes (`bun test` snapshot test).
4. **Form snapshot bakes `visibleIf` and `stepId`** — Extend `controlBindingFromNode` in `src/core/forms/snapshot.ts` to include the two new optional fields from the page-node props. Existing snapshot regression tests must still pass.
5. **Form runtime JS — `visibleIf` apply step** — Extend `FORM_RUNTIME_JS` (`src/modules/base/forms/formRuntimeJs.ts`) with `compileExpressionInline()` + `applyVisibleIf()` called after `attachForm()`. Bundle the expression evaluator source (no eval, no Function ctor). Add browser-runtime test with `happy-dom` that toggles visibility on input.
6. **Form runtime JS — multistep apply step** — Extend `FORM_RUNTIME_JS` with `applyMultistep()` that collects `stepId`-grouped controls and a prev/next nav; `base.submit` becomes step-aware (next on non-final steps, submit on final). Add `data-instatic-multistep` and `data-instatic-step="<id>"` data-attributes at render time in `FormModule.render`.
7. **Annotations table migration** — Add `server/db/migrations-pg/2026-09-17-node-annotations.ts` and the SQLite twin in `server/db/migrations-sqlite/`. Wire into the existing migration runner pattern; verify on a fresh DB and on an upgrade scenario.
8. **Public annotation endpoint + rate limit + origin check** — Create `server/annotations/{handler,rateLimit}.ts` mirroring `server/forms/{handler,rateLimit}.ts`. Mount at `/_instatic/annotation` in `server/router.ts`. Per-IP + per-node rate limits, `originAllowed` check (same as public forms).
9. **Admin annotation GET + Editor Annotations tab** — Add `GET /_instatic/admin/annotations` (admin-only). Create `src/admin/pages/editor/tabs/Annotations.tsx` with anchored pins + floating thread panel, mirroring BlockNote's UX split. Add the tab to the editor page route.
10. **Canvas overlay pin positioning** — Extend `src/admin/canvas/OverlayLayer.tsx` to render annotation pins at the `getBoundingClientRect()` of each annotated `nodeId`'s DOM element, recomputed on resize via `ResizeObserver`. Pin click → open floating thread.
11. **Tests + lint + format + smoke** — Write/extend unit tests for `compileExpression`, `validateFormSubmission` (`listField` rejection), `node_annotations` rate limit + origin check, multistep submit gating. Run `bun run lint`, `bun run typecheck`, `bun run format:check`, `bun test`. Manual smoke against a fresh dev server with the three features wired into a sample page; capture browser screenshots for verification.
12. **Documentation + CHANGELOG** — Update `docs/` (or existing form docs) with the new `listField` field type, `visibleIf` syntax, and annotation flow. Add a single `CHANGELOG.md` entry describing the three features at user-level (with screenshots).
