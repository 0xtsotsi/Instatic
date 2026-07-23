/**
 * MCP tool: capture_from_url
 *
 * Server-execution. Headless (no open editor required).
 * Pulls HTML+CSS from a live URL, three capture scopes (element / subtree / page),
 * and returns Instatic-shaped output (uid'd HTML + token-aware CSS) plus a
 * nextActions[] list the agent can call to apply the result.
 *
 * The handler composes the seven layers of the capture pipeline:
 *   1. Playwright fetcher — render the URL in a headless browser
 *   2. DOM extractor — walk the page, capture selectors + computed styles
 *   3. Style collapse — drop default-valued properties
 *   4. CSS rewriter — emit class-scoped rules
 *   5. Asset collector — fetch images/fonts, rewrite to local paths
 *   6. UID assigner — attach 12-char base62 ids to every element
 *   7. Token rewriter — swap close-match colors to var(--*)
 *   +. nextActions — hand off to site_apply_css / site_insert_html
 */
import { Type } from '@core/utils/typeboxHelpers'
import type { CoreCapability } from '@core/capabilities'
import type { AiTool, ToolContext } from '../../runtime/types'
import { createPlaywrightFetcher, type FetchedPage, type PlaywrightFetcher } from './core/playwrightFetcher'
import type { CaptureTarget } from './core/domExtractor'
import { collapseStyles } from './core/styleCollapse'
import { rewriteCss } from './core/cssRewriter'
import { collectAssets, type CollectedAsset, type UnavailableAsset } from './core/assets'
import { createSafeFetcher } from './core/safeFetcher'
import { assignUids, generateUid } from './adapters/uids'
import { applyDesignTokens, tokensFromSite } from './adapters/tokens'
import { buildNextActions, type NextAction } from './adapters/nextActions'
import { getDraftSite } from '../../../repositories/site'

type CaptureInputInternal = {
  url: string
  mode?: 'dom+styles' | 'dom-only' | 'styles-only'
  scope?: 'page' | 'subtree' | 'element'
  selector?: string
  assetsMax?: number
}

const CAPS: readonly CoreCapability[] = [
  'site.read',
  'site.structure.edit',
  'site.content.edit',
  'site.style.edit',
  'pages.edit',
]

const CaptureInput = Type.Object(
  {
    url: Type.String({ format: 'uri', description: 'Absolute http(s) URL to capture.' }),
    mode: Type.Optional(
      Type.Union([Type.Literal('dom+styles'), Type.Literal('dom-only'), Type.Literal('styles-only')], {
        description: 'What to return. Defaults to dom+styles.',
      }),
    ),
    scope: Type.Optional(
      Type.Union([Type.Literal('element'), Type.Literal('subtree'), Type.Literal('page')], {
        description: 'Capture scope. element/subtree require `selector`. Defaults to page.',
      }),
    ),
    selector: Type.Optional(
      Type.String({ description: 'CSS selector for element/subtree scope.' }),
    ),
    assetsMax: Type.Optional(
      Type.Integer({ minimum: 0, maximum: 100, description: 'Cap on asset downloads. Default 25.' }),
    ),
  },
  { additionalProperties: false },
)

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
 * Translate the user-facing `scope` + `selector` pair into a CaptureTarget
 * the fetcher's DOM walker understands. Three cases:
 *   - scope: 'page'      → walk the whole body (selector: null, maxDepth: Infinity)
 *   - scope: 'subtree'   → walk from the selector down, include all descendants
 *   - scope: 'element'   → only the single element matching the selector
 */
export function targetForScope(scope: 'page' | 'subtree' | 'element', selector: string | undefined): CaptureTarget {
  switch (scope) {
    case 'subtree':
      return { selector, maxDepth: Infinity }
    case 'element':
      return { selector, maxDepth: 0 }
    case 'page':
      return { selector: null, maxDepth: Infinity }
  }
}

