# Site Runtime Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first complete self-hosted site runtime path: persisted script runtime settings, dependency diagnostics, self-hosted script bundles, publish-time runtime assets, and a canvas-safe preview document.

**Architecture:** Add a shared core runtime model under `src/core/site-runtime`, server-side bundling under `server/cms/runtime`, and publish/runtime asset storage through the CMS. Editor UI consumes the same runtime config and diagnostics; publish and preview consume the same runtime builder output.

**Tech Stack:** TypeScript, Zustand, Bun, esbuild, Postgres-compatible repository functions, React, CodeMirror.

---

## Baseline Note

The isolated worktree baseline full suite currently has two unrelated failures before implementation starts:

- `BTN-3 — Button primitive usage gate`
- `ClassPropertyRow remove button layout`

Runtime work should use targeted tests and `bun run build`. Do not modify the failing baseline files unless the runtime work directly requires it.

## File Structure

- `src/core/site-runtime/types.ts`: runtime config, lock, script config, asset manifest, and diagnostics types.
- `src/core/site-runtime/scriptConfig.ts`: defaults, normalization, scope matching, and script selection.
- `src/core/site-runtime/importAnalysis.ts`: static/literal dynamic import extraction and package usage diagnostics.
- `src/core/site-runtime/assetManifest.ts`: script tag planning and HTML injection helpers.
- `src/core/site-runtime/index.ts`: public exports for core runtime helpers.
- `src/core/page-tree/types.ts`: add optional `runtime` to `SiteDocument`.
- `src/core/persistence/validate.ts`: normalize and preserve `site.runtime`.
- `src/core/editor-store/slices/runtimeSlice.ts`: script runtime settings store actions.
- `src/core/editor-store/slices/filesSlice.ts`: create default script runtime config and clean config on delete.
- `src/core/editor-store/store.ts`: register runtime slice.
- `src/editor/components/DependenciesPanel/DepsSection.tsx`: show script dependency usage and unresolved/missing status.
- `src/editor/components/CodeEditor/ScriptSettingsPane.tsx`: script runtime controls next to CodeMirror.
- `src/editor/components/CodeEditor/ScriptSettingsPane.module.css`: script settings layout.
- `src/editor/components/CodeEditor/CodeEditorPanel.tsx`: render script settings for active script files.
- `src/core/persistence/cmsRuntime.ts`: client calls for dependency resolution and preview build.
- `server/cms/runtime/dependencyResolver.ts`: npm metadata resolution into exact lock entries.
- `server/cms/runtime/dependencyCache.ts`: isolated Bun install cache keyed by lock hash.
- `server/cms/runtime/virtualSiteWorkspace.ts`: materialize site script files in temp build workspaces.
- `server/cms/runtime/bundleScripts.ts`: esbuild browser bundles and diagnostics.
- `server/cms/runtime/previewRuntime.ts`: build sandboxed preview `srcdoc`.
- `server/cms/runtime/publishRuntime.ts`: build publish runtime manifest and bytes.
- `server/cms/runtimeAssetRepository.ts`: persist and read immutable published runtime assets.
- `server/cms/publishRepository.ts`: build/store runtime assets during publish.
- `server/cms/publicRenderer.ts`: pass runtime manifest into `publishPage`.
- `server/router.ts`: serve `/_pb/assets/...`.
- `server/cms/migrations.ts`: add `published_runtime_assets`.
- `server/cms/handlers.ts`: add runtime dependency/preview endpoints.
- `package.json`, `bun.lock`: add direct `esbuild` dependency.

## Tasks

### Task 1: Runtime Data Model And Validation

**Files:**
- Create: `src/core/site-runtime/types.ts`
- Create: `src/core/site-runtime/scriptConfig.ts`
- Create: `src/core/site-runtime/index.ts`
- Modify: `src/core/page-tree/types.ts`
- Modify: `src/core/persistence/validate.ts`
- Test: `src/__tests__/site-runtime/scriptConfig.test.ts`
- Test: `src/__tests__/persistence.test.ts`

- [ ] **Step 1: Write failing runtime config tests**

Create `src/__tests__/site-runtime/scriptConfig.test.ts` with tests for default runtime config, script config normalization, scope matching, and enabled script selection.

- [ ] **Step 2: Run the new test and verify it fails**

Run: `bun test src/__tests__/site-runtime/scriptConfig.test.ts`

Expected: FAIL because `@core/site-runtime` does not exist.

- [ ] **Step 3: Implement runtime types and script helpers**

Add the core runtime files with exported `DEFAULT_SITE_RUNTIME`, `DEFAULT_SCRIPT_RUNTIME_CONFIG`, `normalizeSiteRuntimeConfig`, `scriptAppliesToPage`, and `collectRuntimeScripts`.

- [ ] **Step 4: Add runtime validation to SiteDocument hydration**

