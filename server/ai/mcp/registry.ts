/**
 * MCP tool registry — the full set of tools an external MCP client may use,
 * filtered to the connector's granted capabilities.
 *
 * Two execution classes are exposed:
 *   - server-resolved tools (content reads, `read_page_tree`, `mutate_page_tree`)
 *     run in-process and work with NO editor open;
 *   - browser tools (HTML/CSS authoring, design tokens, page lifecycle, content
 *     CRUD, code assets, live-DOM reads) are relayed to the connector owner's
 *     open editor via the live editor bridge (`./editorBridge`). If no editor is
 *     connected, the call returns a clear error telling the agent to open it.
 *
 * Capability filtering reuses the SAME gate the built-in agent uses
 * (`toolAllowedForCapabilities`): a connector without `ai.tools.write` never
 * sees a mutating tool, and a tool's `requiredCapabilities` (ANY-OF) must be
 * held. An MCP caller can never invoke a tool the granting capabilities
 * couldn't authorize over HTTP.
 */
import type { CoreCapability } from '@core/capabilities'
import type { AiTool } from '../runtime/types'
import { toolAllowedForCapabilities } from '../tools/capabilityGate'
import { contentTools } from '../tools/content'
import { siteTools } from '../tools/site'
import { pageTreeMcpTools } from './tools/pageTreeTools'

function allMcpTools(): AiTool[] {
  // De-dup by tool name. Order matters: the headless page-tree + content tools
  // win over the site toolset for any shared name (e.g. `list_documents`), so
  // the version that works without an open editor is the one exposed.
  const ordered = [...pageTreeMcpTools, ...contentTools, ...siteTools]
  const byName = new Map<string, AiTool>()
  for (const tool of ordered) {
    if (!byName.has(tool.name)) byName.set(tool.name, tool)
  }
  return [...byName.values()]
}

export function mcpToolsForCapabilities(capabilities: readonly CoreCapability[]): AiTool[] {
  return allMcpTools().filter((t) => toolAllowedForCapabilities(t, capabilities))
}
