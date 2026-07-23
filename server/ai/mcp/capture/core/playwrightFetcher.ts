/**
 * Production fetcher for the capture tool. Launches a Playwright browser,
 * navigates to the URL, and returns the rendered HTML + ExtractedNode[].
 *
 * The walker itself runs in the page's V8 via
 *   page.evaluate(makePageWalker, target, COMPUTED_PROPS)
 * — see domExtractor.ts for the page-side walker source. The walker is
 * shared between the pure TypeScript entry point (used by tests) and
 * the page-side bridge (used here) so the two stay in lock-step.
 *
 * The fetcher is dynamically imported so the rest of the module graph
 * does not pay for the Playwright binary until a real fetch is requested.
 */
import {
  COMPUTED_PROPS,
  makePageWalker,
  type CaptureTarget,
  type ExtractedNode,
} from './domExtractor'

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
  fetch(url: string, target?: CaptureTarget): Promise<FetchedPage>
  close(): Promise<void>
}

export async function createPlaywrightFetcher(
  opts: PlaywrightFetcherOptions = {},
): Promise<CaptureFetcher> {
  // Dynamic import keeps playwright-core off the module-load path.
  const pw = (await import('playwright-core')) as typeof import('playwright-core')
  const engine =
    opts.browser === 'firefox' ? pw.firefox
    : opts.browser === 'webkit' ? pw.webkit
    : pw.chromium
  const browser = await engine.launch({ headless: true })
  let browserClosed = false

  const closeBrowser = async (): Promise<void> => {
    if (browserClosed) return
    browserClosed = true
    await browser.close().catch(() => {})
  }

  return {
    async fetch(url: string, target?: CaptureTarget): Promise<FetchedPage> {
      const context = await browser.newContext()
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
        const html = await page.content()
        // Default to the whole body. Callers pass a target when they want
        // a subtree or single-element capture.
        const resolvedTarget: CaptureTarget = target ?? { selector: null, maxDepth: Infinity }
        // Run the page-side walker in the page's V8. `document` and
        // `window` are real globals there; makePageWalker bridges them.
        // page.evaluate takes a function + one arg, so we close over the
        // two-call args inside a wrapper that accepts a single arg.
        const nodes = await page.evaluate(
          ((targetAndProps: { target: CaptureTarget; props: readonly string[] }) =>
            makePageWalker(targetAndProps.target, targetAndProps.props)) as unknown as (
            arg: { target: CaptureTarget; props: readonly string[] },
          ) => ExtractedNode[],
          { target: resolvedTarget, props: COMPUTED_PROPS },
        )
        return {
          html,
          nodes,
          close: async () => {
            await page.close().catch(() => {})
            await context.close().catch(() => {})
          },
        }
      } catch (err) {
        await page.close().catch(() => {})
        await context.close().catch(() => {})
        throw err
      }
    },
    close: closeBrowser,
  }
}
