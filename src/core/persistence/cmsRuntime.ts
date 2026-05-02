import type {
  PublishedPageRuntimeAssets,
  SiteDependencyLock,
  SiteRuntimeDiagnostic,
} from '../site-runtime'
import type { SitePackageJson } from '../site-dependencies/manifest'
import type { TemplateRenderDataContext } from '../templates/dynamicBindings'
import { responseErrorMessage } from './httpErrors'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface CmsRuntimePreviewAsset {
  path: string
  publicPath: string
  content: string
  contentType: string
}

export interface CmsRuntimePreviewResult {
  html: string
  assets: CmsRuntimePreviewAsset[]
  runtimeAssets: PublishedPageRuntimeAssets
  diagnostics: SiteRuntimeDiagnostic[]
}

export interface CmsRuntimePreviewInput {
  site: unknown
  pageId: string
  breakpointId?: string
  templateContext?: TemplateRenderDataContext
}

export async function resolveCmsRuntimeDependencies(
  packageJson: SitePackageJson,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<SiteDependencyLock> {
  const res = await fetchImpl(`${basePath}/runtime/dependencies/resolve`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ packageJson }),
  })
  if (!res.ok) {
    throw new Error(await responseErrorMessage(res, `Runtime dependency resolution failed with ${res.status}`))
  }
  const body = await res.json() as { dependencyLock: SiteDependencyLock }
  return body.dependencyLock
}

export async function buildCmsRuntimePreview(
  input: CmsRuntimePreviewInput,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<CmsRuntimePreviewResult> {
  const res = await fetchImpl(`${basePath}/runtime/preview`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    throw new Error(await responseErrorMessage(res, `Runtime preview build failed with ${res.status}`))
  }
  return await res.json() as CmsRuntimePreviewResult
}