Add `runtime?: SiteRuntimeConfig` to `SiteDocument`, call `normalizeSiteRuntimeConfig(raw.runtime)` from `validateSite`, and include `runtime` in the returned document.

- [ ] **Step 5: Run runtime and persistence tests**

Run:

```sh
bun test src/__tests__/site-runtime/scriptConfig.test.ts src/__tests__/persistence.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add src/core/site-runtime src/core/page-tree/types.ts src/core/persistence/validate.ts src/__tests__/site-runtime/scriptConfig.test.ts src/__tests__/persistence.test.ts
git commit -m "Add site runtime config model"
```

### Task 2: Store Actions For Script Runtime Settings

**Files:**
- Create: `src/core/editor-store/slices/runtimeSlice.ts`
- Modify: `src/core/editor-store/store.ts`
- Modify: `src/core/editor-store/slices/siteSlice.ts`
- Modify: `src/core/editor-store/slices/filesSlice.ts`
- Test: `src/__tests__/editor-store/runtimeSlice.test.ts`
- Test: `src/__tests__/core/filesDataLayer.test.ts`

- [ ] **Step 1: Write failing store tests**

Create tests that create a script file, assert default runtime config exists, update the script settings, and delete the script file.

- [ ] **Step 2: Run tests and verify they fail**

Run:

```sh
bun test src/__tests__/editor-store/runtimeSlice.test.ts src/__tests__/core/filesDataLayer.test.ts
```

Expected: FAIL because runtime store actions do not exist.

- [ ] **Step 3: Implement runtime slice**

Add actions:

- `ensureScriptRuntimeConfig(fileId: string)`
- `updateScriptRuntimeConfig(fileId: string, patch: Partial<SiteScriptRuntimeConfig>)`
- `removeScriptRuntimeConfig(fileId: string)`

Register the slice in `store.ts`.

- [ ] **Step 4: Wire file creation and deletion**

When `createFile(..., 'script')` succeeds, create default script runtime config. When deleting any file, remove that file's runtime config.

- [ ] **Step 5: Run tests**

Run:

```sh
bun test src/__tests__/editor-store/runtimeSlice.test.ts src/__tests__/core/filesDataLayer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add src/core/editor-store src/__tests__/editor-store/runtimeSlice.test.ts src/__tests__/core/filesDataLayer.test.ts
git commit -m "Add script runtime store actions"
```

### Task 3: Import Analysis And Dependency Usage

**Files:**
- Create: `src/core/site-runtime/importAnalysis.ts`
- Modify: `src/core/site-runtime/index.ts`
- Modify: `src/editor/components/DependenciesPanel/DepsSection.tsx`
- Test: `src/__tests__/site-runtime/importAnalysis.test.ts`

- [ ] **Step 1: Write failing import analysis tests**

Cover static imports, export-from declarations, literal dynamic imports, relative imports, declared packages, undeclared packages, and Node builtin rejection.

- [ ] **Step 2: Verify RED**

Run: `bun test src/__tests__/site-runtime/importAnalysis.test.ts`

Expected: FAIL because import analysis is not implemented.

- [ ] **Step 3: Implement import analysis**

Implement regex-based extraction for import statements and literal dynamic imports. Generate stable diagnostics:

- `runtime.missing_dependency`
- `runtime.node_builtin`

- [ ] **Step 4: Add Dependencies panel usage**

Compute script package usage from `site.files[]` and `site.packageJson.dependencies`. Show package rows as `in use` when scripts import the package, and missing dependencies in the empty/status area.

- [ ] **Step 5: Run tests**

Run:

```sh
bun test src/__tests__/site-runtime/importAnalysis.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add src/core/site-runtime src/editor/components/DependenciesPanel/DepsSection.tsx src/__tests__/site-runtime/importAnalysis.test.ts
git commit -m "Analyze script dependency usage"
```

### Task 4: Publisher Runtime Manifest Injection

**Files:**
- Create: `src/core/site-runtime/assetManifest.ts`
- Modify: `src/core/site-runtime/index.ts`
- Modify: `src/core/publisher/render.ts`
- Test: `src/__tests__/publisher/runtimeAssets.test.ts`

- [ ] **Step 1: Write failing publisher tests**

Add tests that `publishPage` keeps `script-src 'none'` without runtime assets, changes CSP to `script-src 'self'` with runtime assets, injects `head` scripts in `<head>`, and injects `body-end` scripts before `</body>`.

- [ ] **Step 2: Verify RED**

Run: `bun test src/__tests__/publisher/runtimeAssets.test.ts`

Expected: FAIL because `publishPage` does not accept runtime assets.

- [ ] **Step 3: Implement runtime asset manifest helpers**

Add `PublishedRuntimeAsset`, `PublishedPageRuntimeAssets`, `scriptTagsForRuntimeAssets`, and escaping for script URLs.

