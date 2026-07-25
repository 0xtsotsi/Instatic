/**
 * Adapter: turn an Instatic `AiStreamRequest` into a `new Agent({...})` call.
 *
 * The adapter is the only place where Instatic's runtime types meet
 * `@kenkaiiii/gg-agent`. It:
 *
 *  1. Maps the Instatic `providerId` to a gg-ai `Provider` string.
 *  2. Projects the conversation history into gg-ai's `Message` shape.
 *  3. Picks the right auth path (`apiKey` vs `baseUrl`) without ever
 *     embedding the secret in the prompt or any client-visible state.
 *  4. Threads the per-request `AbortSignal` so a client disconnect —
 *     upstream and downstream — cleanly cancels the agent loop.
 *  5. Forwards the model capabilities (vision, tool calling) so the
 *     agent downgrades ineligible content before the model call.
 *
 * The adapter does NOT touch the db, the persister, or the bridge —
 * those remain owned by the chat handler. Phase 1 ships the model
 * adapter only; the runner wires it up in Phase 4.
 */

import { Agent, type AgentOptions, type AgentTool } from '@kenkaiiii/gg-agent'
import type { Message } from '@kenkaiiii/gg-ai'
import { mapProviderId } from './types'
import type { AiMessage } from '../runtime/types'
import type { AiResolvedCredential } from '../drivers/types'
import type { AiTool } from '../runtime/types'

// ---------------------------------------------------------------------------
// Public inputs
// ---------------------------------------------------------------------------

