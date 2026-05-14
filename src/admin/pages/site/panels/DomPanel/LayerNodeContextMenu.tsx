/**
 * LayerNodeContextMenu — right-click menu for nodes in the DOM panel and
 * canvas. Hosts rename / duplicate / cut / copy / paste / wrap / delete
 * actions and an "Insert module here" `ContextMenuSubmenu` that shows the
 * shared `ModulePicker` (search + categorized module list, including site
 * Visual Components) as a true second-level dropdown — same primitive,
 * same styling, same hover/focus/colors as every other submenu.
 *
 * The submenu is *always* offered: every node is a legal target, because the
 * shared `resolveInsertLocation` helper (in `@site/store/insertLocation`)
 * places the new node inside container targets and as a sibling-after under
 * the parent of leaf targets (Text, Button, Image, etc.). Without that
 * fallback the right-click flow used to silently no-op on leaf nodes — see
 * `LayerNodeContextMenu — sibling fallback` tests for the regression gate.
 *
 * The Paste item is rendered conditionally: it appears only when the
 * clipboard slice has a captured subtree. The clipboard is editor-wide and
 * persisted to localStorage, so it can survive page reloads.
 *
 * Multi-select awareness:
 * - When multiple nodes are selected AND the right-clicked node is part of
 *   that selection, the menu acts on every selected node:
 *     - Rename → hidden (only meaningful for one node).
 *     - Duplicate / Copy / Cut / Wrap / Delete → multi-aware actions.
 *     - "Insert module here" → hidden (anchored to one parent).
 * - Wrap is now a SUBMENU with two choices: Container and Loop. The
 *   underlying action is `wrapNode` (single) or `wrapNodes` (multi, with
 *   closest-common-ancestor semantics).
 *
 * Architecture gate (G4, G5): Visual Component insertion MUST go through the
 * shared `insertComponentRef` action in `siteSlice` so cycle detection and
 * VC/page-mode dispatch are applied uniformly.
 * See `src/__tests__/architecture/component-system-placement.test.ts`.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ContextMenu as UIContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubmenu,
} from '@ui/components/ContextMenu'
import { useEditorStore, selectActiveCanvasPage } from '@site/store/store'
import { useShallow } from 'zustand/react/shallow'
import { useInsertModule } from '@site/hooks/useInsertModule'
import { resolveInsertLocation } from '@site/store/insertLocation'
import { ModulePicker } from '@site/module-picker'
import { useConfirmDelete } from '@admin/shared/dialogs/ConfirmDeleteDialog'
import type { AnyModuleDefinition } from '@core/module-engine/types'
import { EditIcon } from 'pixel-art-icons/icons/edit'
import { CopyIcon } from 'pixel-art-icons/icons/copy'
import { Copy2Icon } from 'pixel-art-icons/icons/copy-2'
import { EraserIcon } from 'pixel-art-icons/icons/eraser'
import { FilesStack2Icon } from 'pixel-art-icons/icons/files-stack-2'
import { CheckboxIcon } from 'pixel-art-icons/icons/checkbox'
import { DeleteIcon } from 'pixel-art-icons/icons/delete'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { BoxStackIcon } from 'pixel-art-icons/icons/box-stack'
import styles from './LayerNodeContextMenu.module.css'

interface LayerNodeContextMenuProps {
  x: number
  y: number
  onClose: () => void
  /**
   * Single-node delete handler (used when the selection has one node).
   * Multi-delete is dispatched internally via `deleteNodes` to avoid each
   * caller wiring a separate confirm dialog for the multi-case — see comment
   * inside the component for the rationale.
   */
  onDelete: () => void
  onDuplicate: () => void
  onRename: () => void
  /** Single-node wrap handler. Multi-wrap is dispatched internally. */
  onWrapInContainer: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  /** The node that was right-clicked. When omitted, falls back to selectedNodeId. */
  nodeId?: string
}