- [ ] **Step 4: Update `publishPage` signature**

Support the existing positional signature and a new options object:

```ts
publishPage(page, site, registry, options)
```

Keep backward compatibility for existing callers that pass `breakpointId` and `templateContext`.

- [ ] **Step 5: Run publisher tests**

Run:

```sh
bun test src/__tests__/publisher/runtimeAssets.test.ts src/__tests__/publisher/render.test.ts src/__tests__/publisher/previewOverlay.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add src/core/site-runtime src/core/publisher/render.ts src/__tests__/publisher/runtimeAssets.test.ts
git commit -m "Inject runtime assets into published pages"
```

### Task 5: Server Runtime Bundler And Preview Document

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `server/cms/runtime/virtualSiteWorkspace.ts`
- Create: `server/cms/runtime/bundleScripts.ts`
- Create: `server/cms/runtime/previewRuntime.ts`
- Test: `src/__tests__/server/siteRuntimeBuild.test.ts`

- [ ] **Step 1: Add failing bundler tests**

Cover local TypeScript script bundling, undeclared package diagnostics, Node builtin diagnostics, and preview `srcdoc` sandbox output.

- [ ] **Step 2: Verify RED**

Run: `bun test src/__tests__/server/siteRuntimeBuild.test.ts`

Expected: FAIL because server runtime modules do not exist.

- [ ] **Step 3: Add direct esbuild dependency**

Run: `bun add esbuild`

- [ ] **Step 4: Implement virtual workspace and bundler**

Materialize `site.files[]` script files into a temp directory. Bundle page-scoped scripts with esbuild browser ESM output, code splitting, generated wrapper entrypoints, and diagnostics.

- [ ] **Step 5: Implement preview document**

Create a sandbox-safe HTML document with the rendered page HTML and inlined bundled JavaScript. The iframe caller must use `sandbox="allow-scripts"` without `allow-same-origin`.

- [ ] **Step 6: Run bundler tests**

Run: `bun test src/__tests__/server/siteRuntimeBuild.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add package.json bun.lock server/cms/runtime src/__tests__/server/siteRuntimeBuild.test.ts
git commit -m "Bundle site scripts for runtime preview"
```

### Task 6: Dependency Resolution And Cache

**Files:**
- Create: `server/cms/runtime/dependencyResolver.ts`
- Create: `server/cms/runtime/dependencyCache.ts`
- Test: `src/__tests__/server/siteRuntimeDependencies.test.ts`

- [ ] **Step 1: Write failing dependency resolver tests**

Use injected fetch and command runners to test exact version resolution, integrity capture, lock hash stability, and `bun install --ignore-scripts` invocation.

- [ ] **Step 2: Verify RED**

Run: `bun test src/__tests__/server/siteRuntimeDependencies.test.ts`

Expected: FAIL because resolver/cache modules do not exist.

- [ ] **Step 3: Implement resolver and cache**

Implement registry metadata resolution and isolated install workspace creation. The cache command must include `bun install --ignore-scripts --frozen-lockfile`.

- [ ] **Step 4: Run dependency tests**

Run: `bun test src/__tests__/server/siteRuntimeDependencies.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add server/cms/runtime src/__tests__/server/siteRuntimeDependencies.test.ts
git commit -m "Resolve and cache site runtime dependencies"
```

### Task 7: Published Runtime Asset Storage

**Files:**
- Modify: `server/cms/migrations.ts`
- Create: `server/cms/runtimeAssetRepository.ts`
- Modify: `server/cms/publishRepository.ts`
- Modify: `server/cms/publicRenderer.ts`
- Modify: `server/router.ts`
- Test: `src/__tests__/server/cmsRuntimeAssets.test.ts`
- Test: `src/__tests__/server/cmsPublish.test.ts`
- Test: `src/__tests__/server/publicRendering.test.ts`

- [ ] **Step 1: Write failing repository/publish tests**

Cover migration SQL, saving runtime assets, serving assets from `/_pb/assets/...`, and rendering published snapshots with runtime script tags.

- [ ] **Step 2: Verify RED**

Run:

```sh
bun test src/__tests__/server/cmsRuntimeAssets.test.ts src/__tests__/server/cmsPublish.test.ts src/__tests__/server/publicRendering.test.ts
```

Expected: FAIL because runtime assets are not stored or served.

- [ ] **Step 3: Implement migration and repository**

Add `published_runtime_assets` with `version_id`, `hash`, `filename`, `content_type`, `bytes`, and immutable public path lookup helpers.

- [ ] **Step 4: Integrate publish and public render**

Build runtime assets during publish, store bytes in Postgres, store page-specific runtime asset references in the snapshot, and pass those references to `publishPage`.

- [ ] **Step 5: Serve public runtime assets**

