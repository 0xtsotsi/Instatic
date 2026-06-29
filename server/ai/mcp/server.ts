/**
 * Build a capability-scoped MCP `Server` over Instatic's existing tool engine.
 *
 * We use the low-level SDK `Server` + `setRequestHandler` (not the higher-level
 * `McpServer.registerTool`, which requires Zod schemas — banned repo-wide).
 * This lets us advertise our canonical TypeBox `inputSchema` verbatim as JSON
 * Schema (exactly as the AI drivers send it to providers) and run each call
 * through `executeAiTool`, which already does TypeBox input validation, a
 * capability re-check, and `{ ok, data | error }` normalisation.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { DbClient } from '../../db/client'
import type { CoreCapability } from '@core/capabilities'
import type { AiBrowserBridge, AiTool } from '../runtime/types'
import { executeAiTool } from '../drivers/http/execTool'
import { mcpToolsForCapabilities } from './registry'

export interface McpServerContext {
  db: DbClient
  userId: string
  connectorId: string
  capabilities: readonly CoreCapability[]
}

// MCP only ever registers `execution: 'server'` tools, so the bridge is never
// invoked. It exists solely to satisfy the `executeAiTool` signature.
const NOOP_BRIDGE: AiBrowserBridge = {
  callBrowser: async () => {
    throw new Error('[ai:mcp] browser-execution tools are not available over MCP')
  },
}

export function buildMcpServer(ctx: McpServerContext): Server {
  const server = new Server(
    { name: 'instatic', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  const tools = mcpToolsForCapabilities(ctx.capabilities)
  const byName = new Map<string, AiTool>(tools.map((t) => [t.name, t]))

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      // Our TypeBox object schema IS a valid JSON-Schema tool definition.
      inputSchema: t.inputSchema as { type: 'object' } & Record<string, unknown>,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params
    const tool = byName.get(name)
    if (!tool) {
      return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
    }

    const controller = new AbortController()
    const output = await executeAiTool(tool, args ?? {}, NOOP_BRIDGE, controller.signal, {
      db: ctx.db,
      userId: ctx.userId,
      capabilities: ctx.capabilities,
      scope: 'content',
      conversationId: `mcp:${ctx.connectorId}`,
      snapshot: null,
    })

    if (!output.ok) {
      return { isError: true, content: [{ type: 'text', text: output.error ?? 'Tool failed.' }] }
    }
    return { content: [{ type: 'text', text: JSON.stringify(output.data ?? null) }] }
  })

  return server
}
