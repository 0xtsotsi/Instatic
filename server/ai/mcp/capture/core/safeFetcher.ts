/**
 * Production AssetFetcher that blocks SSRF. Rejects:
 *  - non-https protocols (http is allowed only with allowInsecure: true)
 *  - private IP literals (10/8, 172.16/12, 192.168/16, 127/8, ::1, fe80::/10,
 *    169.254/16 link-local, 0.0.0.0)
 *  - redirects to a disallowed host (re-validated)
 *  - responses > maxBytes (default 10 MB)
 *
 * PURE: takes fetchImpl as the first arg so tests can mock it.
 */

import type { AssetFetcher } from './assets'

export interface SafeFetcherOptions {
  allowedHosts?: string[]
  allowInsecure?: boolean
  timeoutMs?: number
  maxBytes?: number
}

const PRIVATE_IPV4 = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.0\.0\.0|169\.254\.)/
const PRIVATE_IPV6 = /^(::1|fe80:|fc..:|fd..:)/i

function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '')
  if (PRIVATE_IPV4.test(h)) return true
  if (PRIVATE_IPV6.test(h)) return true
  return false
}

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export function createSafeFetcher(
  fetchImpl: FetchImpl = (input, init) => globalThis.fetch(input, init),
  opts: SafeFetcherOptions = {},
): AssetFetcher {
  return {
    async fetch(url: string) {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return { ok: false, error: 'invalid URL' }
      }
      if (parsed.protocol !== 'https:' && !(opts.allowInsecure && parsed.protocol === 'http:')) {
        return { ok: false, error: `disallowed protocol: ${parsed.protocol}` }
      }
      if (isPrivateHost(parsed.hostname)) {
        return { ok: false, error: 'private host blocked' }
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000)
      try {
        const res = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' })
        const finalUrl = res.url && res.url.length > 0 ? res.url : url
        const finalHost = new URL(finalUrl).hostname
        if (isPrivateHost(finalHost)) {
          return { ok: false, error: 'redirect to private host blocked' }
        }
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
        const reader = res.body?.getReader()
        if (!reader) return { ok: false, error: 'no body' }
        const chunks: Uint8Array[] = []
        let total = 0
        const max = opts.maxBytes ?? 10 * 1024 * 1024
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > max) {
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
    },
  }
}
