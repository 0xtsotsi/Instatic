/**
 * Tests for collectAssets — walks HTML+CSS for asset URLs, dedupes, fetches via
 * the injected AssetFetcher, rewrites original URLs to local paths, and surfaces
 * failed fetches in `unavailable`.
 */
import { describe, expect, it } from 'bun:test'
import type { AssetFetcher } from './assets'
import { collectAssets } from './assets'

const happyFetcher: AssetFetcher = {
  fetch: async (_url) => ({
    ok: true,
    bytes: new TextEncoder().encode('x'),
    contentType: 'image/png',
  }),
}

const failFetcher: AssetFetcher = {
  fetch: async () => ({ ok: false, error: 'simulated failure' }),
}

describe('collectAssets', () => {
  it('returns empty results when html and css are empty', async () => {
    const result = await collectAssets('', '', happyFetcher, { baseUrl: 'https://example.com/' })
    expect(result.files).toEqual([])
    expect(result.unavailable).toEqual([])
    expect(result.html).toBe('')
    expect(result.css).toBe('')
  })

  it('collects one <img src> from HTML and rewrites it to a local path', async () => {
    const html = '<img src="https://example.com/foo.png" />'
    const result = await collectAssets(html, '', happyFetcher, { baseUrl: 'https://example.com/' })
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.originalUrl).toBe('https://example.com/foo.png')
    expect(result.files[0]!.localPath).toMatch(/^assets\//)
    expect(result.html).not.toContain('https://example.com/foo.png')
    expect(result.html).toContain(result.files[0]!.localPath)
    expect(result.unavailable).toEqual([])
  })

  it('collects a CSS background-image url() and rewrites it', async () => {
    const css = '.hero { background-image: url(https://example.com/bg.png); }'
    const result = await collectAssets('', css, happyFetcher, { baseUrl: 'https://example.com/' })
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.originalUrl).toBe('https://example.com/bg.png')
    expect(result.css).not.toContain('https://example.com/bg.png')
    expect(result.css).toContain(result.files[0]!.localPath)
  })

  it('dedupes the same URL appearing in both HTML and CSS', async () => {
    const url = 'https://example.com/shared.png'
    const html = `<img src="${url}" />`
    const css = `.x { background-image: url(${url}); }`
    const fetcher: AssetFetcher = {
      fetch: async () => ({ ok: true, bytes: new TextEncoder().encode('x'), contentType: 'image/png' }),
    }
    const result = await collectAssets(html, css, fetcher, { baseUrl: 'https://example.com/' })
    expect(result.files).toHaveLength(1)
    expect(result.unavailable).toEqual([])
    expect(result.html).not.toContain(url)
    expect(result.css).not.toContain(url)
  })

  it('records a fetch failure in unavailable and leaves the original URL untouched', async () => {
    const html = '<img src="https://example.com/missing.png" />'
    const result = await collectAssets(html, '', failFetcher, { baseUrl: 'https://example.com/' })
    expect(result.files).toEqual([])
    expect(result.unavailable).toHaveLength(1)
    expect(result.unavailable[0]!.url).toBe('https://example.com/missing.png')
    expect(result.unavailable[0]!.reason).toBe('simulated failure')
    // Original URL is NOT rewritten.
    expect(result.html).toContain('https://example.com/missing.png')
  })

  it('caps at maxAssets and pushes the rest into unavailable', async () => {
    const html = `
      <img src="https://example.com/a.png" />
      <img src="https://example.com/b.png" />
      <img src="https://example.com/c.png" />
    `
    const result = await collectAssets(html, '', happyFetcher, {
      baseUrl: 'https://example.com/',
      maxAssets: 1,
    })
    expect(result.files).toHaveLength(1)
    expect(result.unavailable).toHaveLength(2)
    for (const u of result.unavailable) {
      expect(u.reason).toBe('max assets reached')
    }
  })

  it('skips data: URIs — no fetch, no candidate', async () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=" />'
    const fetcher: AssetFetcher = {
      fetch: async () => ({ ok: true, bytes: new Uint8Array(), contentType: 'image/png' }),
    }
    const result = await collectAssets(html, '', fetcher, { baseUrl: 'https://example.com/' })
    expect(result.files).toEqual([])
    expect(result.unavailable).toEqual([])
    expect(result.html).toBe(html)
  })

  it('resolves relative URLs against baseUrl', async () => {
    const html = '<img src="/foo.png" />'
    let fetchedUrl: string | null = null
    const fetcher: AssetFetcher = {
      fetch: async (url) => {
        fetchedUrl = url
        return { ok: true, bytes: new TextEncoder().encode('x'), contentType: 'image/png' }
      },
    }
    const result = await collectAssets(html, '', fetcher, {
      baseUrl: 'https://example.com/page',
    })
    expect(fetchedUrl).toBe('https://example.com/foo.png')
    expect(result.files).toHaveLength(1)
  })

  it('invokes persist with (localPath, bytes, contentType)', async () => {
    const html = '<img src="https://example.com/p.png" />'
    const persistCalls: { path: string; bytes: Uint8Array; type: string }[] = []
    const result = await collectAssets(html, '', happyFetcher, {
      baseUrl: 'https://example.com/',
      persist: (path, bytes, type) => {
        persistCalls.push({ path, bytes, type })
      },
    })
    expect(persistCalls).toHaveLength(1)
    expect(persistCalls[0]!.path).toBe(result.files[0]!.localPath)
    expect(persistCalls[0]!.type).toBe('image/png')
    expect(new TextDecoder().decode(persistCalls[0]!.bytes)).toBe('x')
  })
})
