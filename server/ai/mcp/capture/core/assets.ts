/**
 * Collects asset URLs from HTML + CSS, fetches them with SSRF guard,
 * writes to local disk, and rewrites URLs in the returned blobs.
 * PURE: takes a fetcher interface, not a global. Task 4 will fill this in.
 */
export interface AssetFetcher {
  fetch(url: string): Promise<{ ok: boolean; bytes?: Uint8Array; contentType?: string; error?: string }>
}

export interface CollectedAssets {
  css: string
  html: string
  files: { localPath: string; originalUrl: string }[]
  unavailable: { url: string; reason: string }[]
}

export function collectAssets(
  _html: string,
  _css: string,
  _fetcher: AssetFetcher,
): CollectedAssets {
  throw new Error('not implemented (Task 4)')
}
