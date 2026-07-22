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
}

export interface FetchedPage {
  html: string
  nodes: ExtractedNode[]
  close(): Promise<void>
}

export interface PlaywrightFetcher {
  fetch(url: string, signal?: AbortSignal): Promise<FetchedPage>
  /** Close the browser. Idempotent. */
  close(): Promise<void>
}

export async function createPlaywrightFetcher(
  opts: PlaywrightFetcherOptions = {},
): Promise<PlaywrightFetcher> {
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
    async fetch(url: string, signal?: AbortSignal): Promise<FetchedPage> {
      const context = await browser.newContext()
      const page = await context.newPage()
      const onAbort = (): void => {
        page.close().catch(() => {})
      }
      if (signal) {
        if (signal.aborted) {
          await context.close().catch(() => {})
          throw new Error('aborted before navigation')
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      try {
        await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: opts.navigationTimeoutMs ?? (opts.networkIdleMs ?? 5000) + 5000,
        })
        const html = await page.content()
        const target: CaptureTarget = { selector: null, maxDepth: Infinity }
        // Run the page-side walker in the page's V8. `document` and
        // `window` are real globals there; makePageWalker bridges them.
        // page.evaluate takes a function + one arg, so we close over the
        // two-call args inside a wrapper that accepts a single arg.
        const nodes = await page.evaluate(
          ((targetAndProps: { target: CaptureTarget; props: readonly string[] }) =>
            makePageWalker(targetAndProps.target, targetAndProps.props)) as unknown as (
            arg: { target: CaptureTarget; props: readonly string[] },
          ) => ExtractedNode[],
          { target, props: COMPUTED_PROPS },
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
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort)
      }
    },
    close: closeBrowser,
  }
}
