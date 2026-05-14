/**
 * ModulePickerDropdown — toolbar "+ Add" trigger that opens the shared
 * `ModulePickerMenu` (search + categorized module list).
 *
 * The trigger is a small primary button rendered inside the toolbar. Clicking
 * it opens the picker as a `ContextMenu` anchored to the button, auto-flipping
 * to stay on screen. Picking a module / Visual Component inserts it into the
 * active page using the toolbar's "smart parent" resolution (selectedNodeId
 * falls back to its parent or the page root) and closes the dropdown.
 *
 * Page / Component creation lives elsewhere (Site Explorer) — this dropdown is
 * exclusively about inserting nodes into the current page.
 *
 * Architecture gate (G1, G5): the Components-category click MUST route through
 * `insertComponentRef` so cycle detection and VC/page-mode dispatch are applied
 * uniformly. See `src/__tests__/architecture/component-system-placement.test.ts`.
 */

import { useCallback, useRef, useState } from 'react'
import { useEditorStore, selectActiveCanvasPage } from '@site/store/store'
import { resolveInsertLocation } from '@site/store/insertLocation'
import type { AnyModuleDefinition } from '@core/module-engine/types'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { Button } from '@ui/components/Button'
import { ModulePickerMenu } from '@site/module-picker'
import { useInsertModule } from '@site/hooks/useInsertModule'

interface ModulePickerDropdownProps {
  triggerClassName?: string
  triggerTestId?: string
}

export function ModulePickerDropdown({
  triggerClassName,
  triggerTestId = 'toolbar-add-module-btn',
}: ModulePickerDropdownProps = {}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // selectActiveCanvasPage unifies page mode and VC-canvas mode — Components
  // dropped from the toolbar use the same resolver as the right-click menu.
  const canvasPage = useEditorStore(selectActiveCanvasPage)
  const insertComponentRef = useEditorStore((s) => s.insertComponentRef)
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId)
  const insertModule = useInsertModule()

  const handleOpen = useCallback(() => setOpen(true), [])
  const handleClose = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  const handleInsertModule = useCallback(
    (mod: AnyModuleDefinition) => {
      if (insertModule(mod)) handleClose()
    },
    [insertModule, handleClose],
  )

  const handleInsertVC = useCallback(
    (vcId: string) => {
      if (!canvasPage) {
        handleClose()
        return
      }
      // Same target → location resolution as every other insert flow: explicit
      // selection acts as the target, no selection drops at root, leaf targets
      // become a sibling-after under their parent (see resolveInsertLocation).
      const targetId = selectedNodeId ?? canvasPage.rootNodeId
      const location = resolveInsertLocation(canvasPage, targetId)
      if (!location) {
        handleClose()
        return
      }
      insertComponentRef(location.parentId, vcId, location.index)
      handleClose()
    },
    [canvasPage, selectedNodeId, insertComponentRef, handleClose],
  )

  return (
    <>
      <Button
        ref={triggerRef}
        variant="primary"
        size="sm"
        iconOnly
        accentFill
        className={triggerClassName}
        aria-label="Add module"
        aria-haspopup="menu"
        aria-expanded={open}
        tooltip="Add module"
        onClick={handleOpen}
        data-testid={triggerTestId}
      >
        <PlusIcon size={13} />
      </Button>

      {open && (
        <ModulePickerMenu
          anchorRef={triggerRef}
          onClose={handleClose}
          onSelectModule={handleInsertModule}
          onSelectVC={handleInsertVC}
        />
      )}
    </>
  )
}
