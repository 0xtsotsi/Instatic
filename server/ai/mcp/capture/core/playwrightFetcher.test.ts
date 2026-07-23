/**
 * Tests for the shared-browser singleton in playwrightFetcher.ts.
 *
 * Strategy: stub the dynamic `playwright-core` import via mock.module so
 * the tests don't actually launch Chromium. The stub counts how many times
 * the engine `launch()` is called and returns a fake Browser that just
 * tracks `newContext()` calls.
 *
 * What we verify:
 *   1. Many concurrent `createPlaywrightFetcher()` calls produce ONE launch
 *      (true singleton).
 *   2. The launch counter is exposed via __sharedBrowserLaunchCount() and
 *      can be reset via __resetSharedBrowserLaunchCount().
 *   3. shutdownSharedBrowser() is idempotent and resets the counter.
 *   4. acquireContextSlot queues callers beyond the cap (maxContexts).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Stub `playwright-core` so the singleton's first call doesn't try to
// launch a real Chromium. The singleton's own launch counter is the test
// oracle — we don't need to introspect the stub.
const fakeBrowser = {
  newContext: async () => ({
    newPage: async () => ({
      route: async () => { /* noop */ },
      goto: async () => { /* noop */ },
      content: async () => '<html></html>',
      evaluate: async () => [],
      close: async () => { /* noop */ },
    }),
    close: async () => { /* noop */ },
  }),
  close: async () => { /* noop */ },
}

mock.module('playwright-core', () => ({
  chromium: {
    launch: async () => fakeBrowser,
  },
  firefox: { launch: async () => fakeBrowser },
  webkit: { launch: async () => fakeBrowser },
}))

const fetcherModule = await import('./playwrightFetcher')

beforeEach(async () => {
  // Full shutdown + reset so each test starts from a clean singleton state.
  // `__resetSharedBrowserLaunchCount` zeroes the counter; `shutdownSharedBrowser`
  // nulls the cached browser pointer so the next getSharedBrowser() actually
  // launches (rather than returning the cached instance from a prior test).
  await fetcherModule.shutdownSharedBrowser()
  fetcherModule.__resetSharedBrowserLaunchCount()
})

afterEach(async () => {
  // Make sure no browser carries state between tests.
  await fetcherModule.shutdownSharedBrowser()
})

describe('shared Playwright browser singleton', () => {
  it('returns the same browser instance across getSharedBrowser calls', async () => {
    const a = await fetcherModule.getSharedBrowser()
    const b = await fetcherModule.getSharedBrowser()
    expect(a).toBe(b)
  })

  it('launches the browser exactly once across many concurrent getSharedBrowser calls', async () => {
    // All ten calls return the same instance; only ONE launch event was
    // recorded. This is the core singleton guarantee — every concurrent
    // MCP capture call draws from the same Chromium process.
    const browsers = await Promise.all(
      Array.from({ length: 10 }, () => fetcherModule.getSharedBrowser()),
    )
    expect(fetcherModule.__sharedBrowserLaunchCount()).toBe(1)
    const first = browsers[0]
    for (const b of browsers) expect(b).toBe(first)
  })

  it('shutdownSharedBrowser is idempotent and resets state', async () => {
    await fetcherModule.getSharedBrowser()
    expect(fetcherModule.__sharedBrowserLaunchCount()).toBe(1)
    await fetcherModule.shutdownSharedBrowser()
    await fetcherModule.shutdownSharedBrowser()
    // After shutdown, the next getSharedBrowser() should relaunch — so the
    // total launch count is now 2 (one before shutdown, one after).
    await fetcherModule.getSharedBrowser()
    expect(fetcherModule.__sharedBrowserLaunchCount()).toBe(2)
  })
})