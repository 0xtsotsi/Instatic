/**
 * sitePanelSlice — Dependency management state (Phase E+).
 *
 * Owns the in-memory `packageJson` manifest.
 * The SitePanel overlay UI was deleted in Task #434 (Guideline #410: 5-panel layout);
 * DependenciesPanel now owns all dependency UI through DepsSection.tsx.
 *
 * This slice owns dependency-adjacent editor state:
 *   - packageJson         in-memory package.json manifest
 *   - siteRuntime         runtime lock + script load settings
 *   - setDependency       add/update a dependency
 *   - removeDependency    remove from both dependency buckets
 *
 * All setters include no-op guards (Guideline #242).
 *
 * @see Guideline #341 — Zustand Store Slice Registry (addendum)
 * @see Guideline #242 — Zustand Object Setters Must Guard Against No-Op Mutations
 * @see Task #434 — Migration & SitePanel Cleanup
 * @see Task #441 — Post-#434 Orphan Sweep (panel-toggle fields removed)
 */

import type { StateCreator } from 'zustand'
import type { EditorStore } from '../store'
import type {
  SiteDependencyLock,
  SiteRuntimeConfig,
  SiteScriptRuntimeConfig,
} from '../../site-runtime/types'
import {
  clonePackageJson,
  DEFAULT_SITE_PACKAGE_JSON,
  type SitePackageJson,
} from '../../site-dependencies/manifest'
import { isSafePackageName } from '../../site-dependencies/packageNames'
import {
  cloneSiteRuntimeConfig,
  DEFAULT_SITE_RUNTIME,
  normalizeScriptRuntimeConfig,
  normalizeSiteRuntimeConfig,
} from '../../site-runtime'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal package.json shape for the in-memory manifest.
 * Stores only the dependency maps relevant to DependenciesPanel.
 */
type PackageJson = SitePackageJson

export interface SitePanelSlice {
  /**
   * In-memory package.json manifest.
   * Tracks intended site deps; installing is a separate bridge concern.
   */
  packageJson: PackageJson

  /**
   * Top-level mirror of `site.runtime` for granular subscriptions in script and
   * dependency panels. The persisted source of truth remains SiteDocument.
   */
  siteRuntime: SiteRuntimeConfig

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Add or update a dependency in the in-memory manifest.
   * @param name    npm package name (must pass SAFE_PACKAGE_NAME before dispatch)
   * @param version semver string, e.g. "^18.2.0" or "*"
   * @param dev     true → devDependencies; false/undefined → dependencies
   */
  setDependency: (name: string, version: string, dev?: boolean) => void

  /**
   * Remove a package from both dependencies and devDependencies.
   */
  removeDependency: (name: string) => void

  /**
   * Replace the runtime config for a script file.
   */
  setScriptRuntimeConfig: (fileId: string, config: SiteScriptRuntimeConfig) => void

  /**
   * Patch the runtime config for a script file.
   */
  patchScriptRuntimeConfig: (fileId: string, patch: Partial<SiteScriptRuntimeConfig>) => void

  /**
   * Remove stored runtime settings for a script file.
   */
  removeScriptRuntimeConfig: (fileId: string) => void

  /**
   * Replace the self-hosted dependency lock after packages are resolved.
   */
  setSiteDependencyLock: (lock: SiteDependencyLock) => void

}

// ---------------------------------------------------------------------------
// Slice factory
// ---------------------------------------------------------------------------

export const createSitePanelSlice: StateCreator<
  EditorStore,
  [],
  [],
  SitePanelSlice