interface CaptureOutput {
  ok: boolean
  error?: string
  html?: string
  css?: string
  uids?: string[]
  assetFiles?: CollectedAsset[]
  unavailable?: UnavailableAsset[]
  nextActions?: NextAction[]
}

export const captureTool: AiTool = {
  name: 'capture_from_url',
  description:
    'Capture a section or whole page from a live URL and return Instatic-shaped HTML (with uids) and CSS (rewritten to use site design tokens where close), plus nextActions the agent can call to apply the result via site_apply_css / site_insert_html. Use this when a user shares a reference URL they want reproduced as Instatic content. Three scopes: page (default), subtree, element. Requires a Site workspace capability.',
  scope: 'site',
  execution: 'server',
  inputSchema: CaptureInput,
  requiredCapabilities: CAPS,
  handler: async (input, ctx: ToolContext): Promise<CaptureOutput> => {
    const { url, mode = 'dom+styles', scope = 'page', selector, assetsMax = 25 } = input as CaptureInputInternal
    if (scope !== 'page' && !selector) {
      return { ok: false, error: `scope=${scope} requires a selector` }
    }
    const target = targetForScope(scope, selector)
    let fetcher: PlaywrightFetcher | null = null
    let fetched: FetchedPage | null = null
    try {
      // 1. Fetch + extract
      fetcher = await createPlaywrightFetcher()
      fetched = await fetcher.fetch(url, { target })
      const nodes = fetched.nodes

      // 2. Collapse styles
      const collapsed = nodes.map((n) => ({
        ...n,
        computedStyles: collapseStyles(n.computedStyles),
      }))

      // 3. Build CSS
      const stylesMap: Record<string, Record<string, string>> = {}
      for (const n of collapsed) stylesMap[n.selector] = n.computedStyles
      let css = mode === 'dom-only' ? '' : rewriteCss(stylesMap, { stableOrder: true })

      // 4. Get site tokens + apply
      if (mode !== 'dom-only' && css) {
        const draftSite = await getDraftSite(ctx.db)
        if (draftSite) {
          const tokens = tokensFromSite(draftSite)
          css = applyDesignTokens(css, tokens)
        }
      }

      // 5. Asset collection
      let html = mode === 'styles-only' ? '' : nodes.map((n) => n.outerHTML).join('\n')
      const files: CollectedAsset[] = []
      const unavailable: UnavailableAsset[] = []
      if (mode !== 'styles-only' && html) {
        const safeFetcher = createSafeFetcher()
        const captureId = generateUid()
        const persistDir = `uploads/captures/${captureId}`
        const collected = await collectAssets(html, css, safeFetcher, {
          baseUrl: url,
          maxAssets: assetsMax,
          resolveLocalPath: (u) => {
            const m = u.match(/\.[a-z0-9]{1,8}(?:\?|$)/i)
            const ext = m ? m[0].replace(/[?].*$/, '') : '.bin'
            return `${persistDir}/${fnv1a32(u)}${ext}`
          },
          persist: async (localPath, bytes) => {
            await Bun.write(localPath, bytes)
          },
        })
        html = collected.html
        css = collected.css
        files.push(...collected.files)
        unavailable.push(...collected.unavailable)
      }

      // 6. Assign uids to HTML
      let uids: string[] = []
      if (html) {
        const result = assignUids(html)
        html = result.html
        uids = result.uids
      }

      // 7. Build nextActions (caller fills parentNodeId via a follow-up call)
      const nextActions = buildNextActions(
        { html, css, uids, assetFiles: files, unavailable },
        { parentNodeId: '' },
      )

      return { ok: true, html, css, uids, assetFiles: files, unavailable, nextActions }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      // Release per-page resources (page + context), then the browser
      // process. Without this, every MCP call leaks one Chromium.
      try { await fetched?.close() } catch { /* best effort */ }
      try { await fetcher?.close() } catch { /* best effort */ }
    }
  },
}