export function LayerNodeContextMenu({
  x,
  y,
  onClose,
  onDelete,
  onDuplicate,
  onRename,
  onWrapInContainer,
  onCopy,
  onCut,
  onPaste,
  nodeId: nodeIdProp,
}: LayerNodeContextMenuProps) {
  const firstItemRef = useRef<HTMLButtonElement>(null)

  // Per-node selector — fallback for nodeId when no explicit prop is given.
  // CanvasRoot / TreeNode select the right-clicked node before opening the menu,
  // so selectedNodeId is reliable there even without an explicit nodeId prop.
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId)
  // Multi-select awareness: when 2+ nodes are selected, the menu acts on the
  // whole set. `useShallow` keeps subscriptions stable for content equality.
  const selectedNodeIds = useEditorStore(useShallow((s) => s.selectedNodeIds))
  const insertComponentRef = useEditorStore((s) => s.insertComponentRef)
  const insertModule = useInsertModule()
  const wrapNodesAction = useEditorStore((s) => s.wrapNodes)
  const duplicateNodesAction = useEditorStore((s) => s.duplicateNodes)
  const copyNodesAction = useEditorStore((s) => s.copyNodes)
  const cutNodesAction = useEditorStore((s) => s.cutNodes)
  const deleteNodesAction = useEditorStore((s) => s.deleteNodes)
  const confirmDelete = useConfirmDelete()

  // Reactive boolean for the conditional Paste item — re-renders whenever
  // the clipboard entry transitions between null and non-null.
  const canPaste = useEditorStore((s) => s.clipboardEntry !== null)

  const nodeId = nodeIdProp ?? selectedNodeId

  // Resolve whether we're acting on a multi-selection. The menu is "multi"
  // only when the right-clicked nodeId is part of an existing 2+ selection.
  // Right-clicking outside a multi-selection demotes back to single-select
  // (the calling site already replaced selection in that case — see
  // CanvasRoot.onNodeContextMenu and TreeNode's onContextMenu).
  const isMulti = useMemo(
    () => selectedNodeIds.length > 1 && nodeId !== null && selectedNodeIds.includes(nodeId),
    [selectedNodeIds, nodeId],
  )
  const targetIds = useMemo(
    () => (isMulti ? selectedNodeIds : nodeId ? [nodeId] : []),
    [isMulti, selectedNodeIds, nodeId],
  )

  // slot-instance structural lock-down — Task 5
  //
  // A `base.slot-instance` node is structural ONLY when its parent is a
  // `base.visual-component-ref` — that is the only context in which it is
  // managed by `syncSlotInstances` and must not be deleted/moved/renamed by
  // hand. An orphan slot-instance anywhere else (e.g. left over from a
  // parallel session before the picker filter was added) is just a regular
  // node the user must be able to delete to recover.
  const lockedSlotInstance = useEditorStore(
    useCallback(
      (s) => {
        if (isMulti) return false  // Multi-select already filters slot-instance per slice rules.
        if (!nodeId) return false
        const tree = selectActiveCanvasPage(s)
        if (!tree) return false
        const node = tree.nodes[nodeId]
        if (!node || node.moduleId !== 'base.slot-instance') return false
        // Find the parent. Locked only when parent is a VC ref.
        const parent = Object.values(tree.nodes).find((n) =>
          n.children.includes(nodeId),
        )
        return parent?.moduleId === 'base.visual-component-ref'
      },
      [nodeId, isMulti],
    ),
  )

  // "Insert module here" is hidden ONLY for multi-select (the new node has no
  // single anchor in that case) — for single-select every node is a legal
  // target because resolveInsertLocation handles container vs. leaf targets
  // uniformly (leaves land as sibling-after under their parent).
  const showInsertHere = !isMulti && nodeId !== null

  useEffect(() => {
    firstItemRef.current?.focus()
  }, [])

  const handleSelectModule = useCallback(
    (mod: AnyModuleDefinition) => {
      if (!nodeId) return
      insertModule(mod, nodeId)
    },
    [insertModule, nodeId],
  )

  const handleSelectVC = useCallback(
    (vcId: string) => {
      if (!nodeId) return
      // Mirror useInsertModule's resolution so VC drops obey the same
      // "sibling-after on a leaf target" rule that the module submenu uses.
      const page = selectActiveCanvasPage(useEditorStore.getState())
      if (!page) return
      const location = resolveInsertLocation(page, nodeId)
      if (!location) return
      insertComponentRef(location.parentId, vcId, location.index)
    },
    [insertComponentRef, nodeId],
  )

  // Multi-aware action dispatchers. For single-select they delegate to the
  // pre-existing single-node handlers (which carry their own UX: rename
  // dialog, confirm-delete dialog, etc.); for multi-select they call the
  // *Nodes batch actions directly.
  const dispatchDuplicate = useCallback(() => {
    if (isMulti) {
      duplicateNodesAction(targetIds)
      onClose()
    } else {
      onDuplicate()
    }
  }, [isMulti, targetIds, duplicateNodesAction, onDuplicate, onClose])

  const dispatchCopy = useCallback(() => {
    if (isMulti) {
      copyNodesAction(targetIds)
      onClose()
    } else {
      onCopy()
    }
  }, [isMulti, targetIds, copyNodesAction, onCopy, onClose])

  const dispatchCut = useCallback(() => {
    if (isMulti) {
      cutNodesAction(targetIds)
      onClose()
    } else {
      onCut()
    }
  }, [isMulti, targetIds, cutNodesAction, onCut, onClose])

  const dispatchDelete = useCallback(() => {
    if (isMulti) {
      const idsToDelete = [...targetIds]
      confirmDelete({
        title: 'Delete layers?',
        description: `${idsToDelete.length} layers (and their children) will be removed. This can be undone with Ctrl/Cmd+Z.`,
        confirmLabel: 'Delete',
        commit: () => deleteNodesAction(idsToDelete),
      })
      onClose()
    } else {
      onDelete()
    }
  }, [isMulti, targetIds, confirmDelete, deleteNodesAction, onDelete, onClose])

  const dispatchWrapInContainer = useCallback(() => {
    if (isMulti) {
      wrapNodesAction(targetIds, 'base.container')
      onClose()
    } else {
      onWrapInContainer()
    }
  }, [isMulti, targetIds, wrapNodesAction, onWrapInContainer, onClose])

  const dispatchWrapInLoop = useCallback(() => {
    if (isMulti) {
      wrapNodesAction(targetIds, 'base.loop')
    } else if (nodeId) {
      useEditorStore.getState().wrapNode(nodeId, 'base.loop')
    }
    onClose()
  }, [isMulti, nodeId, targetIds, wrapNodesAction, onClose])

  // Selection-count chip in the menu header (multi only). Lives as a
  // disabled menuitem-equivalent label so screen readers can read "3 layers
  // selected" before announcing the action items.
  const headerLabel = isMulti ? `${selectedNodeIds.length} layers selected` : null

  return (
    <UIContextMenu
      x={x}
      y={y}
      ariaLabel={headerLabel ?? 'Node options'}
      onClose={onClose}
    >
      {headerLabel && (
        <>
          <div role="presentation" className={styles.headerChip}>
            {headerLabel}
          </div>
          <ContextMenuSeparator />
        </>
      )}

      {/* Rename — hidden for slot-instance lockdown AND for multi-select
          (rename is single-node only). */}
      {!lockedSlotInstance && !isMulti && (
        <>
          <ContextMenuItem ref={firstItemRef} onClick={onRename}>
            <span aria-hidden="true"><EditIcon size={13} /></span>
            Rename
          </ContextMenuItem>
        </>
      )}

      {!lockedSlotInstance && (
        <>
          <ContextMenuItem
            ref={isMulti ? firstItemRef : undefined}
            onClick={dispatchDuplicate}
          >
            <span aria-hidden="true"><CopyIcon size={13} /></span>
            Duplicate
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem onClick={dispatchCopy}>
            <span aria-hidden="true"><Copy2Icon size={13} /></span>
            Copy
          </ContextMenuItem>

          <ContextMenuItem onClick={dispatchCut}>
            <span aria-hidden="true"><EraserIcon size={13} /></span>
            Cut
          </ContextMenuItem>

          {canPaste && (
            <ContextMenuItem onClick={onPaste}>
              <span aria-hidden="true"><FilesStack2Icon size={13} /></span>
              Paste
            </ContextMenuItem>
          )}

          <ContextMenuSeparator />

          {/* Wrap is now a submenu with Container / Loop choices. Same UX in
              single- and multi-select — for multi the closest common ancestor
              is computed by `wrapNodes` so cross-parent selections become a
              single wrapper at the right tree level. */}
          <ContextMenuSubmenu
            label="Wrap in"
            icon={<CheckboxIcon size={13} />}
            onClose={onClose}
            width={200}
          >
            <ContextMenuItem onClick={dispatchWrapInContainer}>
              <span aria-hidden="true"><CheckboxIcon size={13} /></span>
              Container
            </ContextMenuItem>
            <ContextMenuItem onClick={dispatchWrapInLoop}>
              <span aria-hidden="true"><BoxStackIcon size={13} /></span>
              Loop
            </ContextMenuItem>
          </ContextMenuSubmenu>
        </>
      )}

      {/*
        "Insert module here" is hidden only for multi-select (the new node has
        no single anchor when 2+ layers are selected). For single-select it is
        always offered: container targets receive the new node as a last child,
        leaf targets (Text, Button, Image, etc.) receive a sibling-after under
        their parent — resolved by `resolveInsertLocation`.
      */}
      {showInsertHere && (
        <ContextMenuSubmenu
          label="Insert module here"
          icon={<PlusIcon size={13} />}
          onClose={onClose}
          width={280}
          maxHeight={420}
          // The submenu hosts a search input — clicks on the input must not
          // dismiss the panel. Only menuitem clicks (i.e. picking a module/VC)
          // should close.
          closeOnItemClickOnly
        >
          <ModulePicker
            onSelectModule={handleSelectModule}
            onSelectVC={handleSelectVC}
          />
        </ContextMenuSubmenu>
      )}

      {!lockedSlotInstance && (
        <>
          <ContextMenuSeparator />

          <ContextMenuItem danger onClick={dispatchDelete}>
            <span aria-hidden="true"><DeleteIcon size={13} /></span>
            Delete
          </ContextMenuItem>
        </>
      )}
    </UIContextMenu>
  )
}
