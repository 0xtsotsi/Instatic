import { useCallback } from 'react'
import { selectActiveCanvasPage, useEditorStore } from '@site/store/store'
import { resolveInsertLocation } from '@site/store/insertLocation'
import { getMissingModuleDependencies } from '@core/module-engine/dependencies'
import type { AnyModuleDefinition } from '@core/module-engine/types'

/**
 * Insert a module into the active canvas document (page or Visual Component).
 *
 * Parent + insertion-index resolution is delegated to `resolveInsertLocation`,
 * which is shared by every UI flow that inserts relative to a clicked target
 * (toolbar picker, canvas right-click, DOM-panel right-click, clipboard paste).
 * Targets that accept children receive the new node as a last child; leaf
 * targets (Text, Button, Image, etc.) get a sibling-after insertion under
 * their parent so right-click "Insert module here" is never a silent no-op.
 *
 * Without an explicit `parentId`, the selected node is used as the target;
 * with no selection, the new node lands at the canvas root.
 *
 * Uses `selectActiveCanvasPage` so resolution works in BOTH page mode and
 * VC-canvas mode — the slice's `insertNode` action then routes to the correct
 * tree (page vs. VC) based on `activeDocument.kind`.
 */
export function useInsertModule() {
  const canvasPage = useEditorStore(selectActiveCanvasPage)
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId)
  const insertNode = useEditorStore((s) => s.insertNode)
  const selectNode = useEditorStore((s) => s.selectNode)
  const packageJson = useEditorStore((s) => s.packageJson)
  const setDependency = useEditorStore((s) => s.setDependency)

  return useCallback(
    (mod: AnyModuleDefinition, explicitParentId?: string) => {
      if (!canvasPage) return null

      // Resolve target → parent + index. Explicit parent wins over selection,
      // selection wins over "drop at root".
      const targetId =
        (explicitParentId && canvasPage.nodes[explicitParentId] ? explicitParentId : null) ??
        selectedNodeId ??
        canvasPage.rootNodeId

      const location = resolveInsertLocation(canvasPage, targetId)
      if (!location) return null

      for (const dependency of getMissingModuleDependencies(mod, packageJson)) {
        setDependency(dependency.name, dependency.version, dependency.dev)
      }

      const nodeId = insertNode(mod.id, mod.defaults, location.parentId, location.index)
      selectNode(nodeId)
      return nodeId
    },
    [canvasPage, selectedNodeId, packageJson, setDependency, insertNode, selectNode],
  )
}
