/**
 * Capture orchestrator. Stage 1 (fetch via the injected fetcher) plus
 * the wiring that surrounds stages 2-7 (resolving tokens from the DB,
 * generating the captureId asset layout, building the safeFetcher).
 *
 * The actual transformation pipeline lives in `./pipeline.ts` so it's
 * pure and testable. This module is the I/O shell: it owns the fetcher
 * lifecycle so a real Playwright browser never leaks even when the
 * pipeline throws.
 *
 * DI: `CaptureFetcher` is injected so production wires the Playwright
 * implementation and tests inject a stub. The `db` and `persist` deps
 * are similarly injected — the pipeline never sees them directly.
 */

import type { DbClient } from '../../../db/client'
import { getDraftSite } from '../../../repositories/site'
import { createSafeFetcher } from './core/safeFetcher'
import { type CaptureFetcher, type FetchedPage } from './core/playwrightFetcher'
import { generateUid } from './adapters/uids'
import { tokensFromSite } from './adapters/tokens'
import { applyPipeline, type CaptureMode } from './pipeline'

// Re-export so captureTool.ts (and any test that imports from this module)
// can keep using the validateSelector boundary check without crossing
// into pipeline.ts directly.
export { validateSelector } from './pipeline'
import type { CaptureTarget } from './core/domExtractor'
import type { CollectedAsset, UnavailableAsset } from './core/assets'
import type { NextAction } from './adapters/nextActions'

export interface RunCaptureInput {
  url: string
  mode?: CaptureMode
  scope?: 'page' | 'subtree' | 'element'
  selector?: string
  assetsMax?: number
}

export interface RunCaptureDeps {
  /** Page fetcher. Production: PlaywrightFetcher. Tests: stub. */
  fetcher: CaptureFetcher
  /** DB client used to read the draft site's tokens. */
  db: DbClient
  /** Persist a downloaded asset to local storage. */
  persist: (localPath: string, bytes: Uint8Array) => Promise<void>
}

export interface RunCaptureResult {
  ok: boolean
  error?: string
  html?: string
  css?: string
  uids?: string[]
  assetFiles?: CollectedAsset[]
  unavailable?: UnavailableAsset[]
  nextActions?: NextAction[]
}

/**
 * Translate the user-facing `scope` + `selector` pair into a CaptureTarget
 * the fetcher's DOM walker understands. Three cases:
 *   - scope: 'page'      → walk the whole body (selector: null, maxDepth: Infinity)
 *   - scope: 'subtree'   → walk from the selector down, include all descendants
 *   - scope: 'element'   → only the single element matching the selector
 */
export function targetForScope(
  scope: 'page' | 'subtree' | 'element',
  selector: string | undefined,
): CaptureTarget {
  switch (scope) {
    case 'subtree':
      return { selector, maxDepth: Infinity }
    case 'element':
      return { selector, maxDepth: 0 }
    case 'page':
      return { selector: null, maxDepth: Infinity }
  }
}

/** FNV-1a 32-bit hash, base36. Matches the convention in core/assets.ts. */
function fnv1a32(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).padStart(8, '0')
}

/**
 * Fetch the URL, then run the pipeline. Owns the fetcher lifecycle (the
 * finally block releases the page and the browser even on error).
 * Returns `{ ok: true, … }` on success, `{ ok: false, error }` on any
 * failure — never throws, so the caller can pass the result straight
 * through to the MCP tool envelope.
 */
export async function runCapture(
  input: RunCaptureInput,
  deps: RunCaptureDeps,
): Promise<RunCaptureResult> {
  const {
    url,
    mode = 'dom+styles',
    scope = 'page',
    selector,
    assetsMax = 25,
  } = input
  const target = targetForScope(scope, selector)
  let fetched: FetchedPage | null = null

  try {
    // Stage 1: fetch + extract. Always runs — the DOM walk is cheap and the
    // page-side data is needed for both the HTML and CSS branches.
    fetched = await deps.fetcher.fetch(url, target)
    const nodes = fetched.nodes

    // Selector matched nothing on the rendered page. Surface as a clean
    // boundary error rather than letting the rest of the pipeline
    // (collapse / rewrite / uid assign) silently produce empty output
    // that the agent would have to interpret as either "no styles" or
    // "wrong selector".
    if (selector && nodes.length === 0) {
      return { ok: false, error: 'selector matched 0 elements on the captured page' }
    }

    // Resolve the draft site's tokens from the DB. Empty list is fine —
// applyDesignTokens is a no-op when there are no colour tokens. Skip
// entirely for 'dom-only' — no CSS path means tokens are never read.
    const needsCss = mode !== 'dom-only'
    const draftSite = needsCss ? await getDraftSite(deps.db) : null
    const tokens = draftSite ? tokensFromSite(draftSite) : []

    // Capture id drives the local asset layout. Stable per-run so persisted
    // files can be found by the nextActions that follow. The safeFetcher is
    // only constructed when `mode` actually wants assets — restricted modes
    // ('dom-only' / 'styles-only') skip network entirely.
    const captureId = generateUid()
    const persistDir = `uploads/captures/${captureId}`
    const needsAssets = mode !== 'dom-only' && mode !== 'styles-only'
    const safeFetcher = needsAssets ? createSafeFetcher() : null

    // Stages 2-7: pure pipeline. All I/O is parameterized via the args
    // below so the pipeline module itself never touches Bun, the DB, or
    // the network.
    const result = await applyPipeline({
      nodes,
      mode,
      tokens,
      assetsMax,
      baseUrl: url,
      safeFetcher: safeFetcher ?? { fetch: async () => ({ ok: false, error: 'no fetcher (restricted mode)' }) },
      resolveLocalPath: (u) => {
        const m = u.match(/\.[a-z0-9]{1,8}(?:\?|$)/i)
        const ext = m ? m[0].replace(/[?].*$/, '') : '.bin'
        return `${persistDir}/${fnv1a32(u)}${ext}`
      },
      persist: deps.persist,
      parentNodeId: '',
    })

    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    // Release per-page resources (page + context), then the browser
    // process. Without this, every MCP call leaks one Chromium.
    try { await fetched?.close() } catch { /* best effort */ }
    try { await deps.fetcher?.close() } catch { /* best effort */ }
  }
}
