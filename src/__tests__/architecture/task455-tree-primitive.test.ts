/**
 * Architecture Gate Tests — Generic Tree UI Primitive
 *
 * The old FilesPanel has been retired. The tree primitive remains the shared
 * implementation for structural trees such as the DOM/Layers panel, while the
 * Site Explorer presents user-facing site concepts instead of generated
 * source-file paths.
 */

import { describe, it, expect } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../../')
const TREE_PRIMITIVE_TSX = join(ROOT, 'src/admin/pages/site/ui/Tree/Tree.tsx')
const TREE_PRIMITIVE_INDEX = join(ROOT, 'src/admin/pages/site/ui/Tree/index.ts')
const TREE_ROW_TSX = join(ROOT, 'src/admin/pages/site/ui/Tree/TreeRow.tsx')
const TREE_ROW_CSS = join(ROOT, 'src/admin/pages/site/ui/Tree/TreeRow.module.css')
const DOM_PANEL_TSX = join(ROOT, 'src/admin/pages/site/panels/DomPanel/DomPanel.tsx')
const DOM_TREE_NODE_TSX = join(ROOT, 'src/admin/pages/site/panels/DomPanel/TreeNode.tsx')
const DOM_LAYER_TREE_NODE_CONTENT_TSX = join(ROOT, 'src/admin/pages/site/panels/DomPanel/LayerTreeNodeContent.tsx')
const PROJECT_EXPLORER_TSX = join(ROOT, 'src/admin/pages/site/panels/SiteExplorerPanel/SiteExplorerPanel.tsx')
const SITE_EXPLORER_TREE_SECTION_TSX = join(ROOT, 'src/admin/pages/site/panels/SiteExplorerPanel/SiteExplorerTreeSection.tsx')
const PROJECT_CREATE_DIALOG_TSX = join(ROOT, 'src/admin/shared/dialogs/SiteCreateDialog/SiteCreateDialog.tsx')
const UI_SLICE_TS = join(ROOT, 'src/admin/pages/site/store/slices/uiSlice.ts')
const LAYOUT_STORAGE_TS = join(ROOT, 'src/admin/pages/site/layout/panelLayoutStorage.ts')
const LAYOUT_PERSISTENCE_TS = join(ROOT, 'src/admin/pages/site/hooks/useEditorLayoutPersistence.ts')

function src(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('Tree primitive', () => {
  it('keeps the generic tree implementation at the canonical path', () => {
    expect(existsSync(TREE_PRIMITIVE_TSX)).toBe(true)
    expect(existsSync(TREE_PRIMITIVE_INDEX)).toBe(true)
    expect(existsSync(TREE_ROW_TSX)).toBe(true)
    expect(existsSync(TREE_ROW_CSS)).toBe(true)
  })

  it('exports the public tree container and row building blocks', () => {
    const source = src(TREE_PRIMITIVE_INDEX)
    expect(source.includes('TreeContainer')).toBe(true)
    expect(source.includes('TreeRow')).toBe(true)
    expect(source.includes('TreeChevron')).toBe(true)
    expect(source.includes('TreeIconSlot')).toBe(true)
    expect(source.includes('TreeLabel')).toBe(true)
  })

  it('contains no panel-specific imports or file-kind branches', () => {
    const source = src(TREE_PRIMITIVE_TSX)
    const importLines = source
      .split('\n')
      .filter((line) => line.trimStart().startsWith('import'))
      .join('\n')
      .toLowerCase()

    expect(importLines.includes('filespanel')).toBe(false)
    expect(importLines.includes('projectexplorerpanel')).toBe(false)
    expect(importLines.includes('dompanel')).toBe(false)
    expect(source.includes("'virtual-page'")).toBe(false)
    expect(source.includes("'visual-component'")).toBe(false)
    expect(source.includes("kind === 'file'")).toBe(false)
    expect(source.includes('useEditorStore')).toBe(false)
  })
})

describe('DomPanel tree usage', () => {
  it('uses TreeContainer instead of owning a raw tree container', () => {
    const source = src(DOM_PANEL_TSX)
    expect(source.includes("from '@site/ui/Tree'") || source.includes('from "@site/ui/Tree"')).toBe(true)
    expect(source.includes('<TreeContainer')).toBe(true)
    expect(/<div[^>]*role="tree"/.test(source)).toBe(false)
  })

  it('uses the shared TreeRow visuals for DOM nodes', () => {
    const treeNodeSource = src(DOM_TREE_NODE_TSX)
    const rowContentSource = src(DOM_LAYER_TREE_NODE_CONTENT_TSX)
    const source = `${treeNodeSource}\n${rowContentSource}`

    expect(treeNodeSource.includes('LayerTreeNodeContent')).toBe(true)
    expect(source.includes('TreeRow')).toBe(true)
    expect(source.includes('TreeChevron')).toBe(true)
    expect(source.includes('TreeIconSlot')).toBe(true)
    expect(source.includes('TreeLabel')).toBe(true)
    expect(source.includes('styles.rowSelected')).toBe(false)
    expect(source.includes('styles.rowHovered')).toBe(false)
  })
})

describe('Site Explorer architecture', () => {
  it('replaces FilesPanel with a concept-oriented Site Explorer', () => {
    expect(existsSync(join(ROOT, 'src/admin/pages/site/components/FilesPanel/index.tsx'))).toBe(false)
    expect(existsSync(PROJECT_EXPLORER_TSX)).toBe(true)
  })

  it('uses one simple site creation dialog and removes the old file modal', () => {
    expect(existsSync(join(ROOT, 'src/admin/pages/site/components/NewFileModal/NewFileModal.tsx'))).toBe(false)
    expect(existsSync(join(ROOT, 'src/admin/pages/site/components/NewFileModal/index.ts'))).toBe(false)
    expect(existsSync(join(ROOT, 'src/core/files/inference.ts'))).toBe(false)
    expect(existsSync(PROJECT_CREATE_DIALOG_TSX)).toBe(true)
  })

  it('does not keep FilesPanel compatibility state or layout ids', () => {
    const uiSlice = src(UI_SLICE_TS)
    const layoutStorage = src(LAYOUT_STORAGE_TS)
    const layoutPersistence = src(LAYOUT_PERSISTENCE_TS)

    expect(uiSlice.includes('filesPanelOpen')).toBe(false)
    expect(uiSlice.includes('setFilesPanelOpen')).toBe(false)
    expect(layoutStorage.includes("'files'")).toBe(false)
    expect(layoutStorage.includes('readLegacyPanelPosition')).toBe(false)
    expect(layoutStorage.includes('instatic-${panelId}-panel-pos')).toBe(false)
    expect(layoutPersistence.includes('panels?.files')).toBe(false)
  })

  it('renders site concepts through the shared Tree primitive', () => {
    const source = src(SITE_EXPLORER_TREE_SECTION_TSX)
    expect(source.includes("from '@site/ui/Tree'") || source.includes('from "@site/ui/Tree"')).toBe(true)
    expect(source.includes('<TreeContainer')).toBe(true)
    expect(source.includes('<TreeRow')).toBe(true)
    expect(source.includes("from '@ui/Tree'") || source.includes('from "@ui/Tree"')).toBe(false)
  })

  it('keeps Site Explorer focused on site concepts instead of generated source paths', () => {
    const source = src(PROJECT_EXPLORER_TSX)
    expect(source.includes('src/pages/')).toBe(false)
    expect(source.includes('src/components/')).toBe(false)
    expect(source.includes('window.prompt')).toBe(false)
  })
})
