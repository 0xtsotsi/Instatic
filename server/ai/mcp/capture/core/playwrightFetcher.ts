/**
 * Production fetcher for the capture tool. Owns a process-wide Playwright
 * browser singleton (`getSharedBrowser()`) so concurrent MCP calls don't
 * each spin up a fresh Chromium. `createPlaywrightFetcher()` opens a fresh
 * browser context per fetch — that's the cheap part, and it gives every
 * caller an isolated session (cookies, storage, etc.).
 *
 * The walker itself runs in the page's V8 via `page.evaluate`. The
 * page-side walker source lives in `domExtractor.ts` as
 * `PAGE_WALKER_SOURCE`; the fetcher inlines it into a self-invoking
 * function expression with the walker args JSON-baked at the call
 * site. Playwright serialises string expressions by source and runs
 * them in the page's V8. The pure TypeScript walker (`extractDom`)
 * and the page-side source must stay in lock-step.
 *
 * The fetcher is dynamically imported so the rest of the module graph
 * does not pay for the Playwright binary until a real fetch is requested.
 */
import {
  COMPUTED_PROPS,
  PAGE_WALKER_SOURCE,
  type CaptureTarget,
  type ExtractedNode,
} from './domExtractor'
import {
  applyInteractions,
  INTERACTION_TIMEOUT_MS,
  MAX_INTERACTIONS,
  type InteractionStep,
} from './interactions'

export interface PlaywrightFetcherOptions {
  /** Browser engine. Default 'chromium'. */
  browser?: 'chromium' | 'firefox' | 'webkit'
  /** ms to wait for networkidle after navigation. Default 5000. */
  networkIdleMs?: number
  /** Total navigation timeout. Default = networkIdleMs + 5000. */
  navigationTimeoutMs?: number
  /** Optional exact/one-label-wildcard host allowlist applied to every browser request. */
  allowedHosts?: string[]
}

/** Per-fetch options that vary per call (as opposed to PlaywrightFetcherOptions
 * which configures the browser/engine). Carries the interaction list and
 * per-step caps that the orchestrator passes in. */
export interface FetchOptions {
  /** Pre-capture interactions applied AFTER goto and BEFORE the DOM walker. */
  interactions?: readonly InteractionStep[]
  /** Cap on number of interactions. Default MAX_INTERACTIONS (50). */
  interactionsCap?: number
  /** Default per-step timeout in ms. Default INTERACTION_TIMEOUT_MS (60_000). */
  interactionTimeoutMs?: number
}

function hostMatchesAllowlist(host: string, allowedHosts: ReadonlyArray<string>): boolean {
  const lower = host.toLowerCase()
  return allowedHosts.some((entry) => {
    const allowed = entry.toLowerCase()
    if (!allowed.startsWith('*.')) return lower === allowed
    const suffix = `.${allowed.slice(2)}`
    if (!lower.endsWith(suffix)) return false
    const prefix = lower.slice(0, -suffix.length)
    return prefix.length > 0 && !prefix.includes('.')
  })
}

export interface FetchedPage {
  html: string
  nodes: ExtractedNode[]
  close(): Promise<void>
}

/**
 * Fetcher abstraction used by the orchestration layer (`runCapture`). The
 * shape is the minimal contract the pipeline needs: a `fetch` that takes a
 * URL and an optional CaptureTarget, and a `close` that releases any long-
 * lived resources. Production wires `createPlaywrightFetcher()` here;
 * tests inject a stub.
 */
