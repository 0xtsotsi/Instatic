/**
 * MCP tool registry — the full set of tools an external MCP client may use,
 * filtered to the connector's granted capabilities.
 *
 * Only `execution: 'server'` tools are exposable: browser-bridged tools need
 * the live editor canvas, which a detached MCP client cannot supply. The
 * filter is by construction, so when a site tool later gains a headless
 * server handler it appears here automatically — no registry change needed.
 *
 * Capability filtering reuses the SAME gate the built-in agent uses
 * (`toolAllowedForCapabilities`): a connector without `ai.tools.write` never
 * sees a mutating tool, and a tool's `requiredCapabilities` (ANY-OF) must be
 * held. An MCP caller can therefore never invoke a tool the granting
 * capabilities couldn't authorize over HTTP.
 */
import type { CoreCapability } from '@core/capabilities'
import type { AiTool } from '../runtime/types'
import { toolAllowedForCapabilities } from '../tools/capabilityGate'
import { contentTools } from '../tools/content'
import { pageTreeMcpTools } from './tools/pageTreeTools'

function allMcpTools(): AiTool[] {
  return [...contentTools, ...pageTreeMcpTools].filter((t) => t.execution === 'server')
}

export function mcpToolsForCapabilities(capabilities: readonly CoreCapability[]): AiTool[] {
  return allMcpTools().filter((t) => toolAllowedForCapabilities(t, capabilities))
}