Route `/_pb/assets/:versionId/:hash/:file` to `runtimeAssetRepository`.

- [ ] **Step 6: Run tests**

Run:

```sh
bun test src/__tests__/server/cmsRuntimeAssets.test.ts src/__tests__/server/cmsPublish.test.ts src/__tests__/server/publicRendering.test.ts src/__tests__/publisher/runtimeAssets.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add server/cms/migrations.ts server/cms/runtimeAssetRepository.ts server/cms/publishRepository.ts server/cms/publicRenderer.ts server/router.ts src/__tests__/server/cmsRuntimeAssets.test.ts src/__tests__/server/cmsPublish.test.ts src/__tests__/server/publicRendering.test.ts
git commit -m "Publish self-hosted runtime assets"
```

### Task 8: Runtime CMS Endpoints And Client

**Files:**
- Modify: `server/cms/handlers.ts`
- Create: `src/core/persistence/cmsRuntime.ts`
- Modify: `src/core/persistence/index.ts`
- Test: `src/__tests__/server/cmsRuntimeHandlers.test.ts`
- Test: `src/__tests__/persistence/cmsRuntimeClient.test.ts`

- [ ] **Step 1: Write failing endpoint/client tests**

Cover authenticated dependency resolve, authenticated preview build, unauthorized rejection, and client error surfacing.

- [ ] **Step 2: Verify RED**

Run:

```sh
bun test src/__tests__/server/cmsRuntimeHandlers.test.ts src/__tests__/persistence/cmsRuntimeClient.test.ts
```

Expected: FAIL because endpoints and client do not exist.

- [ ] **Step 3: Implement endpoints**

Add:

- `POST /api/cms/runtime/dependencies/resolve`
- `POST /api/cms/runtime/dependencies/install`
- `POST /api/cms/runtime/preview-build`

- [ ] **Step 4: Implement client helpers**

Add `resolveCmsRuntimeDependency`, `installCmsRuntimeDependencies`, and `buildCmsRuntimePreview`.

- [ ] **Step 5: Run tests**

Run:

```sh
bun test src/__tests__/server/cmsRuntimeHandlers.test.ts src/__tests__/persistence/cmsRuntimeClient.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add server/cms/handlers.ts src/core/persistence/cmsRuntime.ts src/core/persistence/index.ts src/__tests__/server/cmsRuntimeHandlers.test.ts src/__tests__/persistence/cmsRuntimeClient.test.ts
git commit -m "Add CMS runtime build endpoints"
```

### Task 9: Script Settings UI

**Files:**
- Create: `src/editor/components/CodeEditor/ScriptSettingsPane.tsx`
- Create: `src/editor/components/CodeEditor/ScriptSettingsPane.module.css`
- Modify: `src/editor/components/CodeEditor/CodeEditorPanel.tsx`
- Test: `src/__tests__/code-editor/scriptSettingsPane.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Render `CodeEditorPanel` with an active script file and assert the settings pane has enabled, run-in-canvas, placement, timing, and scope controls that update store runtime config.

- [ ] **Step 2: Verify RED**

Run: `bun test src/__tests__/code-editor/scriptSettingsPane.test.tsx`

Expected: FAIL because the pane does not exist.

- [ ] **Step 3: Implement settings pane**

Use existing primitives where possible. Keep controls compact and editor-like. Avoid running preview automatically from this task.

- [ ] **Step 4: Run UI tests**

Run: `bun test src/__tests__/code-editor/scriptSettingsPane.test.tsx src/__tests__/site-explorer/siteExplorerPanel.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/editor/components/CodeEditor src/__tests__/code-editor/scriptSettingsPane.test.tsx
git commit -m "Add script runtime settings pane"
```

### Task 10: Final Verification

**Files:**
- No planned production changes.

- [ ] **Step 1: Run targeted runtime suite**

```sh
bun test \
  src/__tests__/site-runtime/scriptConfig.test.ts \
  src/__tests__/site-runtime/importAnalysis.test.ts \
  src/__tests__/publisher/runtimeAssets.test.ts \
  src/__tests__/server/siteRuntimeBuild.test.ts \
  src/__tests__/server/siteRuntimeDependencies.test.ts \
  src/__tests__/server/cmsRuntimeAssets.test.ts \
  src/__tests__/server/cmsRuntimeHandlers.test.ts \
  src/__tests__/persistence/cmsRuntimeClient.test.ts \
  src/__tests__/code-editor/scriptSettingsPane.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run: `bun run build`

Expected: PASS.

- [ ] **Step 3: Run full suite and document baseline failures**

Run: `bun test`

Expected: either PASS or only the two known baseline failures listed above.

- [ ] **Step 4: Commit remaining verification fixes**

If verification required small fixes:

```sh
git add package.json bun.lock src server
git commit -m "Stabilize site runtime dependencies"
```
