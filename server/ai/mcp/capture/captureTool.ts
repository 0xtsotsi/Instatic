/**
 * MCP tool: capture_from_url
 *
 * Server-execution. Headless (no open editor required).
 * Pulls HTML+CSS from a live URL, three capture scopes (element / subtree / page),
 * and returns Instatic-shaped output (uid'd HTML + token-aware CSS) plus a
 * nextActions[] list the agent can call to apply the result.
 *
 * Full implementation lands in Task 6 (composition). This file ships the
 * contract, capability gate, and a stub handler.
 */
import { Type } from '@core/utils/typeboxHelpers'
import type { CoreCapability } from '@core/capabilities'
import type { AiTool, ToolContext } from '../../runtime/types'

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

export const captureTool: AiTool = {
  name: 'capture_from_url',
  description:
    'Capture a section or whole page from a live URL and return Instatic-shaped HTML (with uids) and CSS (rewritten to use site design tokens where close), plus nextActions the agent can call to apply the result via site_apply_css / site_insert_html. Use this when a user shares a reference URL they want reproduced as Instatic content. Three scopes: page (default), subtree, element. Requires a Site workspace capability.',
  scope: 'site',
  execution: 'server',
  inputSchema: CaptureInput,
  requiredCapabilities: CAPS,
  handler: async (_input, _ctx: ToolContext) => {
    return { ok: false, error: 'not implemented (Task 6 — composition)' }
  },
}