> = (set, get) => ({
  packageJson: clonePackageJson(DEFAULT_SITE_PACKAGE_JSON),
  siteRuntime: cloneSiteRuntimeConfig(DEFAULT_SITE_RUNTIME),

  setDependency: (name, version, dev = false) => {
    if (!isSafePackageName(name)) return
    const safeVersion = version.trim() || '*'
    const current = get().packageJson
    const bucket = dev ? 'devDependencies' : 'dependencies'
    const otherBucket = dev ? 'dependencies' : 'devDependencies'
    // No-op guard (Guideline #242): skip if value unchanged and no bucket move is needed.
    if (Object.is(current[bucket][name], safeVersion) && !(name in current[otherBucket])) return
    if (get().site) get().pushHistory()
    set((s) => {
      const nextBucket = { ...s.packageJson[bucket], [name]: safeVersion }
      const nextOtherBucket = { ...s.packageJson[otherBucket] }
      delete nextOtherBucket[name]
      const nextPackageJson = {
        ...s.packageJson,
        [bucket]: nextBucket,
        [otherBucket]: nextOtherBucket,
      }
      return {
        packageJson: nextPackageJson,
        site: s.site
          ? { ...s.site, packageJson: nextPackageJson, updatedAt: Date.now() }
          : s.site,
        hasUnsavedChanges: Boolean(s.site) || s.hasUnsavedChanges,
      }
    })
  },

  removeDependency: (name) => {
    const { dependencies, devDependencies } = get().packageJson
    // No-op guard: package not present in either bucket
    if (!(name in dependencies) && !(name in devDependencies)) return
    if (get().site) get().pushHistory()
    set((s) => {
      const deps = { ...s.packageJson.dependencies }
      const devDeps = { ...s.packageJson.devDependencies }
      delete deps[name]
      delete devDeps[name]
      const nextPackageJson = { ...s.packageJson, dependencies: deps, devDependencies: devDeps }
      return {
        packageJson: nextPackageJson,
        site: s.site
          ? { ...s.site, packageJson: nextPackageJson, updatedAt: Date.now() }
          : s.site,
        hasUnsavedChanges: Boolean(s.site) || s.hasUnsavedChanges,
      }
    })
  },

  setScriptRuntimeConfig: (fileId, config) => {
    const site = get().site
    if (!site?.files.some((file) => file.id === fileId && file.type === 'script')) return

    const currentRuntime = get().siteRuntime
    const nextConfig = normalizeScriptRuntimeConfig(config)
    const currentConfig = currentRuntime.scripts[fileId]
    if (JSON.stringify(currentConfig) === JSON.stringify(nextConfig)) return

    get().pushHistory()
    set((s) => {
      const nextRuntime = {
        ...s.siteRuntime,
        scripts: {
          ...s.siteRuntime.scripts,
          [fileId]: nextConfig,
        },
      }
      return {
        siteRuntime: nextRuntime,
        site: s.site
          ? { ...s.site, runtime: nextRuntime, updatedAt: Date.now() }
          : s.site,
        hasUnsavedChanges: true,
      }
    })
  },

  patchScriptRuntimeConfig: (fileId, patch) => {
    const current = get().siteRuntime.scripts[fileId] ?? normalizeScriptRuntimeConfig(undefined)
    get().setScriptRuntimeConfig(fileId, {
      ...current,
      ...patch,
    })
  },

  removeScriptRuntimeConfig: (fileId) => {
    const currentRuntime = get().siteRuntime
    if (!(fileId in currentRuntime.scripts)) return

    get().pushHistory()
    set((s) => {
      const scripts = { ...s.siteRuntime.scripts }
      delete scripts[fileId]
      const nextRuntime = { ...s.siteRuntime, scripts }
      return {
        siteRuntime: nextRuntime,
        site: s.site
          ? { ...s.site, runtime: nextRuntime, updatedAt: Date.now() }
          : s.site,
        hasUnsavedChanges: true,
      }
    })
  },

  setSiteDependencyLock: (lock) => {
    const nextLock = normalizeSiteRuntimeConfig({ dependencyLock: lock }).dependencyLock
    const currentLock = get().siteRuntime.dependencyLock
    if (JSON.stringify(currentLock) === JSON.stringify(nextLock)) return

    if (get().site) get().pushHistory()
    set((s) => {
      const nextRuntime = {
        ...s.siteRuntime,
        dependencyLock: nextLock,
      }
      return {
        siteRuntime: nextRuntime,
        site: s.site
          ? { ...s.site, runtime: nextRuntime, updatedAt: Date.now() }
          : s.site,
        hasUnsavedChanges: Boolean(s.site) || s.hasUnsavedChanges,
      }
    })
  },

})
