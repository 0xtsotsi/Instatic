/**
 * Site agent runner — drives the gg-agent loop and translates its events
 * into Instatic's `AiStreamEvent` wire shape.
 *
 * Lives behind an env flag — see `server/ai/handlers/chat.ts`. The legacy
 * driver loop is the default until the eval set clears; readers can switch
 * via `IN_STATIC_AI_RUNTIME=gg-agent`.
 *
 * Responsibilities (in order):
 *  1. Build the Agent through the model adapter.
 *  2. Compose the system prompt via the skill composer, merged with the
 *     legacy 3-element form.
 *  3. Translate gg-agent events to the existing `AiStreamEvent` wire shape.
 *  4. Persist via the existing `ConversationsPersister` unchanged.
 *  5. Emit exactly one terminal `done` or `error` event before returning.
 *
 * The chat handler still owns:
 *  - the per-conversation writer lock
 *  - the bridge lifecycle
 *  - usage/cost accounting
 *  - audit events
 *  - route-level abort
 *
 * This runner does not unwind any of those — it only translates events.
 */

import type { Agent, AgentEvent, AgentTool } from '@kenkaiiii/gg-agent'
import { buildAgent } from './modelAdapter'
import {
  adaptToolsToAgent,
  bindAdapterContext,
  releaseAdapterContext,
  type AdapterContext,
} from './siteToolAdapter'
import { resolveSkillsForScope } from '../skills/catalog'
import { composeSystemPrompt } from '../skills/compose'
import { PRODUCT_SKILL_DIRECTORY } from '../skills/catalog'
import type { AiMessage, AiStreamEvent, AiTool } from '../runtime/types'
import type { AiResolvedCredential } from '../drivers/types'
import type { ConversationsPersister } from '../runtime/persister'
import { INTERRUPTED_TOOL_RESULT_ERROR } from '@core/ai'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunSiteAgentArgs {
  /** The agent's per-request invocation loop. */
  readonly credential: AiResolvedCredential
  readonly modelId: string
  readonly messages: ReadonlyArray<AiMessage>
  /** The 3-element cache form from the legacy system-prompt builder. */
  readonly systemPrompt: string[]
  /** Scope-filtered tools (already capability-gated). */
  readonly tools: ReadonlyArray<AiTool>
  readonly signal: AbortSignal
  readonly supportsImages: boolean
  readonly persister: ConversationsPersister
  readonly adapterContext: AdapterContext
  readonly emit: (event: AiStreamEvent) => void
  /** Scope: 'site' | 'content' | 'data' | 'plugin'. */
  readonly scope: string
  /** Optional override for the skill directory (tests). */
  readonly skillDir?: string
  /**
   * Test-only override of the gg-ai provider id. When set, the model
   * adapter uses this provider id instead of the one derived from the
   * credential. Production callers never set this.
   */
  readonly providerIdOverride?: string
}

/**
 * Run one site-scope chat turn through gg-agent. The terminal `done`
 * event is always emitted unless the agent surfaced an error event.
 */
export async function runSiteAgent(args: RunSiteAgentArgs): Promise<void> {
  const skills = await resolveSkillsForScope(args.scope, args.skillDir ?? PRODUCT_SKILL_DIRECTORY)
  const composedPrompt = composeSystemPrompt({
    operatingRules: args.systemPrompt.join('\n\n'),
    skills,
    snapshotSummary: '',
  })
  const agentTools: AgentTool[] = adaptToolsToAgent(args.tools)
  bindAdapterContext(args.tools, args.adapterContext)
  try {
    const effectiveCredential = args.providerIdOverride
      ? {
          ...args.credential,
          providerId: args.providerIdOverride as typeof args.credential.providerId,
        }
      : args.credential
    const agent = buildAgent({
      credential: effectiveCredential,
      modelId: args.modelId,
      messages: args.messages,
      systemPrompt: composedPrompt,
      tools: agentTools,
      signal: args.signal,
      supportsImages: args.supportsImages,
      providerOverride: args.providerIdOverride,
    })
    await driveAgentLoop(agent, args)
  } finally {
    releaseAdapterContext(args.tools)
  }
}

// ---------------------------------------------------------------------------
// Event translation
// ---------------------------------------------------------------------------

/**
 * Drive the agent loop and translate each gg-agent event into an
 * Instatic `AiStreamEvent`. The translation preserves IDs, the
 * text/tool-call chronology, and the network/cost information.
 *
 * The state machine below mirrors the legacy `runChat` so the wire
 * shape is identical no matter which runtime is selected.
 */
