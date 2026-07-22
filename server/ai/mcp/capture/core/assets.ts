/**
 * Walk HTML and CSS, find all asset URLs (img src, srcset, background-image url(...),
 * @font-face src url(...)), fetch each via the injected fetcher, and rewrite the
 * URL in the returned blobs to a local path.
 *
 * The fetcher is injected so core/ stays PURE — production code injects a real
 * fetcher that does the SSRF allowlist check, tests inject a mock.
 *
 * PURE: no Instatic imports, no direct fetch() at module level.
 */

export interface AssetFetcher {
  fetch(url: string): Promise<{ ok: boolean; bytes?: Uint8Array; contentType?: string; error?: string }>
}

export interface CollectedAsset {
  localPath: string
  originalUrl: string
}

export interface UnavailableAsset {
  url: string
  reason: string
}

export interface CollectedAssets {
  html: string
  css: string
  files: CollectedAsset[]
  unavailable: UnavailableAsset[]
}

export interface CollectAssetsOptions {
  baseUrl: string
  maxAssets?: number
  resolveLocalPath?: (url: string) => string
  persist?: (localPath: string, bytes: Uint8Array, contentType: string) => Promise<void> | void
}

const CSS_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g
const HTML_SRC_RE = /(?:src|srcset)\s*=\s*['"]([^'"]+)['"]/g

function extractCssUrls(css: string): string[] {
  const out: string[] = []
  for (const m of css.matchAll(CSS_URL_RE)) out.push(m[1]!)
  return out
}

function extractHtmlUrls(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(HTML_SRC_RE)) {
    const v = m[1]!
    const trimmed = v.trim()
    // If the entire src/srcset value is a data: / javascript: / mailto: /
    // blob: scheme, skip it entirely — the srcset comma-split would
    // otherwise misinterpret the comma inside a data: URI.
    if (
      trimmed.startsWith('data:') ||
      trimmed.startsWith('javascript:') ||
      trimmed.startsWith('mailto:') ||
      trimmed.startsWith('blob:')
    ) continue
    for (const part of v.split(/,\s*/)) {
      const url = part.trim().split(/\s+/)[0]
      if (url) out.push(url)
    }
  }
  return out
}

function resolveAbsoluteUrl(base: string, url: string): string | null {
  try {
    return new URL(url, base).href
  } catch {
    return null
  }
}

function isAssetWorthy(url: string): boolean {
  if (
    url.startsWith('data:') ||
    url.startsWith('javascript:') ||
    url.startsWith('mailto:') ||
    url.startsWith('#') ||
    url.startsWith('blob:')
  ) return false
  return true
}

function fnv1a32(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).padStart(8, '0')
}

function defaultResolveLocalPath(url: string): string {
  let ext = ''
  try {
    const u = new URL(url)
    const p = u.pathname
    const dot = p.lastIndexOf('.')
    if (dot > -1 && dot > p.lastIndexOf('/')) {
      ext = p.slice(dot).slice(0, 8)
    }
  } catch { /* ignore */ }
  return `assets/${fnv1a32(url)}${ext}`
}

export async function collectAssets(
  html: string,
  css: string,
  fetcher: AssetFetcher,
  options: CollectAssetsOptions,
): Promise<CollectedAssets> {
  const max = options.maxAssets ?? 25
  const resolvePath = options.resolveLocalPath ?? defaultResolveLocalPath

  const candidates = new Set<string>()
  for (const u of extractHtmlUrls(html)) {
    if (!isAssetWorthy(u)) continue
    const abs = resolveAbsoluteUrl(options.baseUrl, u)
    if (abs) candidates.add(abs)
  }
  for (const u of extractCssUrls(css)) {
    if (!isAssetWorthy(u)) continue
    const abs = resolveAbsoluteUrl(options.baseUrl, u)
    if (abs) candidates.add(abs)
  }

  const files: CollectedAsset[] = []
  const unavailable: UnavailableAsset[] = []
  const urlToLocal = new Map<string, string>()

  let count = 0
  for (const url of candidates) {
    if (count >= max) {
      unavailable.push({ url, reason: 'max assets reached' })
      continue
    }
    count++
    const result = await fetcher.fetch(url)
    if (!result.ok || !result.bytes) {
      unavailable.push({ url, reason: result.error ?? 'fetch failed' })
      continue
    }
    const localPath = resolvePath(url)
    urlToLocal.set(url, localPath)
    files.push({ localPath, originalUrl: url })
    if (options.persist) {
      await options.persist(localPath, result.bytes, result.contentType ?? 'application/octet-stream')
    }
  }

  let rewrittenHtml = html
  let rewrittenCss = css
  for (const [orig, local] of urlToLocal) {
    const escaped = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    rewrittenHtml = rewrittenHtml.replace(new RegExp(escaped, 'g'), local)
    rewrittenCss = rewrittenCss.replace(new RegExp(escaped, 'g'), local)
  }
  return { html: rewrittenHtml, css: rewrittenCss, files, unavailable }
}
