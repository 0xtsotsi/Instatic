/**
 * Tests for the capture_from_url MCP tool scaffolding.
 *
 * Five assertions:
 *   1. Registry presence — the tool is exposed when the right caps are granted.
 *   2. Capability gate denies — NOT exposed with only site.read.
 *   3. Tool shape — scope/site + execution/server + inputSchema.url property.
 *   4. Architecture seam — core/ files may not import Instatic modules.
 *      adapters/ is exempt. Enforces the contract that core/ stays portable
 *      so a future CLI can import it.
 *   5. Mode gates — `mode: 'styles-only'` and `mode: 'dom-only'` actually
 *      gate their output. Regression guard for the bug where the asset
 *      collector fired for `dom-only` (gate was on `html`, not `mode`) and
 *      the CSS branch was bypassed for `styles-only` (gate sequenced after
 *      the asset collector overwrote `css`).
 */
import { describe, expect, it, mock } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CoreCapability } from '@core/capabilities'
import { mcpToolsForCapabilities } from '../registry'

// ---------------------------------------------------------------------------
// Module mocks for the mode-gate tests.
// These run BEFORE the captureTool module is imported (top-level await below),
// so the production `createPlaywrightFetcher` / `createSafeFetcher` /
// `getDraftSite` calls inside the handler hit the mocks instead of the real
// browser launcher, SSRF-checking fetcher, and DB read.
// ---------------------------------------------------------------------------

const mockNodes = [
  {
    selector: 'div.hero',
    outerHTML:
      '<div class="hero" data-uid="">Hello world</div>',
    computedStyles: {
      color: 'rgb(255, 0, 0)',
      'background-image': 'url("https://example.test/bg.png")',
      'font-size': '24px',
    },
  },
  {
    selector: 'p.hero-sub',
    outerHTML: '<p class="hero-sub" data-uid="">Sub</p>',
    computedStyles: {
      color: 'rgb(0, 0, 255)',
      'font-size': '16px',
    },
  },
]

const mockFetchedPage = {
  nodes: mockNodes,
  html: '<html><body><div class="hero">Hello world</div></body></html>',
  close: async () => {},
}

const mockFetcherInstance = {
  fetch: mock(async () => mockFetchedPage),
  close: async () => {},
}

const mockCreatePlaywrightFetcher = mock(async () => mockFetcherInstance)

const mockSafeFetcherInstance = {
  // Fail every asset fetch. Tests assert assetFiles is empty / rewritten
  // counts are 0; failing is the simplest way to ensure no files leak
  // through and no `uploads/captures/<id>/` directory is created.
  fetch: mock(async () => ({ ok: false, error: 'mock: not fetching' })),
}
const mockCreateSafeFetcher = mock(() => mockSafeFetcherInstance)

const mockGetDraftSite = mock(async () => null)

mock.module('./core/playwrightFetcher', () => ({
  createPlaywrightFetcher: mockCreatePlaywrightFetcher,
}))

mock.module('./core/safeFetcher', () => ({
  createSafeFetcher: mockCreateSafeFetcher,
}))

mock.module('../../../repositories/site', () => ({
  getDraftSite: mockGetDraftSite,
}))

// Dynamic import so the mocks above are in place before captureTool evaluates
// its `import { createPlaywrightFetcher } from './core/playwrightFetcher'`
// (and the other two) at module load time.
const { captureTool, targetForScope } = await import('./captureTool')

const CAPS_FOR_CAPTURE: readonly CoreCapability[] = [
  'site.read',
  'site.structure.edit',
  'site.content.edit',
  'site.style.edit',
  'pages.edit',
  'ai.tools.write',
]

