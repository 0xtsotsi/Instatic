/**
 * Pure capture pipeline. Stages 2-7 of the seven-stage capture flow live
 * here, plus `validateSelector` (a pure input check that runs at the
 * boundary before the orchestrator starts).
 *
 * Stages:
 *   2. collapse computed styles
 *   3. rewrite CSS as class-scoped rules
 *   4. apply site design tokens
 *   5. collect assets (HTML + CSS image/font URLs) — uses injected fetcher
 *   6. assign uids to elements
 *   7. build nextActions the agent calls to apply the result
 *
 * PURE: no Instatic imports, no DB, no Playwright. The fetcher and persist
 * callbacks are injected so the production orchestrator can pass in the
 * SSRF-checked `createSafeFetcher()` and a Bun.write-backed persist, and
 * tests can pass stubs.
 *
 * The mode gates are local to this module so the surface is self-contained:
 *   - 'dom-only'    → html only, no CSS build, no token rewrite, no assets
 *   - 'styles-only' → css only, no HTML assembly, no uid assignment, no assets
 *   - 'dom+styles'  → everything
 */

import { collapseStyles } from './core/styleCollapse'
import { rewriteCss } from './core/cssRewriter'
import {
  collectAssets,
  type AssetFetcher,
  type CollectedAsset,
  type UnavailableAsset,
} from './core/assets'
import { applyDesignTokens, type SiteToken } from './adapters/tokens'
import { assignUids } from './adapters/uids'
import { buildNextActions, type NextAction } from './adapters/nextActions'
import type { ExtractedNode } from './core/domExtractor'

export type CaptureMode = 'dom+styles' | 'dom-only' | 'styles-only'

export interface ApplyPipelineInput {
  /** Nodes extracted from the rendered page (output of stage 1). */
  nodes: ExtractedNode[]
  /** What to return. Defaults to dom+styles. */
  mode: CaptureMode
  /** Tokens already resolved from the DB by the orchestrator. */
  tokens: SiteToken[]
  /** Cap on asset downloads. */
  assetsMax: number
  /** URL the page was loaded from — used to resolve relative asset URLs. */
  baseUrl: string
  /** Injected fetcher. Production: SSRF-checked. Tests: stub. */
  safeFetcher: AssetFetcher
  /** Map an original URL to a local path under the capture's storage dir. */
  resolveLocalPath: (url: string) => string
  /** Persist a downloaded asset. */
  persist: (localPath: string, bytes: Uint8Array) => Promise<void>
  /** parentNodeId passed through to nextActions. '' means caller fills it in. */
  parentNodeId: string
}

export interface ApplyPipelineResult {
  html: string
  css: string
  uids: string[]
  assetFiles: CollectedAsset[]
  unavailable: UnavailableAsset[]
  nextActions: NextAction[]
}

/**
 * Run stages 2-7 over the supplied nodes. Returns the assembled capture
 * result. The mode gates narrow the return shape:
 *   - 'styles-only' → html is '', css is non-empty, uids/assetFiles are empty
 *   - 'dom-only'    → css is '', html/uids populated, assetFiles empty
 *   - 'dom+styles'  → everything populated when the page had assets
 */
export async function applyPipeline(
  input: ApplyPipelineInput,
): Promise<ApplyPipelineResult> {
  const {
    nodes,
    mode,
    tokens,
    assetsMax,
    baseUrl,
    safeFetcher,
    resolveLocalPath,
    persist,
    parentNodeId,
  } = input

  const needsCss = mode !== 'dom-only'
  const needsHtml = mode !== 'styles-only'

  // Stage 2: collapse styles
  const collapsed = nodes.map((n) => ({
    ...n,
    computedStyles: collapseStyles(n.computedStyles),
  }))

  // Stage 3: build CSS
  const stylesMap: Record<string, Record<string, string>> = {}
  for (const n of collapsed) stylesMap[n.selector] = n.computedStyles
  let css = needsCss ? rewriteCss(stylesMap, { stableOrder: true }) : ''

  // Stage 4: apply site tokens (only when CSS is being built AND we have
  // non-empty CSS — applyDesignTokens is a no-op on empty input anyway,
  // but the explicit guard avoids an unnecessary regex scan).
  if (needsCss && css) {
    css = applyDesignTokens(css, tokens)
  }

  // Stage 5: asset collection. Gate is BOTH html AND css must be populated;
  // for restricted modes we skip the fetcher entirely so no `persist`
  // calls run and no `uploads/captures/<id>/` directory is created.
  let html = needsHtml ? nodes.map((n) => n.outerHTML).join('\n') : ''
  const files: CollectedAsset[] = []
  const unavailable: UnavailableAsset[] = []
  const needsAssets = needsHtml && css && html
  if (needsAssets) {
    const collected = await collectAssets(html, css, safeFetcher, {
      baseUrl,
      maxAssets: assetsMax,
      resolveLocalPath,
      persist,
    })
    html = collected.html
    css = collected.css
    files.push(...collected.files)
    unavailable.push(...collected.unavailable)
  }

  // Stage 6: assign uids to HTML
  let uids: string[] = []
  if (html) {
    const result = assignUids(html)
    html = result.html
    uids = result.uids
  }

  // Stage 7: build nextActions (caller fills parentNodeId via a follow-up)
  const nextActions = buildNextActions(
    { html, css, uids, assetFiles: files, unavailable },
    { parentNodeId },
  )

  return { html, css, uids, assetFiles: files, unavailable, nextActions }
}

