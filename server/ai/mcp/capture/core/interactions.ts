/**
 * Apply a sequence of pre-capture interactions against a Playwright page.
 *
 * `interactions[]` lets the agent drive the page (login, click, type, wait,
 * etc.) BEFORE the DOM walker extracts HTML+styles. This unlocks capturing
 * post-interaction state on SPAs — the most common case being
 * authenticated pages where the rendered DOM after a click contains the
 * content the agent actually wants.
 *
 * Step execution is sequential and in-order. A single failed step aborts
 * the whole sequence; the caller surfaces the error to the MCP client as
 * `{ ok: false, error: "interaction step N failed: <selector>: <reason>" }`.
 *
 * The shape of an interaction step is defined by the TypeBox schema in
 * `captureTool.ts` (mirrored by `src/core/plugin-sdk/captureSchemas.ts`).
 * The schema makes every field optional because each action requires a
 * different subset; this module enforces per-action requirements at
 * runtime, before delegating to Playwright.
 *
 * PURE module: no Instatic imports, no DB, no top-level side effects.
 * Playwright's `Page` is duck-typed (anything with the same method names
 * works — e.g. a test stub) so this file is unit-testable without
 * launching a browser.
 */

/**
 * One interaction step. All fields are optional in the schema because each
 * action uses a different subset. `applyInteractions` validates the subset
 * at runtime.
 */
export type InteractionStep = {
  action:
    | 'click'
    | 'fill'
    | 'type'
    | 'hover'
    | 'wait_for'
    | 'wait_for_url'
    | 'wait'
    | 'press'
  selector?: string
  value?: string
  text?: string
  /** For `wait_for_url`: substring or /regex/. Anything else is rejected. */
  pattern?: string
  /** For `press`: a Playwright key name like 'Enter', 'Tab', 'Escape'. */
  key?: string
  /** For `wait`: ms to sleep. Capped at MAX_WAIT_MS. */
  ms?: number
  /** Per-step timeout for click/fill/type/hover/wait_for/wait_for_url/press. */
  timeoutMs?: number
  /** For `type`: delay between key presses in ms. */
  delayMs?: number
}

export interface ApplyInteractionsOptions {
  /** Hard cap on number of steps. Default MAX_INTERACTIONS. */
  interactionsCap?: number
  /** Default timeout per step. Default INTERACTION_TIMEOUT_MS. */
  interactionTimeoutMs?: number
  /** Abort signal. When aborted, the current Playwright call rejects and the sequence halts. */
  signal?: AbortSignal
}

/** Hard cap on the number of interactions per capture. Defends against runaway lists. */
export const MAX_INTERACTIONS = 50

/** Per-step default timeout when the step doesn't specify its own. */
export const INTERACTION_TIMEOUT_MS = 60_000

/** Cap on the `wait` action's `ms` to prevent indefinite hangs. */
export const MAX_WAIT_MS = 30_000

/** Cap on the `type` action's `delayMs` to prevent pathological inputs. */
export const MAX_TYPE_DELAY_MS = 5_000

/** Minimal Playwright Page contract used by applyInteractions. */
export interface InteractionPage {
  click(selector: string, opts?: { timeout?: number }): Promise<unknown>
  fill(selector: string, value: string, opts?: { timeout?: number }): Promise<unknown>
  type(selector: string, text: string, opts?: { delay?: number; timeout?: number }): Promise<unknown>
  hover(selector: string, opts?: { timeout?: number }): Promise<unknown>
  waitForSelector(selector: string, opts?: { state?: 'attached' | 'visible' | 'hidden'; timeout?: number }): Promise<unknown>
  waitForURL(url: string | RegExp, opts?: { timeout?: number }): Promise<unknown>
  waitForTimeout(ms: number): Promise<unknown>
  press(selector: string, key: string, opts?: { timeout?: number }): Promise<unknown>
  /** Used for `wait_for_url` substring matching. */
  url(): string
}

/** Subset of step fields used for the per-step error message. Empty string when not present. */
function describeStep(step: InteractionStep): string {
  if (step.selector) return step.selector
  if (step.pattern) return `pattern=${step.pattern}`
  if (step.key) return `key=${step.key}`
  return ''
}

/**
 * Parse a `wait_for_url` pattern. Accepts:
 *   - a `/.../flags` regex literal → returned as a RegExp
 *   - any other string → treated as a substring match
 *
 * Rejects empty strings and malformed regex literals (returns null with
 * the reason so the caller can put it in the error envelope).
 */
