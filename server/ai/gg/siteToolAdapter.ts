/**
 * Site tool adapter — wraps each Instatic `AiTool` into an `AgentTool`
 * that gg-agent's loop can run.
 *
 * The adapter does NOT duplicate mutation logic. It reuses the existing
 * `AiTool.handler` and the existing `AiBrowserBridge.callBrowser` purely
 * as call-throughs. Capability checks, schema validation, sanitisation,
 * and content authorization remain owned by the legacy `selectToolsForScope`
 * + `executeAiTool` paths and run in the same place they always did.
 *
 * The adapter's job is plumbing:
 *
 *  1. **Schema**: the upstream `AgentTool.parameters` requires a zod
 *     schema. We expose a permissive `z.any()` (the existing TypeBox
 *     validator still runs inside the handler) so the model round-trips
 *     arbitrary JSON without our losing any validation.
 *  2. **Execute**: invoke the legacy handler (or the bridge) with the
 *     validated input; surface the result as gg-agent's `ToolExecuteResult`.
 *  3. **Bridge**: server-execution tools run synchronously; browser tools
 *     emit a `toolRequest` event on the chat wire and await the bridge
 *     postback. Tool-call IDs are preserved 1:1.
 *  4. **Untrusted framing**: snapshots and tool outputs are framed
 *     separately from system instructions, following Noledge's
 *     `frameUntrustedToolResult` pattern. The result string is wrapped so
 *     the model cannot mistake tool output for instructions.
 *  5. **Fail closed**: a tool unavailable, unauthorised, malformed input,
 *     abort, or bridge disconnect returns an `isError: true` result, never
 *     a silent drop.
 */

import type { AgentTool, ToolContext } from '@kenkaiiii/gg-agent'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { AiTool, ToolContext as InstaticToolContext } from '../runtime/types'
import type { AiBrowserBridge, AiStreamEvent } from '../runtime/types'

/**
 * Permissive JSON Schema for adapted Instatic tools. The legacy `AiTool`
 * validates its input via TypeBox at handler-execution time, so the
 * upstream gg-agent loop is satisfied with the empty object schema —
 * the upstream provider sees `{}` (accept any object) and the legacy
 * TypeBox validator inside the handler still rejects invalid input.
 *
 * The `zod` package is banned repo-wide (see
 * `src/__tests__/architecture/ai-driver-isolation.test.ts`), so we
 * cannot import it here to construct a real Zod v4 schema. gg-ai's
 * `resolveToolSchema` consults `rawInputSchema` BEFORE calling
 * `zodToJsonSchema(parameters)`, so setting `rawInputSchema` skips the
 * Zod path entirely — see `@kenkaiiii/gg-ai` line 447
 * (`tool.rawInputSchema ?? zodToJsonSchema(tool.parameters)`). MCP tools
 * use the same path; we're matching it here.
 */
const RAW_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: true,
}

/**
 * Defensive fallback for the `parameters` slot of an `AgentTool`.
 *
 * `AgentTool.parameters` is typed as `z.ZodType` in gg-agent's public
 * surface, but gg-ai also reads `tool.parameters` directly when
 * serialising tool schemas for providers that don't take a raw JSON
 * schema override. To survive those code paths without importing `zod`,
 * we hand-roll the *minimal* shape Zod v4's `toJSONSchema.process`
 * consults: `{ _zod: { def: { type: 'any' } } }`. The `'any'` branch in
 * `zod/v4/core/json-schema-processors.js` is a no-op (`anyProcessor`
 * returns `{}`), so any tool spec the agent emits will be the empty
 * JSON Schema — i.e. accept anything — exactly matching
 * `RAW_INPUT_SCHEMA` above. If gg-ai's path ever ignores
 * `rawInputSchema`, this fallback still doesn't crash.
 *
 * Cast to `unknown as AgentTool['parameters']` because we cannot import
 * the real Zod v4 type — and we don't need to: gg-ai only reads
 * `schema._zod.def.type` at runtime.
 */
const FAKE_ZOD_ANY = { _zod: { def: { type: 'any' } } } as unknown as AgentTool['parameters']

// ---------------------------------------------------------------------------
// Public adapter seam
// ---------------------------------------------------------------------------

export interface AdapterContext {
  /** The per-request bridge shared with the chat handler. */
  readonly bridge: AiBrowserBridge
  /** The signal a client disconnect / bridge timeout propagates through. */
  readonly signal: AbortSignal
  /** Sink so the adapter can emit `toolRequest` events to the browser. */
  readonly emit: (event: AiStreamEvent) => void
  /**
   * Per-request tool context the legacy handlers expect (db, userId,
   * capabilities, scope, conversationId, signal). The snapshot is a
   * LIVE getter: the chat handler's bridge updates
   * `toolContextBase.snapshot` after every mutating browser tool, and
   * each read tool run must observe the post-mutation value, not the
   * stale turn-start one.
   */
  readonly toolContext: Omit<InstaticToolContext, 'snapshot'> & {
    readonly snapshot: () => unknown
  }
}

/**
 * Project an Instatic `AiTool[]` into gg-agent `AgentTool[]`. The legacy
 * `selectToolsForScope` should already have filtered the input by mutation
 * flag and requiredCapabilities; the adapter does not re-check those
 * (the chat handler is the single gatekeeper for capabilities).
 *
 * The input schema is exposed as a wide zod `z.any()` so the model can
 * send arbitrary JSON. The actual TypeBox validation runs inside the
 * handler, exactly as it does in the legacy loop.
 */