// ---------------------------------------------------------------------------
// validateSelector — pure input check. Lives here because it has no I/O;
// captureTool.ts and runCapture.ts both import it from this module.
// ---------------------------------------------------------------------------

/**
 * Maximum allowed selector length. Anything longer is almost certainly
 * malformed input (CSS selectors are rarely more than a few dozen chars
 * in practice). Cap protects the boundary from runaway patterns.
 */
const MAX_SELECTOR_LENGTH = 500

/**
 * Render a selector as a single-line, printable fragment suitable for an
 * error message. Strips control characters (NUL, etc.), collapses
 * whitespace, and clips to `maxLen`. If the result is empty after
 * sanitisation (e.g. selector was nothing but control chars), return a
 * placeholder so the error message still reads naturally.
 */
function sanitizeSelectorForError(s: string, maxLen = 100): string {
  const cleaned = s
    // eslint-disable-next-line no-control-regex -- intentionally replacing control chars with '?' for safe display
    .replace(/[\x00-\x1f\x7f]/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length === 0) return '<unprintable>'
  if (cleaned.length <= maxLen) return cleaned
  return cleaned.slice(0, maxLen) + '...'
}

/**
 * Lightweight CSS selector syntax check. NOT a full parser — just enough
 * to reject obviously malformed input (forbidden chars, unmatched parens,
 * NUL bytes, absurd length) at the boundary before the Playwright walker
 * is invoked. The walker inside the page is permissive and would happily
 * accept gibberish; checking here gives the caller a clean error message
 * instead of an opaque walker failure buried deep in the stack.
 *
 * Returns `{ ok: true }` for well-formed input, or `{ ok: false, error }`
 * with an error string suitable for the tool's return shape.
 */
export function validateSelector(
  selector: string,
): { ok: true } | { ok: false; error: string } {
  const sample = sanitizeSelectorForError(selector)
  if (selector.length > MAX_SELECTOR_LENGTH) {
    return {
      ok: false,
      error: `invalid selector: length ${selector.length} exceeds ${MAX_SELECTOR_LENGTH}-char limit: "${sample}"`,
    }
  }
  if (selector.includes('\0')) {
    return {
      ok: false,
      error: `invalid selector: contains NUL byte: "${sample}"`,
    }
  }
  // Forbid CSS block delimiters and statement terminators. These are never
  // valid in a selector and most commonly show up in injection attempts or
  // truncated copy-paste from a style block.
  if (!/^[^{};]*$/.test(selector)) {
    return {
      ok: false,
      error: `invalid selector: contains forbidden characters {, }, ; — only valid CSS selector syntax allowed: "${sample}"`,
    }
  }
  // Balanced parens. Toggle a counter on each '(' and ')'. If we ever go
  // negative (close before open) or end with a non-zero count, the parens
  // are unbalanced.
  let open = 0
  for (const ch of selector) {
    if (ch === '(') open++
    else if (ch === ')') {
      open--
      if (open < 0) {
        return {
          ok: false,
          error: `invalid selector: unmatched ) parenthesis: "${sample}"`,
        }
      }
    }
  }
  if (open !== 0) {
    return {
      ok: false,
      error: `invalid selector: unmatched ( parenthesis: "${sample}"`,
    }
  }
  return { ok: true }
}