export interface CaptureFetcher {
  fetch(url: string, target?: CaptureTarget, opts?: FetchOptions): Promise<FetchedPage>
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// Process-wide browser singleton.
// ---------------------------------------------------------------------------

/** Browser engine enum shared between the singleton and createPlaywrightFetcher. */
type BrowserKind = 'chromium' | 'firefox' | 'webkit'

interface SharedBrowserState {
  browser: import('playwright-core').Browser | null
  kind: BrowserKind
  /** Number of contexts currently open across all fetchers. */
  openContexts: number
  /** Max concurrent contexts. Calls beyond this await a slot. */
  maxContexts: number
  /** FIFO queue of resolvers waiting for a context slot. */
  waiters: Array<() => void>
  /** Counter — gated behind __test flag — for tests asserting single-launch. */
  launches: number
}

const SHARED_MAX_CONTEXTS = 16

const shared: SharedBrowserState = {
  browser: null,
  kind: 'chromium',
  openContexts: 0,
  maxContexts: SHARED_MAX_CONTEXTS,
  waiters: [],
  launches: 0,
}

/**
 * Lazy singleton: launches the shared browser on first call, returns the
 * cached instance afterwards. The browser process lives until
 * `shutdownSharedBrowser()` is called (typically from the host's signal
 * handlers). Idempotent — multiple concurrent first-calls await the same
 * launch promise rather than racing to launch twice.
 *
 * The `launchPromise` is the single-flight guard. We clear it ONLY when the
 * launch throws; on success it stays set so concurrent callers see the
 * in-flight promise and wait, instead of starting a second launch while
 * the first is still resolving. (A `finally` clear looked cleaner but
 * defeated the guard: once the first call's await returned, `launchPromise`
 * was null again, so a second call arriving microseconds later would pass
 * the `shared.browser == null` check and start its own launch.)
 */
let launchPromise: Promise<import('playwright-core').Browser> | null = null

export async function getSharedBrowser(
  kind: BrowserKind = 'chromium',
): Promise<import('playwright-core').Browser> {
  if (shared.browser) return shared.browser
  if (launchPromise) return launchPromise
  shared.kind = kind
  launchPromise = (async () => {
    const pw = (await import('playwright-core')) as typeof import('playwright-core')
    const engine = kind === 'firefox' ? pw.firefox : kind === 'webkit' ? pw.webkit : pw.chromium
    const browser = await engine.launch({ headless: true })
    shared.browser = browser
    shared.launches += 1
    return browser
  })()
  try {
    return await launchPromise
  } catch (err) {
    // Only clear on failure. On success we keep `launchPromise` set so
    // concurrent callers still see it as the in-flight launch.
    launchPromise = null
    throw err
  }
}

/**
 * Close the shared browser and reset all singleton state. Idempotent. Any
 * fetcher that subsequently tries to `fetch()` will lazily relaunch on the
 * next call to `getSharedBrowser()`. Intended for graceful shutdown only —
 * calling this while fetches are in flight will cause them to throw.
 */
export async function shutdownSharedBrowser(): Promise<void> {
  shared.waiters.splice(0).forEach((resolve) => resolve())
  const browser = shared.browser
  shared.browser = null
  shared.openContexts = 0
  // Also clear any pending launch promise so a subsequent getSharedBrowser()
  // starts a fresh launch rather than returning the (closed) cached browser
  // from a completed-but-still-referenced IIFE. Without this, shutdown +
  // relaunch sequence stays stuck on the original launch handle.
  launchPromise = null
  if (browser) {
    await browser.close().catch(() => { /* best effort */ })
  }
}

/**
 * Acquire a slot in the shared browser's context pool. If the pool is full
 * (max 16 by default), awaits the next available slot FIFO. Returns a
 * release function that the caller MUST call when the context is closed.
 */
async function acquireContextSlot(): Promise<() => void> {
  if (shared.openContexts < shared.maxContexts) {
    shared.openContexts += 1
    return () => {
      shared.openContexts -= 1
      const next = shared.waiters.shift()
      if (next) next()
    }
  }
  await new Promise<void>((resolve) => shared.waiters.push(resolve))
  shared.openContexts += 1
  return () => {
    shared.openContexts -= 1
    const next = shared.waiters.shift()
    if (next) next()
  }
}

// ---------------------------------------------------------------------------
// createPlaywrightFetcher — per-call fetcher that uses the shared browser.
// ---------------------------------------------------------------------------

/**
 * Construct a per-call fetcher that draws from the shared browser. Each
 * `fetch()` opens a fresh browser context (cheap — reuses the browser
 * process); `close()` on the returned fetcher closes only the most recent
 * context, NOT the shared browser. Use `shutdownSharedBrowser()` at process
 * shutdown.
 */
export async function createPlaywrightFetcher(
  opts: PlaywrightFetcherOptions = {},
): Promise<CaptureFetcher> {
  const kind = opts.browser ?? 'chromium'
  const browser = await getSharedBrowser(kind)

  // Per-fetcher close: closes ONLY the most recently opened context for
  // this fetcher (in practice fetches are serialized per-fetcher so there's
  // only one). Does NOT touch the shared browser.
  let lastContext: import('playwright-core').BrowserContext | null = null
  let lastRelease: (() => void) | null = null

  return {
    async fetch(url: string, target?: CaptureTarget, fetchOpts?: FetchOptions): Promise<FetchedPage> {
      const release = await acquireContextSlot()
      const context = await browser.newContext()
      lastContext = context
      lastRelease = release
      const page = await context.newPage()
      try {
        if (opts.allowedHosts) {
          await page.route('**/*', async (route) => {
            const requestUrl = new URL(route.request().url())
            if (
              (requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:')
              && !hostMatchesAllowlist(requestUrl.hostname, opts.allowedHosts!)
            ) {
              await route.abort('blockedbyclient')
              return
            }
            await route.continue()
          })
        }
        await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: opts.navigationTimeoutMs ?? (opts.networkIdleMs ?? 5000) + 5000,
        })
        // Pre-capture interactions: drive the page (login click, fill, etc.)
        // before the DOM walker reads it. Stops at the first failure and
        // surfaces a structured error so the orchestrator can wrap it.
        if (fetchOpts?.interactions && fetchOpts.interactions.length > 0) {
          await applyInteractions(page, fetchOpts.interactions, {
            interactionsCap: fetchOpts.interactionsCap ?? MAX_INTERACTIONS,
            interactionTimeoutMs: fetchOpts.interactionTimeoutMs ?? INTERACTION_TIMEOUT_MS,
          })
        }
        const html = await page.content()
        // Default to the whole body. Callers pass a target when they want
        // a subtree or single-element capture.
        const resolvedTarget: CaptureTarget = target ?? { selector: null, maxDepth: Infinity }
        // Run the page-side walker in the page's V8. `document` and
        // `window` are real globals there; PAGE_WALKER_SOURCE is the
        // walker body in plain JS (declared in domExtractor.ts). When
        // `page.evaluate` is called with a STRING expression, Playwright
        // evaluates it in the page's V8 but does NOT bind any arg
        // (`arguments[0]` is undefined; the arg is only bound when the
        // script is a function). To pass `target` and `COMPUTED_PROPS_`
        // without reaching back into a host closure, we serialise them
        // as JSON and bake them into a self-invoking function expression.
        // This mirrors the cypress / kaihv pattern of shipping a complete
        // IIFE as a string to page.evaluate.
        const nodes = await page.evaluate(
          `(function (target, COMPUTED_PROPS_) { ${PAGE_WALKER_SOURCE}\nreturn runExtract(target, COMPUTED_PROPS_); })(${JSON.stringify(resolvedTarget)}, ${JSON.stringify(COMPUTED_PROPS)})`,
        ) as ExtractedNode[]
        return {
          html,
          nodes,
          close: async () => {
            await page.close().catch(() => { /* best effort */ })
            await context.close().catch(() => { /* best effort */ })
            release()
          },
        }
      } catch (err) {
        await page.close().catch(() => { /* best effort */ })
        await context.close().catch(() => { /* best effort */ })
        release()
        throw err
      }
    },
    async close(): Promise<void> {
      // Close only the most recent context, not the shared browser.
      if (lastContext) {
        await lastContext.close().catch(() => { /* best effort */ })
        lastContext = null
      }
      if (lastRelease) {
        lastRelease()
        lastRelease = null
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Test-only introspection. Gated behind __test flag so production builds
// never expose the launch counter.
// ---------------------------------------------------------------------------

/**
 * Returns the number of times the shared browser has been launched in this
 * process. Intended for tests asserting that `getSharedBrowser()` is a
 * true singleton — many `createPlaywrightFetcher()` calls should still
 * result in a single launch. Returns 0 if the singleton has never been
 * launched.
 */
export function __sharedBrowserLaunchCount(): number {
  return shared.launches
}

/**
 * Reset the shared singleton's launch counter to 0. Test-only; safe to
 * call in test setup, not safe to call concurrently with fetches.
 */
export function __resetSharedBrowserLaunchCount(): void {
  shared.launches = 0
}