import { produce } from 'immer'
import { nanoid } from 'nanoid'
import type { StateCreator } from 'zustand'
import type { EditorStore } from '../store'
import { renderCache } from '../../engine/renderCache'
import { registry } from '../../module-engine/registry'
import {
  type SiteDocument,
  type Page,
  type PageNode,
  type Breakpoint,
  type SiteSettings,
  type PageTemplateConfig,
  type DynamicPropBinding,
  type FrameworkColorCategory,
  type FrameworkColorToken,
  type FrameworkColorUtilityType,
  DEFAULT_BREAKPOINTS,
  DEFAULT_SITE_SETTINGS,
  createNode,
  addPage,
  deletePage,
  renamePage,
  reorderPages,
  insertNode,
  deleteNode,
  updateNodeProps,
  setBreakpointOverride,
  clearBreakpointOverride,
  renameNode,
  toggleNodeLocked,
  toggleNodeHidden,
  moveNode,
  duplicateNode,
  wrapNode,
} from '../../page-tree'
import {
  clonePackageJson,
  DEFAULT_SITE_PACKAGE_JSON,
} from '../../site-dependencies/manifest'
import {
  cloneSiteRuntimeConfig,
  DEFAULT_SITE_RUNTIME,
} from '../../site-runtime'
import {
  generateDefaultDarkColor,
  generateFrameworkColorUtilityClasses,
  normalizeFrameworkColorSlug,
} from '../../framework/colors'

/** Maximum undo history depth — prevents unbounded memory growth */
const MAX_HISTORY = 50

export interface SiteSlice {
  site: SiteDocument | null

  // SiteDocument lifecycle
  createSite: (name: string) => SiteDocument
  loadSite: (site: SiteDocument) => void
  clearSite: () => void
  updateSiteName: (name: string) => void

  // Page mutations
  addPage: (title: string, slug?: string) => Page
  deletePage: (pageId: string) => void
  renamePage: (pageId: string, title: string, slug?: string) => void
  reorderPages: (fromIndex: number, toIndex: number) => void
  convertPageToTemplate: (pageId: string, config: PageTemplateConfig) => void
  convertTemplateToPage: (pageId: string) => void

  // Node mutations (operate on the active page)
  insertNode: (moduleId: string, defaults: Record<string, unknown>, parentId: string, index?: number) => string
  deleteNode: (nodeId: string) => void
  updateNodeProps: (nodeId: string, patch: Record<string, unknown>) => void
  setBreakpointOverride: (nodeId: string, breakpointId: string, patch: Record<string, unknown>) => void
  clearBreakpointOverride: (nodeId: string, breakpointId: string) => void
  renameNode: (nodeId: string, label: string) => void
  toggleNodeLocked: (nodeId: string) => void
  toggleNodeHidden: (nodeId: string) => void
  moveNode: (nodeId: string, newParentId: string, newIndex: number) => void
  duplicateNode: (nodeId: string) => string
  wrapNode: (nodeId: string, containerModuleId: string, defaults?: Record<string, unknown>) => string
  setNodeDynamicBinding: (nodeId: string, propKey: string, binding: DynamicPropBinding) => void
  clearNodeDynamicBinding: (nodeId: string, propKey: string) => void

  // Breakpoint mutations
  addBreakpoint: (bp: Omit<Breakpoint, 'id'>) => Breakpoint
  updateBreakpoint: (id: string, patch: Partial<Omit<Breakpoint, 'id'>>) => void
  removeBreakpoint: (id: string) => void
  reorderBreakpoints: (fromIndex: number, toIndex: number) => void

  // SiteDocument settings mutations
  updateSiteSettings: (patch: Partial<SiteSettings>) => void

  // Framework color mutations
  createFrameworkColorCategory: (name: string) => FrameworkColorCategory
  renameFrameworkColorCategory: (categoryId: string, name: string) => void
  deleteFrameworkColorCategory: (categoryId: string) => void
  createFrameworkColorToken: (input: CreateFrameworkColorTokenInput) => FrameworkColorToken
  updateFrameworkColorToken: (tokenId: string, patch: UpdateFrameworkColorTokenPatch) => void
  duplicateFrameworkColorToken: (tokenId: string) => FrameworkColorToken | null
  reorderFrameworkColorToken: (tokenId: string, direction: 'up' | 'down') => void
  deleteFrameworkColorToken: (tokenId: string) => void

