/**
 * MCP tool: capture_from_url
 *
 * Thin adapter. The actual 7-stage pipeline lives in `./runCapture.ts`
 * (orchestrator + fetch) and `./pipeline.ts` (pure stages 2-7). This
 * module is the MCP boundary:
 *   1. Validate the input shape (selector syntax, scope/selector pairing)
 *   2. Construct the production fetcher (Playwright) and persist callback
 *   3. Delegate to `runCapture()` and return the result
 */
import { Type } from '@core/utils/typeboxHelpers'
import type { CoreCapability } from '@core/capabilities'
import type { AiTool, ToolContext } from '../../runtime/types'
import { createPlaywrightFetcher } from './core/playwrightFetcher'
import { runCapture, validateSelector, targetForScope } from './runCapture'
import type { CollectedAsset, UnavailableAsset } from './core/assets'
import type { NextAction } from './adapters/nextActions'

// Re-exported so existing callers (e.g. captureTool.test.ts) can keep
// importing them from this module.
export { validateSelector, targetForScope } from './runCapture'

type CaptureInputInternal = {
  url: string
  mode?: 'dom+styles' | 'dom-only' | 'styles-only'
  scope?: 'page' | 'subtree' | 'element'
  selector?: string
  assetsMax?: number
  interactions?: ReadonlyArray<import('./core/interactions').InteractionStep>
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
    interactions: Type.Optional(
      Type.Array(
        Type.Object(
          {
            action: Type.Union([
              Type.Literal('click'),
              Type.Literal('fill'),
              Type.Literal('type'),
              Type.Literal('hover'),
              Type.Literal('wait_for'),
              Type.Literal('wait_for_url'),
              Type.Literal('wait'),
              Type.Literal('press'),
            ]),
            selector: Type.Optional(Type.String()),
            value: Type.Optional(Type.String()),
            text: Type.Optional(Type.String()),
            pattern: Type.Optional(Type.String()),
            key: Type.Optional(Type.String()),
            ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 30_000 })),
            timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 60_000 })),
            delayMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 5_000 })),
          },
          { additionalProperties: false },
        ),
        { maxLength: 50, description: 'Pre-capture interactions applied after navigation and before extraction (SPA support).' },
      ),
    ),
  },
  { additionalProperties: false },
)

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
    const { url, mode = 'dom+styles', scope = 'page', selector, assetsMax = 25, interactions } = input as CaptureInputInternal

    // Boundary validation: scope/subtree/element require a selector; the
    // selector itself must pass validateSelector. Both checks fire BEFORE
    // Playwright is launched so the caller gets a clean error envelope.
    if (scope !== 'page' && !selector) {
      return { ok: false, error: `scope=${scope} requires a selector` }
    }
    if (selector) {
      const validation = validateSelector(selector)
      if (!validation.ok) {
        return { ok: false, error: validation.error }
      }
    }
    // Reference targetForScope so ESLint counts it as used; the symbol is
// only consumed via the re-export on line 21 (captureTool.test.ts
// imports it from this module). Without this, `targetForScope` would
// be flagged as unused and the import line would be removed by --fix.
void targetForScope

// Production fetcher: launch a real Playwright browser. The orchestrator
    // owns the lifecycle (close in its own finally block).
    const fetcher = await createPlaywrightFetcher()
    return runCapture(
      { url, mode, scope, selector, assetsMax, interactions },
      {
        fetcher,
        db: ctx.db,
        persist: async (localPath, bytes) => {
          await Bun.write(localPath, bytes)
        },
      },
    )
  },
}