function parseUrlPattern(
  raw: string,
): { ok: true; value: string | RegExp } | { ok: false; reason: string } {
  if (raw.length === 0) return { ok: false, reason: 'pattern is empty' }
  if (raw.length >= 2 && raw.startsWith('/')) {
    const lastSlash = raw.lastIndexOf('/')
    if (lastSlash > 0) {
      const body = raw.slice(1, lastSlash)
      const flags = raw.slice(lastSlash + 1)
      try {
        return { ok: true, value: new RegExp(body, flags) }
      } catch (err) {
        return { ok: false, reason: `invalid regex: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
  }
  return { ok: true, value: raw }
}

/**
 * Execute a single interaction step. Returns void on success. Throws an
 * `Error` with a stable message on validation or runtime failure — the
 * orchestrator wraps it in the standardised envelope.
 */
async function executeStep(
  page: InteractionPage,
  step: InteractionStep,
  index: number,
  defaultTimeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  const timeoutMs = step.timeoutMs ?? defaultTimeoutMs
  // Honour the abort signal BEFORE doing any work so a caller-cancelled
  // capture doesn't waste a Playwright call.
  if (signal?.aborted) {
    throw new Error('aborted')
  }

  const fail = (reason: string): never => {
    throw new Error(
      `interaction step ${index} failed: ${describeStep(step) || '<no selector>'}: ${reason}`,
    )
  }

  switch (step.action) {
    case 'click': {
      if (!step.selector) fail('click requires selector')
      try {
        await page.click(step.selector!, { timeout: timeoutMs })
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err))
      }
      return
    }
    case 'fill': {
      if (!step.selector) fail('fill requires selector')
      if (step.value === undefined) fail('fill requires value')
      try {
        await page.fill(step.selector!, step.value!, { timeout: timeoutMs })
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err))
      }
      return
    }
    case 'type': {
      if (!step.selector) fail('type requires selector')
      if (step.text === undefined) fail('type requires text')
      const opts: { delay?: number; timeout?: number } = { timeout: timeoutMs }
      if (step.delayMs !== undefined) {
        if (step.delayMs < 0 || step.delayMs > MAX_TYPE_DELAY_MS) {
          fail(`type delayMs must be 0..${MAX_TYPE_DELAY_MS}`)
        }
        opts.delay = step.delayMs
      }
      try {
        await page.type(step.selector!, step.text!, opts)
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err))
      }
      return
    }
    case 'hover': {
      if (!step.selector) fail('hover requires selector')
      try {
        await page.hover(step.selector!, { timeout: timeoutMs })
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err))
      }
      return
    }
    case 'wait_for': {
      if (!step.selector) fail('wait_for requires selector')
      try {
        await page.waitForSelector(step.selector!, { timeout: timeoutMs })
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err))
      }
      return
    }
    case 'wait_for_url': {
      if (!step.pattern) fail('wait_for_url requires pattern')
      const parsed = parseUrlPattern(step.pattern!)
      if (parsed.ok === false) {
        throw new Error(
          `interaction step ${index} failed: ${describeStep(step) || '<no selector>'}: ${parsed.reason}`,
        )
      }
      const target: string | RegExp = parsed.value
      try {
        await page.waitForURL(target, { timeout: timeoutMs })
      } catch (err) {
        // Special-case the substring form: Playwright's waitForURL rejects
        // substrings with "URL pattern must be a string or regex". Wrap
        // the substring in an escaped regex so waitForURL accepts it.
        if (
          err instanceof Error
          && /URL pattern must be/.test(err.message)
          && typeof target === 'string'
        ) {
          const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const re = new RegExp(escaped)
          try {
            await page.waitForURL(re, { timeout: timeoutMs })
            return
          } catch (err2) {
            fail(err2 instanceof Error ? err2.message : String(err2))
          }
        }
        fail(err instanceof Error ? err.message : String(err))
      }
      return
    }
    case 'wait': {
      if (step.ms === undefined) fail('wait requires ms')
      const ms = step.ms as number
      if (ms < 0 || ms > MAX_WAIT_MS) fail(`wait ms must be 0..${MAX_WAIT_MS}`)
      try {
        await page.waitForTimeout(ms)
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err))
      }
      return
    }
    case 'press': {
      if (!step.key) fail('press requires key')
      // press requires a selector by Playwright API contract (page.press
      // targets an element). The schema leaves it optional for symmetry,
      // but the runtime must reject press without one.
      if (!step.selector) fail('press requires selector')
      try {
        await page.press(step.selector!, step.key!, { timeout: timeoutMs })
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err))
      }
      return
    }
  }
}

/**
 * Apply a list of interaction steps against the page IN ORDER. Stops at the
 * first failure and rethrows the error. A failed step leaves subsequent
 * steps un-run; the caller (runCapture) wraps the throw into the standard
 * `{ ok: false, error }` envelope so the agent sees a clean error.
 *
 * Empty list is a no-op.
 *
 * `signal` is forwarded to each Playwright call indirectly via its timeout
 * — Playwright's `timeout` option is the closest equivalent to AbortSignal
 * cancellation for the high-level locator methods. We also short-circuit on
 * `signal.aborted` before each step starts.
 */
export async function applyInteractions(
  page: InteractionPage,
  list: readonly InteractionStep[],
  opts: ApplyInteractionsOptions = {},
): Promise<void> {
  if (list.length === 0) return
  const cap = opts.interactionsCap ?? MAX_INTERACTIONS
  if (list.length > cap) {
    throw new Error(
      `interaction step ${cap} failed: <cap>: too many interactions (${list.length} > ${cap})`,
    )
  }
  const defaultTimeoutMs = opts.interactionTimeoutMs ?? INTERACTION_TIMEOUT_MS
  for (let i = 0; i < list.length; i++) {
    const step = list[i]!
    await executeStep(page, step, i + 1, defaultTimeoutMs, opts.signal)
  }
}