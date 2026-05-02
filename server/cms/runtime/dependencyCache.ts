import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SiteDependencyLock } from '../../../src/core/site-runtime'

export interface RuntimeDependencyCache {
  hash: string
  workspaceDir: string
  nodeModulesDir: string
}

export interface RuntimeInstallOptions {
  cwd: string
  env: Record<string, string>
}

export type RuntimeInstallRunner = (
  command: string[],
  options: RuntimeInstallOptions,
) => Promise<void>

export interface EnsureRuntimeDependencyCacheOptions {
  cacheRoot?: string
  bunExecutable?: string
  runInstall?: RuntimeInstallRunner
}

function sortedExactDependencies(lock: SiteDependencyLock): Record<string, string> {
  return Object.fromEntries(
    Object.values(lock.packages)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((dependency) => [dependency.name, dependency.version]),
  )
}

export function runtimeDependencyLockHash(lock: SiteDependencyLock): string {
  const exactDependencies = sortedExactDependencies(lock)
  const payload = JSON.stringify(exactDependencies)
  return createHash('sha256').update(payload).digest('hex').slice(0, 24)
}

function defaultCacheRoot(): string {
  return process.env.RUNTIME_CACHE_DIR || join(tmpdir(), 'page-builder-runtime-cache')
}

async function defaultRunInstall(command: string[], options: RuntimeInstallOptions): Promise<void> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exitCode = await proc.exited
  if (exitCode === 0) return

  const stderr = await new Response(proc.stderr).text()
  throw new Error(`[runtime dependency cache] install failed (${exitCode}): ${stderr}`)
}

export async function ensureRuntimeDependencyCache(
  lock: SiteDependencyLock,
  options: EnsureRuntimeDependencyCacheOptions = {},
): Promise<RuntimeDependencyCache> {
  const hash = runtimeDependencyLockHash(lock)
  const cacheRoot = options.cacheRoot ?? defaultCacheRoot()
  const workspaceDir = join(cacheRoot, 'deps', hash)
  const nodeModulesDir = join(workspaceDir, 'node_modules')
  const packageJsonPath = join(workspaceDir, 'package.json')
  const exactDependencies = sortedExactDependencies(lock)

  await mkdir(workspaceDir, { recursive: true })
  await writeFile(packageJsonPath, JSON.stringify({
    private: true,
    name: `page-builder-runtime-${hash}`,
    version: '0.0.0',
    type: 'module',
    dependencies: exactDependencies,
  }, null, 2), 'utf8')

  if (!existsSync(nodeModulesDir)) {
    const command = [options.bunExecutable ?? process.execPath, 'install', '--ignore-scripts']
    await (options.runInstall ?? defaultRunInstall)(command, {
      cwd: workspaceDir,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        BUN_CONFIG_IGNORE_SCRIPTS: '1',
      },
    })
  }

  return {
    hash,
    workspaceDir,
    nodeModulesDir,
  }
}
