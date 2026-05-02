import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { resolveSiteDependencyLock } from '../../../server/cms/runtime/dependencyResolver'
import {
  ensureRuntimeDependencyCache,
  runtimeDependencyLockHash,
} from '../../../server/cms/runtime/dependencyCache'
import type { SiteDependencyLock } from '../../core/site-runtime'

function registryResponse(name: string) {
  return new Response(JSON.stringify({
    name,
    'dist-tags': { latest: '2.0.0' },
    versions: {
      '1.8.0': {
        dist: {
          tarball: `https://registry.example/${name}/-/pkg-1.8.0.tgz`,
          integrity: 'sha512-1',
        },
      },
      '1.9.3': {
        dist: {
          tarball: `https://registry.example/${name}/-/pkg-1.9.3.tgz`,
          integrity: 'sha512-2',
        },
      },
      '2.0.0': {
        dist: {
          tarball: `https://registry.example/${name}/-/pkg-2.0.0.tgz`,
          integrity: 'sha512-3',
        },
      },
    },
  }))
}

describe('runtime dependency resolution', () => {
  it('resolves site dependencies to exact locked versions from npm metadata', async () => {
    const seenUrls: string[] = []
    const lock = await resolveSiteDependencyLock(
      {
        dependencies: {
          'canvas-confetti': '^1.0.0',
        },
        devDependencies: {
          vite: '^7.0.0',
        },
      },
      {
        fetch: async (url) => {
          seenUrls.push(String(url))
          return registryResponse('canvas-confetti')
        },
        now: () => 123,
      },
    )

    expect(seenUrls).toEqual(['https://registry.npmjs.org/canvas-confetti'])
    expect(lock).toEqual({
      version: 1,
      updatedAt: 123,
      packages: {
        'canvas-confetti': {
          name: 'canvas-confetti',
          requested: '^1.0.0',
          version: '1.9.3',
          integrity: 'sha512-2',
          tarballUrl: 'https://registry.example/canvas-confetti/-/pkg-1.9.3.tgz',
          resolvedAt: 123,
        },
      },
    })
  })

  it('uses a stable lock hash independent of package object order', () => {
    const a: SiteDependencyLock = {
      version: 1,
      updatedAt: 100,
      packages: {
        b: { name: 'b', requested: '^1', version: '1.0.0', resolvedAt: 100 },
        a: { name: 'a', requested: '^1', version: '1.0.0', resolvedAt: 100 },
      },
    }
    const b: SiteDependencyLock = {
      version: 1,
      updatedAt: 200,
      packages: {
        a: { name: 'a', requested: '^2', version: '1.0.0', resolvedAt: 200 },
        b: { name: 'b', requested: '^2', version: '1.0.0', resolvedAt: 200 },
      },
    }

    expect(runtimeDependencyLockHash(a)).toBe(runtimeDependencyLockHash(b))
  })

  it('creates an isolated Bun install workspace with lifecycle scripts disabled', async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), 'pb-runtime-cache-test-'))
    const calls: Array<{ command: string[]; cwd: string }> = []
    const lock: SiteDependencyLock = {
      version: 1,
      updatedAt: 100,
      packages: {
        'canvas-confetti': {
          name: 'canvas-confetti',
          requested: '^1.9.3',
          version: '1.9.3',
          resolvedAt: 100,
        },
      },
    }

    try {
      const cache = await ensureRuntimeDependencyCache(lock, {
        cacheRoot,
        runInstall: async (command, options) => {
          calls.push({ command, cwd: options.cwd })
          await mkdir(join(options.cwd, 'node_modules'), { recursive: true })
          await writeFile(join(options.cwd, 'bun.lock'), '', 'utf8')
        },
      })
      const generatedPackage = JSON.parse(await readFile(join(cache.workspaceDir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>
      }

      expect(cache.nodeModulesDir).toBe(join(cache.workspaceDir, 'node_modules'))
      expect(generatedPackage.dependencies).toEqual({ 'canvas-confetti': '1.9.3' })
      expect(calls).toEqual([
        {
          command: [process.execPath, 'install', '--ignore-scripts'],
          cwd: cache.workspaceDir,
        },
      ])
    } finally {
      await rm(cacheRoot, { recursive: true, force: true })
    }
  })
})
