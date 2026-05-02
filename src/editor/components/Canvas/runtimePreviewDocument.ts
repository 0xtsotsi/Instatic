import type { CmsRuntimePreviewAsset, CmsRuntimePreviewResult } from '../../../core/persistence/cmsRuntime'

export interface MaterializedRuntimePreviewDocument {
  html: string
  revoke: () => void
}

export function materializeRuntimePreviewDocument(
  result: Pick<CmsRuntimePreviewResult, 'html' | 'assets'>,
): MaterializedRuntimePreviewDocument {
  const replacements = new Map<string, string>()

  for (const asset of result.assets) {
    replacements.set(asset.publicPath, createAssetDataUrl(asset))
  }

  let html = result.html
  for (const [publicPath, url] of replacements) {
    html = replaceAll(html, publicPath, url)
  }
  html = allowSandboxPreviewAssetUrls(html)

  return {
    html,
    revoke: () => {},
  }
}

function createAssetDataUrl(asset: CmsRuntimePreviewAsset): string {
  return `data:${asset.contentType},${encodeDataUrlContent(asset.content)}`
}

function encodeDataUrlContent(content: string): string {
  return encodeURIComponent(content).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function replaceAll(input: string, search: string, replacement: string): string {
  return input.split(search).join(replacement)
}

function allowSandboxPreviewAssetUrls(html: string): string {
  return html.replace(
    /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/,
    (_match, prefix: string, policy: string, suffix: string) =>
      `${prefix}${allowSandboxPreviewAssetPolicy(policy)}${suffix}`,
  )
}

function allowSandboxPreviewAssetPolicy(policy: string): string {
  const directives = policy
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean)

  let hasWorkerSrc = false
  const previewDirectives = directives.map((directive) => {
    if (directive.startsWith('script-src ') && directive.includes("'self'")) {
      return appendCspSources(directive, ['data:'])
    }
    if (directive.startsWith('style-src ') && directive.includes("'self'")) {
      return appendCspSources(directive, ['data:'])
    }
    if (directive.startsWith('worker-src ')) {
      hasWorkerSrc = true
      return "worker-src 'self' blob: data:"
    }
    return directive
  })

  if (!hasWorkerSrc) {
    previewDirectives.push("worker-src 'self' blob: data:")
  }

  return `${previewDirectives.join('; ')};`
}

function appendCspSources(directive: string, sources: string[]): string {
  const parts = directive.split(/\s+/)
  for (const source of sources) {
    if (!parts.includes(source)) {
      parts.push(source)
    }
  }
  return parts.join(' ')
}