  // ─── Undo / Redo ──────────────────────────────────────────────────────────
  /** Snapshots of previous site states — most recent last */
  _historyPast: SiteDocument[]
  /** Snapshots popped by undo, available for redo — most recent last */
  _historyFuture: SiteDocument[]
  /** True if there's at least one state to undo to */
  canUndo: boolean
  /** True if there's at least one state to redo to */
  canRedo: boolean
  undo: () => void
  redo: () => void
  /**
   * Call before any undoable mutation to snapshot the current site.
   * Exposed so external code (e.g., batch operations) can manage history.
   */
  pushHistory: () => void
}

type ColorVariantOptions = { enabled: boolean; count: number }

interface CreateFrameworkColorTokenInput {
  categoryId?: string | null
  slug: string
  lightValue: string
  darkValue?: string
  darkModeEnabled?: boolean
  generateUtilities?: Partial<Record<FrameworkColorUtilityType, boolean>>
  generateTransparent?: boolean
  generateShades?: Partial<ColorVariantOptions>
  generateTints?: Partial<ColorVariantOptions>
}

type UpdateFrameworkColorTokenPatch = Partial<{
  categoryId: string | null
  slug: string
  lightValue: string
  darkValue: string
  darkModeEnabled: boolean
  generateUtilities: Partial<Record<FrameworkColorUtilityType, boolean>>
  generateTransparent: boolean
  generateShades: Partial<ColorVariantOptions>
  generateTints: Partial<ColorVariantOptions>
  order: number
}>

