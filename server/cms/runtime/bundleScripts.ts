import { relative, sep } from 'node:path'
import * as esbuild from 'esbuild'
import type { Page, SiteDocument } from '../../../src/core/page-tree/types'
import {
  analyzeRuntimeScriptImports,
  collectRuntimeScripts,
  normalizeSiteRuntimeConfig,
} from '../../../src/core/site-runtime'
import type {
  PublishedPageRuntimeAssets,
  RuntimeScriptEntry,
  SiteRuntimeDiagnostic,
  SiteRuntimeTarget,
} from '../../../src/core/site-runtime/types'
import {
  clonePackageJson,
  DEFAULT_SITE_PACKAGE_JSON,
} from '../../../src/core/site-dependencies/manifest'
import type { RuntimeDependencyCache } from './dependencyCache'
import { materializeSiteScriptWorkspace } from './virtualSiteWorkspace'

export interface BuiltRuntimeAssetFile {
  path: string
  publicPath: string
  content: string
  bytes: Uint8Array
  contentType: string
}

export interface SiteRuntimeBuildResult {
  files: BuiltRuntimeAssetFile[]
  runtimeAssets: PublishedPageRuntimeAssets
  diagnostics: SiteRuntimeDiagnostic[]
}

export interface BuildSiteRuntimeScriptsInput {
  site: SiteDocument
  page: Page
  target: SiteRuntimeTarget
  assetBasePath: string
  dependencyCache?: Pick<RuntimeDependencyCache, 'nodeModulesDir'>
  dependencyNodeModulesDir?: string
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/')
}

function joinPublicPath(basePath: string, path: string): string {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`
  return `${base}${path.replace(/^\/+/, '')}`
}

function contentTypeForPath(path: string): string {
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  if (path.endsWith('.map')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function emptyRuntimeBuild(diagnostics: SiteRuntimeDiagnostic[] = []): SiteRuntimeBuildResult {
  return {
    files: [],
    runtimeAssets: { scripts: [] },
    diagnostics,
  }
}

function esbuildDiagnostics(error: unknown): SiteRuntimeDiagnostic[] {
  if (
    error &&
    typeof error === 'object' &&
    'errors' in error &&
    Array.isArray((error as { errors: unknown }).errors)
  ) {
    return (error as { errors: Array<{ text?: string; location?: { file?: string; line?: number; column?: number } }> }).errors
      .map((item) => ({
        code: 'runtime-bundle-error',
        severity: 'error' as const,
        message: item.text ?? 'Runtime script bundle failed',
        path: item.location?.file,
        line: item.location?.line,
        column: item.location?.column,
      }))
  }

  return [{
    code: 'runtime-bundle-error',
    severity: 'error',
    message: error instanceof Error ? error.message : 'Runtime script bundle failed',
  }]
}

function selectedScriptByEntryPoint(
  selectedScripts: RuntimeScriptEntry[],
  entryPointByFileId: Map<string, string>,
  rootDir: string,
): Map<string, RuntimeScriptEntry> {
  const entries = new Map<string, RuntimeScriptEntry>()
  for (const script of selectedScripts) {
    const absolutePath = entryPointByFileId.get(script.file.id)
    if (!absolutePath) continue
    entries.set(toPosixPath(relative(rootDir, absolutePath)), script)
  }
  return entries
}

export async function buildSiteRuntimeScripts(
  input: BuildSiteRuntimeScriptsInput,
): Promise<SiteRuntimeBuildResult> {
  const runtime = normalizeSiteRuntimeConfig(input.site.runtime)
  const selectedScripts = collectRuntimeScripts({
    files: input.site.files,
    runtime,
    page: input.page,
    target: input.target,
  })

  if (selectedScripts.length === 0) return emptyRuntimeBuild()

  const packageJson = clonePackageJson(input.site.packageJson ?? DEFAULT_SITE_PACKAGE_JSON)
  const importAnalysis = analyzeRuntimeScriptImports(
    selectedScripts.map((entry) => entry.file),
    packageJson,
  )
  const blockingDiagnostics = importAnalysis.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (blockingDiagnostics.length > 0) return emptyRuntimeBuild(importAnalysis.diagnostics)

  const workspace = await materializeSiteScriptWorkspace(input.site)
  try {
    const entryPoints = selectedScripts
      .map((entry) => workspace.entryPointByFileId.get(entry.file.id))
      .filter((entryPoint): entryPoint is string => Boolean(entryPoint))

    if (entryPoints.length === 0) return emptyRuntimeBuild()

    const outputRoot = 'out'
    const splitRuntimeChunks = input.target === 'publish'
    const build = await esbuild.build({
      absWorkingDir: workspace.rootDir,
      assetNames: 'assets/[name]-[hash]',
      bundle: true,
      chunkNames: 'chunks/[name]-[hash]',
      entryNames: 'entries/[name]-[hash]',
      entryPoints,
      format: 'esm',
      logLevel: 'silent',
      metafile: true,
      nodePaths: [
        ...(
          input.dependencyCache?.nodeModulesDir
            ? [input.dependencyCache.nodeModulesDir]
            : []
        ),
        ...(input.dependencyNodeModulesDir ? [input.dependencyNodeModulesDir] : []),
      ],
      outdir: outputRoot,
      platform: 'browser',
      sourcemap: false,
      splitting: splitRuntimeChunks,
      target: ['es2020'],
      write: false,
    })

    const files = build.outputFiles.map((file) => {
      const path = toPosixPath(relative(`${workspace.rootDir}/${outputRoot}`, file.path))
      return {
        path,
        publicPath: joinPublicPath(input.assetBasePath, path),
        content: file.text,
        bytes: file.contents,
        contentType: contentTypeForPath(path),
      }
    })
    const publicPathByOutput = new Map(files.map((file) => [`${outputRoot}/${file.path}`, file.publicPath]))
    const selectedByEntryPoint = selectedScriptByEntryPoint(
      selectedScripts,
      workspace.entryPointByFileId,
      workspace.rootDir,
    )

    const scripts = Object.entries(build.metafile.outputs)
      .map(([outputPath, output]) => {
        if (!output.entryPoint) return null
        const script = selectedByEntryPoint.get(output.entryPoint)
        const src = publicPathByOutput.get(outputPath)
        if (!script || !src) return null
        return {
          fileId: script.file.id,
          src,
          placement: script.config.placement,
          timing: script.config.timing,
          priority: script.config.priority,
        }
      })
      .filter((script): script is PublishedPageRuntimeAssets['scripts'][number] => script !== null)
      .sort((a, b) => a.priority - b.priority || a.src.localeCompare(b.src))

    return {
      files,
      runtimeAssets: { scripts },
      diagnostics: importAnalysis.diagnostics,
    }
  } catch (error) {
    return emptyRuntimeBuild([...importAnalysis.diagnostics, ...esbuildDiagnostics(error)])
  } finally {
    await workspace.cleanup()
  }
}