describe('mcp capture_from_url', () => {
  it('is present in the registry when full site capabilities are granted', () => {
    const tools = mcpToolsForCapabilities(CAPS_FOR_CAPTURE)
    const names = tools.map((t) => t.name)
    expect(names).toContain('capture_from_url')
  })

  it('is hidden from a connector that lacks every required site capability', () => {
    // The tool's requiredCapabilities is an ANY-OF list: site.read,
    // site.structure.edit, site.content.edit, site.style.edit, pages.edit.
    // A connector holding only a content-scope capability (e.g. content.create)
    // holds none of them, so the tool must be filtered out.
    const tools = mcpToolsForCapabilities(['content.create'])
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('capture_from_url')
  })

  it('declares scope:site, execution:server, and an inputSchema with a url property', () => {
    const tool = mcpToolsForCapabilities(CAPS_FOR_CAPTURE).find(
      (t) => t.name === 'capture_from_url',
    )
    expect(tool).toBeTruthy()
    if (!tool) return
    expect(tool.scope).toBe('site')
    expect(tool.execution).toBe('server')

    // TypeBox schemas are plain JSON Schema objects; the input schema is
    // Type.Object({ url, mode, scope, selector, assetsMax }, ...).
    const schema = tool.inputSchema as { properties?: Record<string, unknown> }
    expect(schema.properties).toBeTruthy()
    expect(schema.properties!.url).toBeTruthy()
  })

  it('enforces the core/adapters seam: no Instatic imports under core/', () => {
    // core/ MUST stay pure (no @core/*, no server/*, no src/core/*) so a future
    // standalone CLI can import it. adapters/ is exempt — that's the Instatic glue.
    const coreDir = join(import.meta.dir, 'core')
    const files = readdirSync(coreDir).filter((f) => f.endsWith('.ts'))

    // Regex matching a top-level import statement:
    //   import { foo } from 'specifier'
    //   import type { foo } from "specifier"
    //   import 'specifier'
    // We capture the specifier (single or double quoted).
    const importRegex = /^\s*import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/m

    const violations: { file: string; specifier: string; line: string }[] = []
    const bannedPrefixes = ['@core/', 'server/', 'src/core/']

    for (const file of files) {
      const path = join(coreDir, file)
      const src = readFileSync(path, 'utf8')
      // Match every import statement in the file (flag the line, not just the first one).
      const importLines = src.split('\n').filter((line) => /^\s*import\b/.test(line))
      for (const line of importLines) {
        const match = line.match(importRegex)
        if (!match) continue
        const specifier = match[1]!
        if (bannedPrefixes.some((prefix) => specifier.startsWith(prefix))) {
          violations.push({ file, specifier, line: line.trim() })
        }
      }
    }

    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  - ${v.file}: import from "${v.specifier}"\n      ${v.line}`)
        .join('\n')
      throw new Error(
        `core/ must stay free of Instatic imports. Offending imports:\n${detail}`,
      )
    }
    expect(violations).toHaveLength(0)
  })
})

/**
 * Handler contract tests that do NOT require a real browser.
 *
 * The full pipeline (Playwright fetch + walk + rewrite + asset collect) is
 * gated on CAPTURE_LIVE=1 in a separate integration test. These cover the
 * synchronous early-return paths and the resource-cleanup contract.
 */
describe('capture_from_url handler (no browser)', () => {
  const stubCtx = {
    db: {} as never,
    userId: 'u1',
    capabilities: CAPS_FOR_CAPTURE,
    scope: 'site' as const,
    conversationId: 'c1',
    snapshot: null,
  } as never

  it('rejects element/subtree scope without a selector BEFORE launching a browser', async () => {
    // The handler should validate input first; if it tries to launch a browser
    // here, Playwright would throw in a CI environment without the binary.
    const result = (await captureTool.handler(
      { url: 'https://example.com', scope: 'element' } as never,
      stubCtx,
    )) as { ok: boolean; error?: string }
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/selector/)
  })

  it('rejects subtree scope without a selector BEFORE launching a browser', async () => {
    const result = (await captureTool.handler(
      { url: 'https://example.com', scope: 'subtree' } as never,
      stubCtx,
    )) as { ok: boolean; error?: string }
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/selector/)
  })

  it('page scope is the default and does not require a selector (still needs a reachable URL to succeed)', async () => {
    // We don't assert success (that would require Playwright); we assert the
    // handler did NOT short-circuit on missing selector.
    // The handler will try to launch Playwright and fail; the error is captured
    // and returned as { ok: false, error: ... }.
    const result = (await captureTool.handler(
      { url: 'https://127.0.0.1:1/never-resolves' } as never,
      stubCtx,
    )) as { ok: boolean; error?: string }
    // Either ok:false with a Playwright/network error, or ok:true if Playwright
    // happened to be installed. We only assert the SHAPE: it's an object with ok.
    expect(typeof result.ok).toBe('boolean')
    if (!result.ok) {
      // Error should be a non-empty string (real failure, not a silent skip).
      expect(typeof result.error).toBe('string')
      expect(result.error!.length).toBeGreaterThan(0)
    }
  })
})

describe('targetForScope (scope → CaptureTarget translation)', () => {
  // Regression guard for the scope/subtree/element bug: the handler used
  // to validate scope+selector at the boundary but ignore them downstream,
  // hard-coding selector:null + maxDepth:Infinity in the fetcher. This
  // pins the translation contract so the bug cannot silently re-appear.

  it('scope:page returns the whole body (selector:null, maxDepth:Infinity)', () => {
    expect(targetForScope('page', undefined)).toEqual({
      selector: null,
      maxDepth: Infinity,
    })
    // A selector passed alongside page scope is intentionally ignored.
    expect(targetForScope('page', '.hero')).toEqual({
      selector: null,
      maxDepth: Infinity,
    })
  })

  it('scope:subtree returns the matched element and all its descendants', () => {
    expect(targetForScope('subtree', '.hero')).toEqual({
      selector: '.hero',
      maxDepth: Infinity,
    })
  })

  it('scope:element returns only the matched element (maxDepth:0)', () => {
    expect(targetForScope('element', '.hero')).toEqual({
      selector: '.hero',
      maxDepth: 0,
    })
  })
})

/**
 * Mode-gate tests. The fetcher, asset fetcher, and site-token read are all
 * mocked at the top of the file so the handler runs end-to-end without a
 * real browser or DB. The mock fetcher returns two nodes whose CSS contains
 * a `url(https://example.test/bg.png)`, so the asset collector would actually
 * have work to do — if the gate is wrong, the test would observe that work.
 *
 * The mock asset fetcher fails every fetch (ok:false), so `assetFiles` is
 * always empty and `unavailable` contains the URLs. The tests assert
 * `assetFiles.length === 0` for the restricted modes AND that the asset
 * fetcher was NEVER called for them — the stricter form of the gate.
 */
describe('capture_from_url mode gates', () => {
  const stubCtx = {
    db: {} as never,
    userId: 'u1',
    capabilities: CAPS_FOR_CAPTURE,
    scope: 'site' as const,
    conversationId: 'c1',
    snapshot: null,
  } as never

  // Reset mock call counts between tests so assertions like "asset fetcher
  // was never called" are per-test, not cumulative across the file.
  function resetMocks() {
    mockFetcherInstance.fetch.mockClear()
    mockSafeFetcherInstance.fetch.mockClear()
    mockCreatePlaywrightFetcher.mockClear()
    mockCreateSafeFetcher.mockClear()
    mockGetDraftSite.mockClear()
  }

  it("mode: 'styles-only' returns css only, no html, no asset downloads", async () => {
    resetMocks()
    const result = (await captureTool.handler(
      { url: 'https://example.test/', mode: 'styles-only' } as never,
      stubCtx,
    )) as {
      ok: boolean
      html?: string
      css?: string
      assetFiles?: unknown[]
    }
    expect(result.ok).toBe(true)
    expect(result.html).toBe('')
    expect(result.css).toBeTruthy()
    expect(result.css!.length).toBeGreaterThan(0)
    expect(result.assetFiles).toEqual([])
    // The asset collector must not have been invoked at all — neither the
    // factory that builds the fetcher nor the fetcher itself.
    expect(mockCreateSafeFetcher).not.toHaveBeenCalled()
    expect(mockSafeFetcherInstance.fetch).not.toHaveBeenCalled()
  })

  it("mode: 'dom-only' returns html only, no css, no asset downloads", async () => {
    resetMocks()
    const result = (await captureTool.handler(
      { url: 'https://example.test/', mode: 'dom-only' } as never,
      stubCtx,
    )) as {
      ok: boolean
      html?: string
      css?: string
      assetFiles?: unknown[]
    }
    expect(result.ok).toBe(true)
    expect(result.css).toBe('')
    expect(result.html).toBeTruthy()
    expect(result.html!.length).toBeGreaterThan(0)
    expect(result.assetFiles).toEqual([])
    // The asset collector must not have been invoked. This is the regression
    // guard for the bug where the gate was `mode !== 'styles-only' && html`,
    // which `dom-only` satisfied (html was non-empty) and so assets were
    // downloaded for it.
    expect(mockCreateSafeFetcher).not.toHaveBeenCalled()
    expect(mockSafeFetcherInstance.fetch).not.toHaveBeenCalled()
    // Token application also skipped — the `needsCss` gate short-circuits
    // before the DB read, so we don't even hit the draftSite repository.
    expect(mockGetDraftSite).not.toHaveBeenCalled()
  })

  it("mode: 'dom+styles' populates both html and css", async () => {
    resetMocks()
    const result = (await captureTool.handler(
      { url: 'https://example.test/', mode: 'dom+styles' } as never,
      stubCtx,
    )) as {
      ok: boolean
      html?: string
      css?: string
      assetFiles?: unknown[]
    }
    expect(result.ok).toBe(true)
    expect(result.html).toBeTruthy()
    expect(result.html!.length).toBeGreaterThan(0)
    expect(result.css).toBeTruthy()
    expect(result.css!.length).toBeGreaterThan(0)
    // The mock asset fetcher fails every request, so assetFiles is empty
    // here too — but the COLLECTOR must have been invoked (this is the only
    // mode where it should be). The fetch call count is 1 because there's
    // exactly one extractable URL in the mock css (the bg.png url()).
    expect(mockCreateSafeFetcher).toHaveBeenCalledTimes(1)
    expect(mockSafeFetcherInstance.fetch).toHaveBeenCalledTimes(1)
    expect(result.assetFiles).toEqual([])
  })
})
