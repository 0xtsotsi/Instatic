/**
 * Tests for createSafeFetcher — production AssetFetcher with SSRF guard.
 * All tests use a mock fetchImpl (no network).
 */
import { describe, expect, it } from 'bun:test'
import { createSafeFetcher, type SafeFetcherOptions } from './safeFetcher'

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

describe('createSafeFetcher', () => {
  it('blocks http:// when allowInsecure is false', async () => {
    const fetcher = createSafeFetcher()
    const result = await fetcher.fetch('http://example.com/foo.png')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/disallowed protocol/)
  })

  it('returns ok + bytes + contentType on a successful https fetch', async () => {
    const okFetch: FetchImpl = async () =>
      new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })
    const fetcher = createSafeFetcher(okFetch)
    const result = await fetcher.fetch('https://example.com/foo.txt')
    expect(result.ok).toBe(true)
    expect(result.bytes).toBeTruthy()
    expect(new TextDecoder().decode(result.bytes!)).toBe('hello')
    expect(result.contentType).toBe('text/plain')
  })

  it('blocks a private host (10.0.0.1) even with allowInsecure: true', async () => {
    let called = false
    const passthrough: FetchImpl = async () => {
      called = true
      return new Response('', { status: 200 })
    }
    const fetcher = createSafeFetcher(passthrough, { allowInsecure: true })
    const result = await fetcher.fetch('http://10.0.0.1/foo.png')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/private host blocked/)
    expect(called).toBe(false)
  })

  it('returns "asset too large" when the response body exceeds maxBytes', async () => {
    const bigFetch: FetchImpl = async () =>
      new Response(new Uint8Array(1000), { status: 200 })
    const fetcher = createSafeFetcher(bigFetch, { maxBytes: 100 } satisfies SafeFetcherOptions)
    const result = await fetcher.fetch('https://example.com/big.bin')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('asset too large')
  })

  it('returns ok:false when the fetchImpl throws, without leaking an exception', async () => {
    const throwingFetch: FetchImpl = async () => { throw new Error('boom') }
    const fetcher = createSafeFetcher(throwingFetch)
    const result = await fetcher.fetch('https://example.com/x')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/boom/)
  })
})
