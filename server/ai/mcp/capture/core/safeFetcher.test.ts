/**
 * Tests for createSafeFetcher — production AssetFetcher with SSRF guard.
 * All tests use a mock fetchImpl AND a mock dnsLookup (no network).
 *
 * Note: createSafeFetcher now pins the request to the first resolved IP and
 * passes the original hostname in a `Host` header. This closes the DNS-rebinding
 * window. The mock fetcher asserts this behaviour.
 */
import { describe, expect, it } from 'bun:test'
import { createSafeFetcher, type SafeFetcherOptions } from './safeFetcher'

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type DnsLookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<{ address: string; family: number }[]>

/** Default mock DNS: returns a single public IPv4 for any hostname. */
const mockDnsPublic: DnsLookup = async () => [{ address: '93.184.216.34', family: 4 }]
/** Mock DNS that resolves a hostname to a private IP — for DNS-rebinding tests. */
const mockDnsPrivate: DnsLookup = async () => [{ address: '10.0.0.1', family: 4 }]
/** Mock DNS that fails — for error-path tests. */
const mockDnsFail: DnsLookup = async () => { throw new Error('ENOTFOUND') }

describe('createSafeFetcher', () => {
  it('fails closed when the URL host is outside allowedHosts', async () => {
    let fetched = false
    const fetcher = createSafeFetcher(
      async () => {
        fetched = true
        return new Response('unexpected')
      },
      mockDnsPublic,
      { allowedHosts: ['allowed.example'] },
    )

    const result = await fetcher.fetch('https://blocked.example/file.png')

    expect(result).toEqual({ ok: false, error: 'host not allowed: blocked.example' })
    expect(fetched).toBe(false)
  })

  it('supports one-label wildcards in allowedHosts', async () => {
    const fetcher = createSafeFetcher(
      async () => new Response('ok'),
      mockDnsPublic,
      { allowedHosts: ['*.example.com'] },
    )

    expect((await fetcher.fetch('https://cdn.example.com/file.png')).ok).toBe(true)
    expect((await fetcher.fetch('https://a.cdn.example.com/file.png')).ok).toBe(false)
    expect((await fetcher.fetch('https://example.com/file.png')).ok).toBe(false)
  })

  it('blocks http:// when allowInsecure is false', async () => {
    const fetcher = createSafeFetcher(undefined, mockDnsPublic)
    const result = await fetcher.fetch('http://example.com/foo.png')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/disallowed protocol/)
  })

  it('allows http:// when allowInsecure is true and DNS is public', async () => {
    const okFetch: FetchImpl = async () =>
      new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })
    const fetcher = createSafeFetcher(okFetch, mockDnsPublic, { allowInsecure: true })
    const result = await fetcher.fetch('http://example.com/foo.txt')
    expect(result.ok).toBe(true)
  })

  it('returns ok + bytes + contentType on a successful https fetch', async () => {
    const okFetch: FetchImpl = async () =>
      new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })
    const fetcher = createSafeFetcher(okFetch, mockDnsPublic)
    const result = await fetcher.fetch('https://example.com/foo.txt')
    expect(result.ok).toBe(true)
    expect(result.bytes).toBeTruthy()
    expect(new TextDecoder().decode(result.bytes!)).toBe('hello')
    expect(result.contentType).toBe('text/plain')
  })

  it('pins the connect to the first resolved IP and passes Host header (DNS-rebinding defence)', async () => {
    let receivedUrl: string | URL | Request | undefined
    let receivedInit: RequestInit | undefined
    const captureFetch: FetchImpl = async (input, init) => {
      receivedUrl = input
      receivedInit = init
      return new Response('pinned', { status: 200 })
    }
    const fetcher = createSafeFetcher(captureFetch, mockDnsPublic)
    const result = await fetcher.fetch('https://example.com/path?q=1')
    expect(result.ok).toBe(true)
    // The mock DNS returns 93.184.216.34, so the connect URL must use that IP.
    expect(String(receivedUrl)).toBe('https://93.184.216.34/path?q=1')
    // The original hostname must be preserved as a `Host` header for vhosts.
    expect((receivedInit?.headers as Record<string, string>).Host).toBe('example.com')
  })

  it('does not add a Host header for IP-literal targets', async () => {
    let receivedInit: RequestInit | undefined
    const captureFetch: FetchImpl = async (_input, init) => {
      receivedInit = init
      return new Response('ok', { status: 200 })
    }
    const fetcher = createSafeFetcher(captureFetch, mockDnsPublic)
    const result = await fetcher.fetch('https://93.184.216.34/file.png')
    expect(result.ok).toBe(true)
    // IP literal: no Host header added (and no DNS lookup performed — the
    // mock's record of calls is implicit in the lack of pin).
    expect((receivedInit?.headers as Record<string, string>).Host).toBeUndefined()
  })

  it('blocks a private host literal (10.0.0.1) even with allowInsecure: true', async () => {
    let called = false
    const passthrough: FetchImpl = async () => {
      called = true
      return new Response('', { status: 200 })
    }
    const fetcher = createSafeFetcher(passthrough, mockDnsPublic, { allowInsecure: true })
    const result = await fetcher.fetch('http://10.0.0.1/foo.png')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/private host blocked/)
    expect(called).toBe(false)
  })

  it('blocks hostname that resolves to a private IP (DNS rebinding)', async () => {
    let called = false
    const passthrough: FetchImpl = async () => {
      called = true
      return new Response('', { status: 200 })
    }
    const fetcher = createSafeFetcher(passthrough, mockDnsPrivate)
    const result = await fetcher.fetch('https://attacker.example/foo.png')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/resolves to private address 10\.0\.0\.1/)
    expect(called).toBe(false)
  })

  it('blocks explicit blocked hostnames (localhost, metadata endpoints)', async () => {
    const blocked = [
      'https://localhost/foo',
      'https://127.0.0.1/foo',
      'https://0.0.0.0/foo',
      'https://[::1]/foo',
      'https://169.254.169.254/latest/meta-data/',
      'https://metadata.google.internal/foo',
      'https://metadata.azure.com/foo',
    ]
    for (const url of blocked) {
      const fetcher = createSafeFetcher(undefined, mockDnsPublic)
      const result = await fetcher.fetch(url)
      expect(result.ok).toBe(false)
      // Either "private host blocked" or "blocked hostname" — both acceptable.
      expect(result.error).toMatch(/blocked|private|disallowed/)
    }
  })

  it('returns "asset too large" when the response body exceeds maxBytes', async () => {
    const bigFetch: FetchImpl = async () =>
      new Response(new Uint8Array(1000), { status: 200 })
    const fetcher = createSafeFetcher(bigFetch, mockDnsPublic, { maxBytes: 100 } satisfies SafeFetcherOptions)
    const result = await fetcher.fetch('https://example.com/big.bin')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('asset too large')
  })

  it('returns ok:false when the fetchImpl throws, without leaking an exception', async () => {
    const throwingFetch: FetchImpl = async () => { throw new Error('boom') }
    const fetcher = createSafeFetcher(throwingFetch, mockDnsPublic)
    const result = await fetcher.fetch('https://example.com/x')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/boom/)
  })

  it('returns ok:false when DNS lookup fails', async () => {
    const fetcher = createSafeFetcher(undefined, mockDnsFail)
    const result = await fetcher.fetch('https://nonexistent.example/x')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/DNS lookup failed/)
  })

  it('follows a single redirect and re-validates the target', async () => {
    let callCount = 0
    const redirectFetch: FetchImpl = async (_input) => {
      callCount++
      if (callCount === 1) {
        return new Response('', { status: 302, headers: { location: 'https://example.com/final.png' } })
      }
      return new Response('redirected-body', { status: 200, headers: { 'content-type': 'image/png' } })
    }
    const fetcher = createSafeFetcher(redirectFetch, mockDnsPublic)
    const result = await fetcher.fetch('https://example.com/start.png')
    expect(result.ok).toBe(true)
    expect(new TextDecoder().decode(result.bytes!)).toBe('redirected-body')
    expect(callCount).toBe(2)
  })

  it('rejects a redirect to a private host', async () => {
    let callCount = 0
    const redirectFetch: FetchImpl = async (_input) => {
      callCount++
      if (callCount === 1) {
        return new Response('', { status: 302, headers: { location: 'https://10.0.0.1/loot' } })
      }
      return new Response('should-never-be-read', { status: 200 })
    }
    const fetcher = createSafeFetcher(redirectFetch, mockDnsPublic)
    const result = await fetcher.fetch('https://example.com/start')
    expect(result.ok).toBe(false)
    // Either "redirect to private host blocked" or any clear rejection from the
    // re-validation of the redirect target is acceptable; the test asserts the
    // shape (callCount=1, ok:false), not a specific error string.
    expect(result.error).toMatch(/redirect to|blocked|private|disallowed/)
    expect(callCount).toBe(1)
  })

  it('caps the redirect chain at maxRedirects', async () => {
    const loopFetch: FetchImpl = async () =>
      new Response('', { status: 302, headers: { location: 'https://example.com/loop' } })
    const fetcher = createSafeFetcher(loopFetch, mockDnsPublic, { maxRedirects: 2 })
    const result = await fetcher.fetch('https://example.com/start')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/too many redirects/)
  })
})
