import type { Page, SiteDocument } from '../../../src/core/page-tree/types'
import type { IModuleRegistry } from '../../../src/core/module-engine/types'
import type { TemplateRenderDataContext } from '../../../src/core/templates/dynamicBindings'
import { publishPage } from '../../../src/core/publisher/render'
import {
  buildSiteRuntimeScripts,
  type BuiltRuntimeAssetFile,
  type BuildSiteRuntimeScriptsInput,
  type SiteRuntimeBuildResult,
} from './bundleScripts'

export interface RuntimePreviewDocumentInput {
  site: SiteDocument
  page: Page
  registry: IModuleRegistry
  assetBasePath: string
  dependencyCache?: BuildSiteRuntimeScriptsInput['dependencyCache']
  dependencyNodeModulesDir?: string
  breakpointId?: string
  templateContext?: TemplateRenderDataContext
}

export interface RuntimePreviewDocumentResult extends SiteRuntimeBuildResult {
  html: string
  files: BuiltRuntimeAssetFile[]
}

export async function buildRuntimePreviewDocument(
  input: RuntimePreviewDocumentInput,
): Promise<RuntimePreviewDocumentResult> {
  const runtimeBuild = await buildSiteRuntimeScripts({
    site: input.site,
    page: input.page,
    target: 'canvas',
    assetBasePath: input.assetBasePath,
    dependencyCache: input.dependencyCache,
    dependencyNodeModulesDir: input.dependencyNodeModulesDir,
  })
  const html = publishPage(input.page, input.site, input.registry, {
    breakpointId: input.breakpointId,
    templateContext: input.templateContext,
    runtimeAssets: runtimeBuild.runtimeAssets,
  }).html

  return {
    ...runtimeBuild,
    html,
  }
}