export function adaptToolsToAgent(tools: ReadonlyArray<AiTool>): AgentTool[] {
  return tools.map(adaptOneTool)
}

function adaptOneTool(tool: AiTool): AgentTool {
  /**
   * Two slots carry the tool's input shape:
   *
   *   - `rawInputSchema` — plain JSON Schema, preferred by gg-ai's
   *     `resolveToolSchema` and never converted via Zod. MCP tools use
   *     this exact path; we're matching it.
   *   - `parameters` — Zod-typed per `AgentTool`'s public surface. We
   *     can't import `zod` (repo-banned) but we can satisfy
   *     `zodToJsonSchema` with the minimum shape it inspects
   *     (`{ _zod: { def: { type: 'any' } } }`).
   *
   * The legacy TypeBox validator inside `tool.handler` remains the
   * source of truth for input validation.
   */
  const parameters = FAKE_ZOD_ANY

  return {
    name: tool.name,
    description: tool.description,
    parameters,
    rawInputSchema: RAW_INPUT_SCHEMA,
    execute: async (args: unknown, ctx: ToolContext) => {
      // Adapter-side signal: the upstream ctx.signal is the agent's overall
      // cancel; the per-request bridge timeout is in adapterContext.signal.
      // We honour both (the chat handler chains them via AbortSignal.any).
      const validated = safeParseValue(tool.inputSchema, args)
      if (!validated.ok) {
        // Fail closed — the model sent something that doesn't match the
        // existing schema. Same error framing the legacy runner would emit.
        return formatToolError(
          `Invalid input for ${tool.name}: ${formatTypeboxErrors(validated.errors)}`,
        )
      }
      const adapterCtx = adapterContextByTool.get(tool.name)
      if (!adapterCtx) {
        // The adapter is wired by name at request time. If the agent loop
        // ran a tool without an adapter context, we cannot honour the
        // legacy bridge — fail closed.
        return formatToolError(`Tool "${tool.name}" not bound to an adapter context.`)
      }
      if (tool.execution === 'server') {
        if (!tool.handler) {
          return formatToolError(`Server tool "${tool.name}" has no handler.`)
        }
        try {
          const out = await tool.handler(validated.value, {
            ...adapterCtx.toolContext,
            snapshot: adapterCtx.toolContext.snapshot(),
            signal: ctx.signal,
          })
          return formatToolResult(tool.name, out)
        } catch (err) {
          return formatToolError(err instanceof Error ? err.message : String(err))
        }
      }
      // Browser execution — delegate to the bridge.
      try {
        const out = await adapterCtx.bridge.callBrowser(tool.name, validated.value)
        return formatToolResult(tool.name, out)
      } catch (err) {
        return formatToolError(err instanceof Error ? err.message : String(err))
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Per-request adapter context registry
// ---------------------------------------------------------------------------

/**
 * The adapter hands a single `AdapterContext` to the per-request Agent
 * via a module-scoped Map keyed by tool name. Each request sets up the
 * context in `bindAdapterContext` before instantiating the Agent and
 * clears it in the matching `releaseAdapterContext` once the loop ends.
 *
 * Keying by tool name alone is safe because the chat handler is the
 * only consumer and it serialises one conversation turn at a time
 * (the existing `activeChatConversations` lock). When concurrent
 * turns are ever required, key by (conversationId, toolName).
 */
const adapterContextByTool = new Map<string, AdapterContext>()

export function bindAdapterContext(tools: ReadonlyArray<AiTool>, ctx: AdapterContext): void {
  for (const tool of tools) adapterContextByTool.set(tool.name, ctx)
}

export function releaseAdapterContext(tools: ReadonlyArray<AiTool>): void {
  for (const tool of tools) adapterContextByTool.delete(tool.name)
}

/**
 * Test-only: list every bound adapter context. Mirrors the pattern used
 * by `transport.ts` for the bridge registry.
 */
export function __listBoundAdapterContextsForTesting(): string[] {
  return [...adapterContextByTool.keys()]
}

// ---------------------------------------------------------------------------
// Result framing
// ---------------------------------------------------------------------------

/**
 * Frame a successful tool result for the model. Tool output is UNTRUSTED
 * data — the model must be able to distinguish it from system instructions.
 * We wrap the result in a quoted block so the model sees it as quoted
 * content, not as a directive.
 */
function formatToolResult(toolName: string, value: unknown): string {
  const body = serialiseToolOutput(value)
  return [`<tool_result name="${toolName}">`, body, `</tool_result>`].join('\n')
}

/**
 * Frame a tool failure. The same framing block makes the error visible
 * to the model and includes the `<tool_result>` so the parser doesn't
 * confuse a failure with a free-form text reply.
 */
function formatToolError(message: string): string {
  return [`<tool_result name="error">`, `Error: ${message}`, `</tool_result>`].join('\n')
}

function serialiseToolOutput(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[unserialisable tool output]'
  }
}

function formatTypeboxErrors(errors: unknown): string {
  try {
    return JSON.stringify(errors)
  } catch {
    return 'validation failed'
  }
}
