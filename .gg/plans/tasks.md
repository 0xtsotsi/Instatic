# Tasks — Plan 2026-09-17

Plan: `.gg/plans/2026-09-17-list-field-conditional-forms-canvas-comments.md`

## Status

- [x] **1. Schema & shared engine** — `DataFieldSchema` (listField), `FormControlBindingSchema` (visibleIf, stepId), `FormPropsSchema` (multistep, initialStep), `src/core/forms/conditions.ts::compileExpression` + unit tests
- [ ] **2. List Field coercion + admin sub-row editor** — `coerceFieldValue` branch for `listField`; mini-grid editor in Data admin
- [ ] **3. List Field Loop source** — `src/core/loops/sources/listField.ts` (id `data.listField`); self-register
- [ ] **4. Form snapshot bakes `visibleIf` and `stepId`** — extend `controlBindingFromNode` in `src/core/forms/snapshot.ts`; snapshot regression tests still pass
- [ ] **5. Form runtime JS — `visibleIf` apply step** — extend `FORM_RUNTIME_JS` with `compileExpressionInline()` + `applyVisibleIf()`; happy-dom test
- [ ] **6. Form runtime JS — multistep apply step** — `applyMultistep()`, step-aware `base.submit`, `data-instatic-multistep` / `data-instatic-step` attrs
- [ ] **7. Annotations table migration** — `node_annotations` table for PG + SQLite; wire into migration runner
- [ ] **8. Public annotation endpoint + rate limit + origin check** — `server/annotations/{handler,rateLimit}.ts`; mount at `/_instatic/annotation`
- [ ] **9. Admin annotation GET + Editor Annotations tab** — `GET /_instatic/admin/annotations`; `src/admin/pages/editor/tabs/Annotations.tsx`
- [ ] **10. Canvas overlay pin positioning** — `src/admin/canvas/OverlayLayer.tsx` pin rendering; ResizeObserver
- [ ] **11. Tests + lint + format + smoke** — `bun run lint`, `bun run typecheck`, `bun run format:check`, `bun test`; manual smoke
- [ ] **12. Documentation + CHANGELOG** — update `docs/`, single `CHANGELOG.md` entry