async function driveAgentLoop(agent: Agent, args: RunSiteAgentArgs): Promise<void> {
  const { emit, persister, signal } = args
  let pendingAssistantText = ''
  const pendingToolCalls = new Map<string, { name: string }>()

  async function flushAssistantText(): Promise<void> {
    if (!pendingAssistantText) return
    const text = pendingAssistantText
    pendingAssistantText = ''
    await persister.appendAssistantText(text)
  }

  async function finalizePendingToolCalls(): Promise<void> {
    for (const [toolCallId, pending] of pendingToolCalls) {
      const ev: AiStreamEvent = {
        type: 'toolResult',
        toolCallId,
        toolName: pending.name,
        ok: false,
        error: INTERRUPTED_TOOL_RESULT_ERROR,
      }
      await persister.appendToolResult({
        toolCallId,
        toolName: pending.name,
        ok: false,
        error: INTERRUPTED_TOOL_RESULT_ERROR,
      })
      emit(ev)
    }
    pendingToolCalls.clear()
  }

  let terminalEmitted = false
  const emitTerminal = (event: AiStreamEvent) => {
    if (terminalEmitted) return
    terminalEmitted = true
    emit(event)
  }
  try {
    const stream = agent.prompt('')
    for await (const event of stream as AsyncIterable<AgentEvent>) {
      if (signal.aborted && !terminalEmitted) {
        // Wire an abort as a terminal error if the upstream hasn't already.
        await flushAssistantText().catch(() => {
          /* noop */
        })
        await finalizePendingToolCalls().catch(() => {
          /* noop */
        })
        emitTerminal({ type: 'error', message: 'AI chat aborted.' })
        return
      }
      // Translate the event.
      await translateEvent(event, {
        pendingAssistantText,
        setAssistantText: (t) => {
          pendingAssistantText = t
        },
        pendingToolCalls,
        persister,
        emit,
        signal,
      })
      // Re-read the closure-side pending text after translation.
      if (event.type === 'text_delta') {
        pendingAssistantText += event.text
      }
    }
    await flushAssistantText()
    await finalizePendingToolCalls()
    emitTerminal({ type: 'done' })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[ai/gg-runner] agent loop threw:', err)
    await flushAssistantText().catch(() => {
      /* noop */
    })
    await finalizePendingToolCalls().catch(() => {
      /* noop */
    })
    emitTerminal({ type: 'error', message: `AI runtime error: ${detail}` })
  }
}

interface TranslateCtx {
  pendingAssistantText: string
  setAssistantText(t: string): void
  pendingToolCalls: Map<string, { name: string }>
  persister: ConversationsPersister
  emit(event: AiStreamEvent): void
  signal: AbortSignal
}

async function translateEvent(event: AgentEvent, ctx: TranslateCtx): Promise<void> {
  switch (event.type) {
    case 'text_delta': {
      ctx.emit({ type: 'text', text: event.text })
      return
    }
    case 'tool_call_start': {
      // Flush any accumulated assistant text before the new tool call.
      if (ctx.pendingAssistantText) {
        const text = ctx.pendingAssistantText
        ctx.setAssistantText('')
        await ctx.persister.appendAssistantText(text)
      }
      await ctx.persister.appendToolCall({
        toolCallId: event.toolCallId,
        toolName: event.name,
        input: event.args,
      })
      ctx.pendingToolCalls.set(event.toolCallId, { name: event.name })
      ctx.emit({
        type: 'toolCall',
        toolCallId: event.toolCallId,
        toolName: event.name,
        input: event.args,
        status: 'pending',
      })
      return
    }
    case 'tool_call_end': {
      const pending = ctx.pendingToolCalls.get(event.toolCallId)
      ctx.pendingToolCalls.delete(event.toolCallId)
      await ctx.persister.appendToolResult({
        toolCallId: event.toolCallId,
        toolName: pending?.name ?? '',
        ok: !event.isError,
        error: event.isError ? event.result : undefined,
      })
      ctx.emit({
        type: 'toolResult',
        toolCallId: event.toolCallId,
        toolName: pending?.name ?? '',
        ok: !event.isError,
        error: event.isError ? event.result : undefined,
      })
      return
    }
    case 'turn_end': {
      const usage = event.usage
      const costUsd = await ctx.persister.recordUsage({
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheRead ?? 0,
        cacheCreationTokens: usage.cacheWrite ?? 0,
      })
      ctx.emit({
        type: 'usage',
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        costUsd,
        cacheReadTokens: usage.cacheRead ?? 0,
        cacheCreationTokens: usage.cacheWrite ?? 0,
      })
      ctx.emit({
        type: 'context',
        promptTokens: usage.inputTokens,
        cacheReadTokens: usage.cacheRead ?? 0,
        cacheCreationTokens: usage.cacheWrite ?? 0,
      })
      return
    }
    case 'retry': {
      // Best-effort diagnostic surface — the wire schema doesn't have a
      // retry event, so we drop it silently. Operators see upstream logs.
      return
    }
    case 'error': {
      throw event.error
    }
    // agent_done, server_tool_call, follow_up_message, etc. — terminal/state
    // events we don't translate. The agent loop's terminal 'done' is
    // detected by the surrounding drainer.
    default:
      return
  }
}
