/**
 * Build the nextActions[] list that tells the agent which MCP tools to
 * call next to apply a captured result.
 */

export interface NextAction {
  tool: string
  input: Record<string, unknown>
  description: string
}

export interface CaptureResult {
  html: string
  css: string
  uids: string[]
  assetFiles: { localPath: string; originalUrl: string }[]
  unavailable: { url: string; reason: string }[]
}

export interface BuildNextActionsOptions {
  parentNodeId: string
  templateId?: string
  position?: 'append' | 'prepend'
}

export function buildNextActions(
  result: CaptureResult,
  options: BuildNextActionsOptions,
): NextAction[] {
  const actions: NextAction[] = []

  if (result.css.trim()) {
    actions.push({
      tool: 'site_apply_css',
      input: { css: result.css },
      description:
        'Apply the captured CSS to the site stylesheet. Run this BEFORE site_insert_html so the inserted nodes have their captured styles when the editor renders them.',
    })
  }

  actions.push({
    tool: 'site_insert_html',
    input: {
      parentNodeId: options.parentNodeId,
      html: result.html,
      position: options.position ?? 'append',
    },
    description:
      'Insert the captured HTML as children of the given parent node. Every element has a uid attribute, so the inserted tree is addressable for further edits.',
  })

  if (result.unavailable.length > 0) {
    actions.push({
      tool: 'log_unavailable_assets',
      input: { assets: result.unavailable },
      description: `${result.unavailable.length} asset(s) could not be fetched. Surface this to the user.`,
    })
  }

  return actions
}
