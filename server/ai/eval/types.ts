/**
 * Phase 5 evaluation types.
 *
 * A `Scenario` is a fixed prompt + rubric. A `RunResult` is what a single
 * runtime produced on a single scenario. The harness produces one report
 * per (scenario, runtime) pair, then the score step diffs the two.
 *
 * No runtime-specific types here — fixtures and report must stay
 * provider-agnostic so the same JSON can be replayed against a real
 * provider later without schema drift.
 */

export type RuntimeKind = 'legacy' | 'gg-agent'

/**
 * Rubric — a small, fixed checklist. The harness scores each item to
 * 0/1/2 (0 missing, 1 partial, 2 met). Total is summed in the report.
 * Real visual review is a separate, human step.
 */
export interface RubricItem {
  readonly id: string
  readonly label: string
  /** Free-form guidance for the human reviewer. */
  readonly guidance: string
}

export interface Scenario {
  readonly id: string
  readonly title: string
  /** One-paragraph description; appears in the report. */
  readonly description: string
  /** The user prompt sent to the site agent. */
  readonly prompt: string
  /** A minimal pre-snapshot representing the editor state. */
  readonly preSnapshot: {
    readonly pageTitle: string
    readonly sections: ReadonlyArray<{ readonly kind: string; readonly text: string }>
  }
  /** Capabilities the scenario requires. Used to gate tools. */
  readonly expectedCapabilities: ReadonlyArray<string>
  readonly rubric: ReadonlyArray<RubricItem>
}

/** Per-scenario outcome produced by the harness. */
export interface RunResult {
  readonly scenarioId: string
  readonly runtime: RuntimeKind
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
  /** Stream events captured (in order). */
  readonly events: ReadonlyArray<{
    readonly type: string
    /** Tool call id when type === 'toolCall' or 'toolResult'. */
    readonly toolCallId?: string
    /** True when the event was a terminal 'done' or 'error'. */
    readonly terminal?: boolean
  }>
  readonly toolCalls: {
    readonly total: number
    readonly succeeded: number
    readonly failed: number
    readonly aborted: number
  }
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly costUsd: number
  }
  readonly rubricScores: ReadonlyArray<{ readonly id: string; readonly score: 0 | 1 | 2 }>
  readonly renderPaths: {
    readonly desktop: string
    readonly mobile: string
  }
  /** Free-form notes from the harness (warnings, anomalies). */
  readonly notes: ReadonlyArray<string>
}

/** Top-level report written to disk. */
export interface EvalReport {
  readonly generatedAt: string
  /** Mock-only report unless overridden by env. */
  readonly mode: 'mock' | 'live'
  readonly runs: ReadonlyArray<RunResult>
}
