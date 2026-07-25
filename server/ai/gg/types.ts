/**
 * Narrow boundary for `@kenkaiiii/gg-agent`.
 *
 * The adapter only consumes a handful of types from the upstream package.
 * Re-exporting them here (instead of importing from the package directly)
 *  - keeps the adapter single-import for callers,
 *  - gives us a single point to swap or version-pin the upstream types,
 *  - and prevents the upstream surface from leaking into the Instatic
 *    runtime or test layers.
 *
 * The re-exported subset is exactly what `server/ai/gg/modelAdapter.ts`,
 * `server/ai/gg/siteToolAdapter.ts`, and `server/ai/gg/siteAgentRunner.ts`
 * need. Anything else is intentionally hidden.
 *
 * @see docs/plans/2026-05-26-ai-runtime-rewrite.md → "embedded gg-agent"
 */

// Upstream split: gg-agent re-exports the agent loop surface, gg-ai
// owns the provider + message primitives. Import each from its home.
import type { Provider, Usage, Tool } from '@kenkaiiii/gg-ai'

export type {
  Agent,
  AgentEvent,
  AgentOptions,
  AgentResult,
  AgentStream,
  AgentTool,
  AgentTextDeltaEvent,
  AgentToolCallStartEvent,
  AgentToolCallEndEvent,
  AgentTurnEndEvent,
  AgentRetryEvent,
  AgentErrorEvent,
  AgentDoneEvent,
  AgentToolCallUpdateEvent,
  AgentToolCallDeltaEvent,
  AgentServerToolCallEvent,
  AgentServerToolResultEvent,
  AgentSteeringMessageEvent,
  AgentFollowUpMessageEvent,
  AgentTurnTiming,
  ToolContext,
  ToolExecutionMode,
  ToolExecuteResult,
  StructuredToolResult,
  TransformContextOptions,
  StreamDiagnosticFn,
} from '@kenkaiiii/gg-agent'

export type { Provider, Usage, Tool } from '@kenkaiiii/gg-ai'

// Local helper types — derived from the upstream surface so consumers get
// concrete shapes without reaching into the package.

/** Provider id union from gg-ai. Used to translate Instatic's AiProviderId. */
export type GgProviderId = Provider

/** Per-round usage from gg-ai. Direct pass-through to the runtime's usage event. */
export type GgUsage = Usage

/**
 * Convenience alias for the upstream `Tool` description that gg-agent
 * drivers translate into native provider tool definitions. Use AgentTool
 * when supplying an `execute` function; use Tool when interoperating with
 * a System that exposes only the descriptor.
 */
export type GgToolDefinition = Tool

/**
 * Map an Instatic `AiProviderId` to a gg-ai `Provider` identifier. This is
 * the only place the mapping lives — keep the adapter dependency-free.
 *
 *   anthropic        → 'anthropic'
 *   openai           → 'openai'
 *   openrouter       → 'openrouter'
 *   ollama           → 'openai' (Ollama speaks the openai-compatible SSE dialect)
 *   openai-compatible → 'openai'
 */
export function mapProviderId(instaticProviderId: string): GgProviderId {
  switch (instaticProviderId) {
    case 'anthropic':
      return 'anthropic'
    case 'openai':
      return 'openai'
    case 'openrouter':
      return 'openrouter'
    case 'ollama':
    case 'openai-compatible':
      return 'openai'
    default:
      // Future-proof: fall through to openai as the safest default. The
      // adapter layer surfaces a typed error before any network call.
      return 'openai'
  }
}