function createDefaultSiteDocument(name: string): SiteDocument {
  const rootNode = createNode('base.root')
  const homePage: Page = {
    id: nanoid(),
    title: 'Home',
    slug: 'index',
    rootNodeId: rootNode.id,
    nodes: { [rootNode.id]: rootNode },
  }
  return {
    id: nanoid(),
    name,
    pages: [homePage],
    files: [],             // Contribution #595 — files data layer
    visualComponents: [],  // Contribution #619 — visual components data layer
    packageJson: clonePackageJson(DEFAULT_SITE_PACKAGE_JSON),
    runtime: cloneSiteRuntimeConfig(DEFAULT_SITE_RUNTIME),
    breakpoints: DEFAULT_BREAKPOINTS,
    settings: structuredClone(DEFAULT_SITE_SETTINGS),
    classes: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

const DEFAULT_COLOR_UTILITIES: Record<FrameworkColorUtilityType, boolean> = {
  text: true,
  background: true,
  border: true,
  fill: false,
}

const DEFAULT_COLOR_VARIANTS: ColorVariantOptions = { enabled: true, count: 4 }

function ensureFrameworkColors(site: SiteDocument): NonNullable<SiteSettings['framework']>['colors'] {
  if (!site.settings.framework) {
    site.settings.framework = { colors: { categories: [], tokens: [] } }
  }
  if (!site.settings.framework.colors) {
    site.settings.framework.colors = { categories: [], tokens: [] }
  }
  site.settings.framework.colors.categories ??= []
  site.settings.framework.colors.tokens ??= []
  return site.settings.framework.colors
}

function nextOrder(items: Array<{ order: number }>): number {
  return items.reduce((max, item) => Math.max(max, item.order), -1) + 1
}

function uniqueColorSlug(
  tokens: FrameworkColorToken[],
  desiredSlug: string,
  excludeTokenId?: string,
): string {
  const base = normalizeFrameworkColorSlug(desiredSlug)
  const existing = new Set(
    tokens
      .filter((token) => token.id !== excludeTokenId)
      .map((token) => normalizeFrameworkColorSlug(token.slug)),
  )
  if (!existing.has(base)) return base

  let suffix = 2
  while (existing.has(`${base}-${suffix}`)) {
    suffix += 1
  }
  return `${base}-${suffix}`
}

function createFrameworkColorTokenFromInput(
  input: CreateFrameworkColorTokenInput,
  colors: NonNullable<SiteSettings['framework']>['colors'],
): FrameworkColorToken {
  const now = Date.now()
  const lightValue = input.lightValue.trim()
  return {
    id: nanoid(),
    categoryId: input.categoryId ?? null,
    slug: uniqueColorSlug(colors.tokens, input.slug),
    lightValue,
    darkValue: input.darkValue?.trim() || generateDefaultDarkColor(lightValue),
    darkModeEnabled: input.darkModeEnabled ?? false,
    generateUtilities: {
      ...DEFAULT_COLOR_UTILITIES,
      ...(input.generateUtilities ?? {}),
    },
    generateTransparent: input.generateTransparent ?? true,
    generateShades: {
      ...DEFAULT_COLOR_VARIANTS,
      ...(input.generateShades ?? {}),
    },
    generateTints: {
      ...DEFAULT_COLOR_VARIANTS,
      ...(input.generateTints ?? {}),
    },
    order: nextOrder(colors.tokens),
    createdAt: now,
    updatedAt: now,
  }
}

function applyFrameworkColorTokenPatch(
  token: FrameworkColorToken,
  patch: UpdateFrameworkColorTokenPatch,
  colors: NonNullable<SiteSettings['framework']>['colors'],
): void {
  if (patch.categoryId !== undefined) token.categoryId = patch.categoryId
  if (patch.slug !== undefined) token.slug = uniqueColorSlug(colors.tokens, patch.slug, token.id)
  if (patch.lightValue !== undefined) token.lightValue = patch.lightValue.trim()
  if (patch.darkValue !== undefined) token.darkValue = patch.darkValue.trim()
  if (patch.darkModeEnabled !== undefined) {
    token.darkModeEnabled = patch.darkModeEnabled
    if (patch.darkModeEnabled && !patch.darkValue && !token.darkValue) {
      token.darkValue = generateDefaultDarkColor(token.lightValue)
    }
  }
  if (patch.generateUtilities) {
    token.generateUtilities = {
      ...token.generateUtilities,
      ...patch.generateUtilities,
    }
  }
  if (patch.generateTransparent !== undefined) token.generateTransparent = patch.generateTransparent
  if (patch.generateShades) {
    token.generateShades = { ...token.generateShades, ...patch.generateShades }
  }
  if (patch.generateTints) {
    token.generateTints = { ...token.generateTints, ...patch.generateTints }
  }
  if (patch.order !== undefined) token.order = patch.order
  token.updatedAt = Date.now()
}

function cloneFrameworkColorToken(
  token: FrameworkColorToken,
  colors: NonNullable<SiteSettings['framework']>['colors'],
): FrameworkColorToken {
  const now = Date.now()
  return {
    ...structuredClone(token),
    id: nanoid(),
    slug: uniqueColorSlug(colors.tokens, `${token.slug}-copy`),
    order: nextOrder(colors.tokens),
    createdAt: now,
    updatedAt: now,
  }
}

function reorderFrameworkColorTokenInGroup(
  colors: NonNullable<SiteSettings['framework']>['colors'],
  tokenId: string,
  direction: 'up' | 'down',
): void {
  const token = colors.tokens.find((candidate) => candidate.id === tokenId)
  if (!token) return

  const group = colors.tokens
    .filter((candidate) => candidate.categoryId === token.categoryId)
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
  const currentIndex = group.findIndex((candidate) => candidate.id === tokenId)
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= group.length) return

  const orderValues = group.map((candidate) => candidate.order).sort((a, b) => a - b)
  const reordered = [...group]
  const [moved] = reordered.splice(currentIndex, 1)
  reordered.splice(targetIndex, 0, moved)

  for (let index = 0; index < reordered.length; index += 1) {
    reordered[index].order = orderValues[index] ?? index
    reordered[index].updatedAt = Date.now()
  }
}

function isGeneratedColorClassId(id: string, site: SiteDocument): boolean {
  return site.classes[id]?.generated?.origin === 'framework' && site.classes[id]?.generated?.family === 'color'
}

function pruneClassIdFromNodes(site: SiteDocument, classId: string): void {
  for (const page of site.pages) {
    for (const node of Object.values(page.nodes)) {
      if (node.classIds?.includes(classId)) {
        node.classIds = node.classIds.filter((id) => id !== classId)
      }
    }
  }
}

function reconcileFrameworkColorClasses(site: SiteDocument): void {
  const colors = ensureFrameworkColors(site)
  const nextClasses = generateFrameworkColorUtilityClasses(colors)
  const nextClassIds = new Set(Object.keys(nextClasses))

  for (const classId of Object.keys(site.classes)) {
    if (!isGeneratedColorClassId(classId, site)) continue
    if (nextClassIds.has(classId)) continue
    delete site.classes[classId]
    pruneClassIdFromNodes(site, classId)
  }

  for (const [classId, nextClass] of Object.entries(nextClasses)) {
    const existing = site.classes[classId]
    site.classes[classId] = {
      ...nextClass,
      createdAt: existing?.createdAt ?? nextClass.createdAt,
    }
  }
}

function migrateLegacyTextModules(site: SiteDocument): SiteDocument {
  const migrated = structuredClone(site)

  for (const page of migrated.pages) {
    for (const node of Object.values(page.nodes)) {
      migrateLegacyTextNode(node)
    }
  }

  for (const component of migrated.visualComponents ?? []) {
    migrateLegacyTextNode(component.rootNode)
  }

  return migrated
}

function migrateLegacyTextNode(node: { moduleId: string; props: Record<string, unknown>; childNodes?: unknown[] }) {
  if (node.moduleId === 'base.heading') {
    node.moduleId = 'base.text'
    node.props = {
      text: typeof node.props.text === 'string' ? node.props.text : 'Your Heading Here',
      tag: legacyHeadingTag(node.props.level),
    }
  } else if (node.moduleId === 'base.paragraph') {
    node.moduleId = 'base.text'
    node.props = {
      text: typeof node.props.text === 'string' ? node.props.text : 'Add your text here.',
      tag: 'p',
    }
  }

  for (const child of node.childNodes ?? []) {
    migrateLegacyTextNode(child as { moduleId: string; props: Record<string, unknown>; childNodes?: unknown[] })
  }
}

function legacyHeadingTag(level: unknown): string {
  if (typeof level === 'number' && level >= 1 && level <= 6) return `h${level}`
  const tag = String(level || 'h2').toLowerCase()
  return /^h[1-6]$/.test(tag) ? tag : 'h2'
}

function clearDynamicBindingsFromNode(node: PageNode): void {
  delete node.dynamicBindings
  for (const child of node.childNodes ?? []) {
    clearDynamicBindingsFromNode(child)
  }
}

export const createSiteSlice: StateCreator<EditorStore, [], [], SiteSlice> = (set, get) => {
  // ---------------------------------------------------------------------------
  // Internal helpers — note: these use `get()` before calling set() so they
  // can snapshot the current site for history.
  // ---------------------------------------------------------------------------

  /** Snapshot current site into undo history, then clear redo stack. */
  function pushHistory(): void {
    const { site } = get()
    if (!site) return
    set(
      produce((state: EditorStore) => {
        const snapshot = structuredClone(site)
        state._historyPast.push(snapshot)
        if (state._historyPast.length > MAX_HISTORY) {
          state._historyPast.shift() // evict oldest
        }
        state._historyFuture = []
        state.canUndo = true
        state.canRedo = false
      })
    )
  }

  /** Mutate the active page — auto-snapshots history first. */
  function mutatePage(fn: (page: Page) => void): void {
    pushHistory()
    set(
      produce((state: EditorStore) => {
        if (!state.site) return
        const page = state.site.pages.find((p) => p.id === state.activePageId)
        if (!page) return
        fn(page)
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })
    )
  }

  /** Mutate the site — auto-snapshots history first. */
  function mutateSite(fn: (site: SiteDocument) => void): void {
    pushHistory()
    set(
      produce((state: EditorStore) => {
        if (!state.site) return
        fn(state.site)
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })
    )
  }

  return {
    site: null,

    // ─── Undo / Redo ─────────────────────────────────────────────────────────
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,

    pushHistory,

    undo: () => {
      const { _historyPast, site } = get()
      if (_historyPast.length === 0 || !site) return
      const previous = _historyPast[_historyPast.length - 1]
      set(
        produce((state: EditorStore) => {
          state._historyPast.pop()
          state._historyFuture.push(structuredClone(site))
          const packageJson = clonePackageJson(previous.packageJson)
          const siteRuntime = cloneSiteRuntimeConfig(previous.runtime)
          state.site = { ...previous, packageJson, runtime: siteRuntime }
          state.packageJson = packageJson
          state.siteRuntime = siteRuntime
          state.canUndo = state._historyPast.length > 0
          state.canRedo = true
          state.hasUnsavedChanges = true
          // Keep activePageId valid
          if (!state.site.pages.find((p) => p.id === state.activePageId)) {
            state.activePageId = state.site.pages[0]?.id ?? null
          }
        })
      )
    },

    redo: () => {
      const { _historyFuture, site } = get()
      if (_historyFuture.length === 0 || !site) return
      const next = _historyFuture[_historyFuture.length - 1]
      set(
        produce((state: EditorStore) => {
          state._historyFuture.pop()
          state._historyPast.push(structuredClone(site))
          const packageJson = clonePackageJson(next.packageJson)
          const siteRuntime = cloneSiteRuntimeConfig(next.runtime)
          state.site = { ...next, packageJson, runtime: siteRuntime }
          state.packageJson = packageJson
          state.siteRuntime = siteRuntime
          state.canUndo = true
          state.canRedo = state._historyFuture.length > 0
          state.hasUnsavedChanges = true
          // Keep activePageId valid
          if (!state.site.pages.find((p) => p.id === state.activePageId)) {
            state.activePageId = state.site.pages[0]?.id ?? null
          }
        })
      )
    },

    // ─── SiteDocument lifecycle ────────────────────────────────────────────────────
    createSite: (name) => {
      const site = createDefaultSiteDocument(name)
      const siteRuntime = cloneSiteRuntimeConfig(site.runtime)
      set({
        site: { ...site, runtime: siteRuntime },
        packageJson: clonePackageJson(site.packageJson),
        siteRuntime,
        activePageId: site.pages[0].id,
        _historyPast: [],
        _historyFuture: [],
        canUndo: false,
        canRedo: false,
        hasUnsavedChanges: false,
      })
      return site
    },

    loadSite: (site) => {
      // Clear the render cache BEFORE store hydration so stale HTML from a previous
      // site cannot bleed into the canvas after switching projects.
      // (Guideline #307 / Architect message #1216 — critical integration note)
      renderCache.clear()
      const migratedSite = migrateLegacyTextModules(site)
      if (migratedSite.settings.framework?.colors) {
        reconcileFrameworkColorClasses(migratedSite)
      }
      const packageJson = clonePackageJson(migratedSite.packageJson)
      const siteRuntime = cloneSiteRuntimeConfig(migratedSite.runtime)
      set({
        site: { ...migratedSite, packageJson, runtime: siteRuntime },
        packageJson,
        siteRuntime,
        activePageId: migratedSite.pages[0]?.id ?? null,
        _historyPast: [],
        _historyFuture: [],
        canUndo: false,
        canRedo: false,
        hasUnsavedChanges: false,
      })
    },

    clearSite: () => {
      set({
        site: null,
        packageJson: clonePackageJson(DEFAULT_SITE_PACKAGE_JSON),
        siteRuntime: cloneSiteRuntimeConfig(DEFAULT_SITE_RUNTIME),
        activePageId: null,
        selectedNodeId: null,
        _historyPast: [],
        _historyFuture: [],
        canUndo: false,
        canRedo: false,
      })
    },

    updateSiteName: (name) => {
      mutateSite((p) => { p.name = name })
    },

    // ─── Page mutations ───────────────────────────────────────────────────────
    addPage: (title, slug) => {
      let newPage!: Page
      mutateSite((p) => {
        newPage = addPage(p, title, slug ?? title)
      })
      set({ activePageId: newPage.id })
      return newPage
    },

    deletePage: (pageId) => {
      mutateSite((p) => deletePage(p, pageId))
      const { site, activePageId } = get()
      if (activePageId === pageId && site) {
        set({ activePageId: site.pages[0]?.id ?? null })
      }
    },

    renamePage: (pageId, title, slug) => {
      mutateSite((p) => renamePage(p, pageId, title, slug))
    },

    reorderPages: (fromIndex, toIndex) => {
      mutateSite((p) => reorderPages(p, fromIndex, toIndex))
    },

    convertPageToTemplate: (pageId, config) => {
      mutateSite((site) => {
        const page = site.pages.find((candidate) => candidate.id === pageId)
        if (!page) return
        page.template = config
      })
    },

    convertTemplateToPage: (pageId) => {
      mutateSite((site) => {
        const page = site.pages.find((candidate) => candidate.id === pageId)
        if (!page) return
        delete page.template
        for (const node of Object.values(page.nodes)) {
          clearDynamicBindingsFromNode(node)
        }
      })
    },

    // ─── Node mutations ───────────────────────────────────────────────────────
    insertNode: (moduleId, defaults, parentId, index) => {
      const mod = registry.get(moduleId)
      const resolvedDefaults = { ...(mod?.defaults ?? {}), ...defaults }
      const newNode = createNode(moduleId, resolvedDefaults)
      mutatePage((page) => insertNode(page, newNode, parentId, index))
      return newNode.id
    },

    deleteNode: (nodeId) => {
      mutatePage((page) => deleteNode(page, nodeId))
      if (get().selectedNodeId === nodeId) set({ selectedNodeId: null })
    },

    updateNodeProps: (nodeId, patch) => {
      mutatePage((page) => updateNodeProps(page, nodeId, patch))
    },

    setBreakpointOverride: (nodeId, breakpointId, patch) => {
      mutatePage((page) => setBreakpointOverride(page, nodeId, breakpointId, patch))
    },

    clearBreakpointOverride: (nodeId, breakpointId) => {
      mutatePage((page) => clearBreakpointOverride(page, nodeId, breakpointId))
    },

    renameNode: (nodeId, label) => {
      mutatePage((page) => renameNode(page, nodeId, label))
    },

    toggleNodeLocked: (nodeId) => {
      mutatePage((page) => toggleNodeLocked(page, nodeId))
    },

    toggleNodeHidden: (nodeId) => {
      mutatePage((page) => toggleNodeHidden(page, nodeId))
    },

    moveNode: (nodeId, newParentId, newIndex) => {
      mutatePage((page) => moveNode(page, nodeId, newParentId, newIndex))
    },

    duplicateNode: (nodeId) => {
      let newId = ''
      mutatePage((page) => { newId = duplicateNode(page, nodeId) })
      return newId
    },

    wrapNode: (nodeId, containerModuleId, defaults = {}) => {
      // Auto-resolve the module's schema defaults so the wrapper node renders correctly.
      // Without this, wrapNode(id, 'base.container') produces props:{} → props.tag=undefined
      // → React.createElement(undefined) → "Element type is invalid" crash (Task #414).
      const mod = registry.get(containerModuleId)
      const resolvedDefaults = { ...(mod?.defaults ?? {}), ...defaults }
      let wrapperId = ''
      mutatePage((page) => { wrapperId = wrapNode(page, nodeId, containerModuleId, resolvedDefaults) })
      return wrapperId
    },

    setNodeDynamicBinding: (nodeId, propKey, binding) => {
      mutatePage((page) => {
        const node = page.nodes[nodeId]
        if (!node) return
        node.dynamicBindings = {
          ...(node.dynamicBindings ?? {}),
          [propKey]: binding,
        }
      })
    },

    clearNodeDynamicBinding: (nodeId, propKey) => {
      mutatePage((page) => {
        const node = page.nodes[nodeId]
        if (!node?.dynamicBindings) return
        delete node.dynamicBindings[propKey]
        if (Object.keys(node.dynamicBindings).length === 0) {
          delete node.dynamicBindings
        }
      })
    },

    // ─── Breakpoint mutations ─────────────────────────────────────────────────
    addBreakpoint: (bp) => {
      const newBp: Breakpoint = { ...bp, id: nanoid(8) }
      mutateSite((p) => { p.breakpoints.push(newBp) })
      return newBp
    },

    updateBreakpoint: (id, patch) => {
      mutateSite((p) => {
        const idx = p.breakpoints.findIndex((b) => b.id === id)
        if (idx !== -1) Object.assign(p.breakpoints[idx], patch)
      })
    },

    removeBreakpoint: (id) => {
      mutateSite((p) => {
        p.breakpoints = p.breakpoints.filter((b) => b.id !== id)
      })
      // If the active breakpoint was removed, fall back to desktop
      if (get().activeBreakpointId === id) {
        set({ activeBreakpointId: 'desktop' })
      }
    },

    reorderBreakpoints: (fromIndex, toIndex) => {
      mutateSite((p) => {
        const [item] = p.breakpoints.splice(fromIndex, 1)
        p.breakpoints.splice(toIndex, 0, item)
      })
    },

    // ─── SiteDocument settings mutations ───────────────────────────────────────────
    updateSiteSettings: (patch) => {
      mutateSite((p) => {
        Object.assign(p.settings, patch)
      })
    },

    createFrameworkColorCategory: (name) => {
      const { site } = get()
      if (!site) throw new Error('[siteSlice] Site document is not initialized')
      const colors = ensureFrameworkColors(site)
      const category: FrameworkColorCategory = {
        id: nanoid(),
        name: name.trim() || 'Untitled',
        order: nextOrder(colors.categories),
      }

      mutateSite((draftSite) => {
        ensureFrameworkColors(draftSite).categories.push(category)
      })

      return category
    },

    renameFrameworkColorCategory: (categoryId, name) => {
      const trimmed = name.trim()
      if (!trimmed) return
      mutateSite((site) => {
        const category = ensureFrameworkColors(site).categories.find((candidate) => candidate.id === categoryId)
        if (!category || category.name === trimmed) return
        category.name = trimmed
      })
    },

    deleteFrameworkColorCategory: (categoryId) => {
      mutateSite((site) => {
        const colors = ensureFrameworkColors(site)
        colors.categories = colors.categories.filter((category) => category.id !== categoryId)
        for (const token of colors.tokens) {
          if (token.categoryId === categoryId) token.categoryId = null
        }
      })
    },

    createFrameworkColorToken: (input) => {
      const { site } = get()
      if (!site) throw new Error('[siteSlice] Site document is not initialized')
      const token = createFrameworkColorTokenFromInput(input, ensureFrameworkColors(site))

      mutateSite((draftSite) => {
        const colors = ensureFrameworkColors(draftSite)
        colors.tokens.push(token)
        reconcileFrameworkColorClasses(draftSite)
      })

      return token
    },

    updateFrameworkColorToken: (tokenId, patch) => {
      mutateSite((site) => {
        const colors = ensureFrameworkColors(site)
        const token = colors.tokens.find((candidate) => candidate.id === tokenId)
        if (!token) return
        applyFrameworkColorTokenPatch(token, patch, colors)
        reconcileFrameworkColorClasses(site)
      })
    },

    duplicateFrameworkColorToken: (tokenId) => {
      const { site } = get()
      if (!site) return null
      const colors = ensureFrameworkColors(site)
      const token = colors.tokens.find((candidate) => candidate.id === tokenId)
      if (!token) return null
      const copy = cloneFrameworkColorToken(token, colors)

      mutateSite((draftSite) => {
        const draftColors = ensureFrameworkColors(draftSite)
        draftColors.tokens.push(copy)
        reconcileFrameworkColorClasses(draftSite)
      })

      return copy
    },

    reorderFrameworkColorToken: (tokenId, direction) => {
      mutateSite((site) => {
        const colors = ensureFrameworkColors(site)
        reorderFrameworkColorTokenInGroup(colors, tokenId, direction)
        reconcileFrameworkColorClasses(site)
      })
    },

    deleteFrameworkColorToken: (tokenId) => {
      mutateSite((site) => {
        const colors = ensureFrameworkColors(site)
        colors.tokens = colors.tokens.filter((token) => token.id !== tokenId)
        reconcileFrameworkColorClasses(site)
      })
    },
  }
}
