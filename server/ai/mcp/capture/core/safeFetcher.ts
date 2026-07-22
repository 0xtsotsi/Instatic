/**
 * Production AssetFetcher that blocks SSRF. Rejects:
 *  - non-https protocols (http is allowed only with allowInsecure: true)
 *  - explicit BLOCKED_HOSTNAMES (localhost, loopback, cloud metadata endpoints)
 *  - private IP literals AND hostnames that resolve to private IPs (DNS rebinding)
 *  - redirects to a disallowed host (re-validated per hop, up to MAX_REDIRECTS)
 *  - responses > maxBytes (default 10 MB)
 *
 * PURE: takes fetchImpl + dnsLookup as deps so tests can mock without globals.
 *
 * SSRF design follows the consensus from Novu, Vercel AI, Kibana, and
 * Inbox-Zero: manual redirect loop with per-hop revalidation, and
 * explicit DNS resolution (verbatim) to defeat DNS rebinding.
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { AssetFetcher } from './assets'

/**
 * Convert a resolved IP address back into a URL-safe form for embedding into
 * the request URL. IPv6 addresses must be wrapped in `[...]` per RFC 3986.
 */
function ipToHostLiteral(addr: string): string {
  return addr.includes(':') ? `[${addr}]` : addr
}

export interface SafeFetcherOptions {
  allowedHosts?: string[]
  allowInsecure?: boolean
  timeoutMs?: number
  maxBytes?: number
  /** Cap on manual redirect hops. Default 3 (matches Novu / Vercel AI / CowAgent). */
  maxRedirects?: number
}

/** Hosts to block outright. Checked BEFORE the IP regex and DNS resolution. */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  '169.254.169.254', // AWS / GCP / Azure instance metadata
  'metadata.google.internal',
  'metadata.azure.com',
  'metadata.internal',
  'instance-data',
  'computemetadata',
  'link-local.s3.amazonaws.com',
])

const PRIVATE_IPV4 = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.0\.0\.0|169\.254\.)/
const PRIVATE_IPV6 = /^(::1|fe80:|fc..:|fd..:)/i

function isPrivateLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '')
  if (PRIVATE_IPV4.test(h)) return true
  if (PRIVATE_IPV6.test(h)) return true
  return false
}

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type DnsLookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<{ address: string; family: number }[]>

const MAX_REDIRECTS_DEFAULT = 3
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

export function createSafeFetcher(
  fetchImpl: FetchImpl = (input, init) => globalThis.fetch(input as never, init),
  dnsLookup: DnsLookup = (hostname, options) => lookup(hostname, options) as unknown as Promise<{ address: string; family: number }[]>,
  opts: SafeFetcherOptions = {},
): AssetFetcher {
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS_DEFAULT
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024
  const timeoutMs = opts.timeoutMs ?? 10000

  /**
   * Validate a single URL string AND resolve it to a connect-safe URL.
   * Returns { connectUrl, hostHeader } on success, or { error } on failure.
   *
   * The connectUrl has the hostname replaced by the first resolved IP, which
   * closes the TOCTOU window for DNS rebinding: even if the attacker's
   * resolver rotates between validation and connect, fetchImpl talks to the
   * exact IP we validated. The original host is sent via the `Host` header so
   * vhosts still work.
   *
   * For an IP literal or a redirect target that's already a connect-safe IP,
   * no DNS lookup is performed and connectUrl equals the input.
   */
  async function resolveAndValidate(
    input: string,
  ): Promise<{ connectUrl: string; hostHeader: string | null } | { error: string }> {
    let parsed: URL
    try {
      parsed = new URL(input)
    } catch {
      return { error: 'invalid URL' }
    }
    if (parsed.protocol !== 'https:' && !(opts.allowInsecure && parsed.protocol === 'http:')) {
      return { error: `disallowed protocol: ${parsed.protocol}` }
    }
    const host = parsed.hostname
    if (BLOCKED_HOSTNAMES.has(host)) return { error: `blocked hostname: ${host}` }
    if (isPrivateLiteral(host)) return { error: 'private host blocked' }

    // IP literal: already connect-safe, no DNS lookup needed.
    if (isIP(host) !== 0) {
      return { connectUrl: input, hostHeader: null }
    }

    // Hostname: resolve and check every returned address.
    let addrs: { address: string; family: number }[]
    try {
      addrs = await dnsLookup(host, { all: true, verbatim: true })
    } catch {
      return { error: `DNS lookup failed for ${host}` }
    }
    for (const a of addrs) {
      if (isPrivateLiteral(a.address)) {
        return { error: `hostname ${host} resolves to private address ${a.address}` }
      }
    }
    // Pin the connection to the first resolved address — closes the DNS-rebinding window.
    const pinnedIp = addrs[0]!.address
    const portPart = parsed.port ? `:${parsed.port}` : ''
    const connectUrl = `${parsed.protocol}//${ipToHostLiteral(pinnedIp)}${portPart}${parsed.pathname}${parsed.search}`
    return { connectUrl, hostHeader: host }
  }

  return {
    async fetch(url: string) {
      // Initial URL resolution. Re-resolves per hop inside the loop.
      const initial = await resolveAndValidate(url)
      if ('error' in initial) return { ok: false, error: initial.error }

      let currentConnect = initial.connectUrl
      let currentHostHeader = initial.hostHeader
      for (let hop = 0; hop <= maxRedirects; hop++) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          // Build the request headers. If we pinned to a resolved IP, set the
          // `Host` header to the original hostname so vhosts work.
          const reqHeaders: Record<string, string> = currentHostHeader
            ? { Host: currentHostHeader }
            : {}
          const res = await fetchImpl(currentConnect, {
            signal: controller.signal,
            redirect: 'manual',
            headers: reqHeaders,
          })

          // Manual redirect: check the status and re-resolve the Location.
          if (REDIRECT_STATUSES.has(res.status)) {
            if (hop >= maxRedirects) {
              return { ok: false, error: `too many redirects (>${maxRedirects})` }
            }
            const location = res.headers.get('location')
            if (!location) return { ok: false, error: 'redirect with no Location' }
            // Resolve relative redirects against the ORIGINAL request URL
            // (not the pinned-IP connect URL) so redirect targets make sense.
            const nextHref = new URL(location, url).href
            const next = await resolveAndValidate(nextHref)
            if ('error' in next) return { ok: false, error: `redirect to ${next.error}` }
            // Drain and close this body before the next hop.
            await res.body?.cancel().catch(() => {})
            currentConnect = next.connectUrl
            currentHostHeader = next.hostHeader
            continue
          }

          if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }

          // Final response — read with size cap.
          const reader = res.body?.getReader()
          if (!reader) return { ok: false, error: 'no body' }
          const chunks: Uint8Array[] = []
          let total = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > maxBytes) {
              await reader.cancel()
              return { ok: false, error: 'asset too large' }
            }
            chunks.push(value)
          }
          const bytes = new Uint8Array(total)
          let off = 0
          for (const c of chunks) { bytes.set(c, off); off += c.byteLength }
          return { ok: true, bytes, contentType: res.headers.get('content-type') ?? undefined }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        } finally {
          clearTimeout(timer)
        }
      }
      return { ok: false, error: 'redirect loop terminated without response' }
    },
  }
}