export interface BuildAgentArgs {
  /** Instatic-side resolved credential (decrypted once by the chat handler). */
  readonly credential: AiResolvedCredential
  /** Provider-independent model id (e.g. "claude-sonnet-4-5", "gpt-4o"). */
  readonly modelId: string
  /** Conversation history projected into gg-ai's Message shape. */
  readonly messages: ReadonlyArray<AiMessage>
  /**
   * The 3-element system prompt form — [staticPrefix, BOUNDARY, suffix] —
   * already produced by the legacy system-prompt builder. Joined with
   * newlines here; gg-ai has no native cache_control boundary so the
   * marker is informational only.
   */
  readonly systemPrompt: string[]
  /** Tools already filtered by `selectToolsForScope` (capability-gated). */
  readonly tools: AgentTool[]
  /** Per-request abort signal — wires through to the provider stream. */
  readonly signal: AbortSignal
  /** True when the model accepts image content blocks. */
  readonly supportsImages: boolean
  /** True when the model accepts video content blocks. Default false. */
  readonly supportsVideo?: boolean
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build (but do not start) an `Agent` ready to drive one chat turn.
 *
 * Returns an `Agent` you can `.prompt(content)` and iterate the resulting
 * `AgentStream`. The chat handler is responsible for the lifecycle of the
 * signal, the bridge, and the response stream.
 */
export function buildAgent(args: BuildAgentArgs): Agent {
  const options = buildAgentOptions(args)
  return new Agent(options)
}

/**
 * Build the `AgentOptions` without instantiating. Useful for tests that
 * inspect the wiring (provider, signal, model) without spinning the agent
 * loop.
 */
export function buildAgentOptions(args: BuildAgentArgs): AgentOptions {
  const provider = mapProviderId(args.credential.providerId)
  const messages = projectMessages(args.messages)
  const system = composeSystemPrompt(args.systemPrompt)
  const auth = resolveAuth(args.credential)
  return {
    provider,
    model: args.modelId,
    priorMessages: messages,
    system,
    tools: args.tools,
    signal: args.signal,
    supportsImages: args.supportsImages,
    supportsVideo: args.supportsVideo ?? false,
    ...auth,
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Resolve auth fields the provider actually consumes. Two cases:
 *  - `apiKey`  → `apiKey` set, `baseUrl` omitted
 *  - `baseUrl` → `baseUrl` set, optional bearer `apiKey`
 *
 * The provider secret is NEVER lifted into the prompt contents or any
 * other client-visible surface — it lives only on the AgentOptions where
 * gg-ai's stream function picks it up for the outbound HTTP request.
 */
function resolveAuth(credential: AiResolvedCredential): {
  apiKey?: string
  baseUrl?: string
} {
  if (credential.authMode === 'apiKey') {
    return credential.apiKey ? { apiKey: credential.apiKey } : {}
  }
  // baseUrl mode — bearer is optional.
  const auth: { apiKey?: string; baseUrl?: string } = {}
  if (credential.baseUrl) auth.baseUrl = credential.baseUrl
  if (credential.apiKey) auth.apiKey = credential.apiKey
  return auth
}

/**
 * Project an Instatic AiMessage history into gg-ai's Message shape.
 *
 * AiMessage uses the OpenAI/Anthropic-style content-block array;
 * Message uses a tagged union. For phase 1 we only round-trip the
 * 4 kinds the existing Instatic runtime emits:
 *
 *  - user: text + image blocks
 *  - assistant: text + tool_call blocks (no tool_result here)
 *  - tool: tool_result blocks
 *  - system: plain string
 *
 * Tool result blocks are split into a single `tool` message per call id
 * to match gg-ai's flat schema.
 *
 * Anything we don't understand is dropped — the legacy driver loop
 * guarantees the runtime never emits content we can't represent.
 */
export function projectMessages(history: ReadonlyArray<AiMessage>): Message[] {
  const out: Message[] = []
  for (const msg of history) {
    switch (msg.role) {
      case 'system': {
        out.push({ role: 'system', content: msg.content })
        break
      }
      case 'user': {
        const content = msg.content
          .map((b) => {
            if (b.kind === 'text') return { type: 'text' as const, text: b.text }
            if (b.kind === 'image') {
              return { type: 'image' as const, mediaType: b.mimeType, data: b.data }
            }
            return null
          })
          .filter((p): p is NonNullable<typeof p> => p !== null)
        if (content.length === 0) continue
        out.push({ role: 'user', content: content as Message extends { role: 'user' } ? typeof content : never })
        break
      }
      case 'assistant': {
        const parts: Array<{ type: 'text'; text: string } | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }> = []
        for (const b of msg.content) {
          if (b.kind === 'text') {
            parts.push({ type: 'text', text: b.text })
          } else if (b.kind === 'toolCall') {
            parts.push({
              type: 'tool_call',
              id: b.toolCallId,
              name: b.toolName,
              args: (b.input ?? {}) as Record<string, unknown>,
            })
          }
        }
        if (parts.length === 0) continue
        out.push({ role: 'assistant', content: parts })
        break
      }
      case 'tool': {
        const tr = msg.output
        // Instatic's AiToolOutput shape: { ok, data?, error?, images? }.
        // We map the text payload into the upstream ToolResult shape and
        // surface errors as `isError: true`.
        const textFromData = typeof tr.data === 'string'
          ? tr.data
          : tr.data !== undefined
            ? JSON.stringify(tr.data)
            : tr.error ?? (tr.ok ? 'Tool returned no content.' : 'Tool call failed.')
        out.push({
          role: 'tool',
          content: [{
            type: 'tool_result',
            toolCallId: msg.toolCallId,
            content: [{ type: 'text' as const, text: textFromData }],
            isError: !tr.ok,
          }],
        })
        break
      }
    }
  }
  return out
}

/**
 * Compose the 3-element system prompt (legacy cache-control shape) into a
 * single string. The boundary marker is dropped — gg-ai has no native
 * cache_control, so the prefix information is preserved as just the joined
 * text. The background skill scaffolding (Phase 3) will inject additional
 * layers here.
 */
function composeSystemPrompt(form: string[]): string {
  if (form.length === 0) return ''
  // The runtime always emits the 3-element form `[prefix, BOUNDARY, suffix]`.
  // Concatenate, dropping the boundary marker. If the caller passes a flat
  // single-string, surface it unchanged.
  if (form.length === 1) return form[0]
  return [form[0], form[2]].filter((s): s is string => typeof s === 'string' && s.length > 0).join('\n\n')
}

/**
 * Build an no-op AgentTool shell. Used by the test runner to satisfy
 * `AgentOptions.tools` when the runtime asks the agent to operate
 * without a toolset (Phase 1b: text-only turn).
 */
export function _noopAgentTool(): AgentTool {
  return {
    name: 'noop',
    description: 'Stub tool — never called. Used for text-only smoke tests.',
    parameters: {
      // A trivial zod schema that accepts nothing.
      parse: () => ({}),
      safeParse: () => ({ success: true, data: {} }),
      _def: { typeName: 'ZodObject' },
    } as unknown as AgentTool['parameters'],
    execute: () => '',
  }
}

/**
 * Place the legacy driver's `selectToolsForScope` output through the
 * AgentTool projector. Implemented in `siteToolAdapter.ts`; this module
 * only declares the seam so the test can guard the surface.
 */
export type ProjectAiToolsFn = (tools: ReadonlyArray<AiTool>) => AgentTool[]
