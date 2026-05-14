/**
 * resolveInsertLocation — shared "where should a new node land?" resolver.
 *
 * Every UI flow that inserts a node relative to a user-clicked target (toolbar
 * picker, canvas right-click, DOM-panel right-click, clipboard paste, etc.)
 * resolves the actual parent + insertion index the same way:
 *
 *   - The page root and any module declaring `canHaveChildren: true` accept
 *     children. The new node is appended as the target's last child.
 *   - Anything else (Text, Button, Image, an opaque slot-instance, etc.) is a
 *     leaf — the new node is inserted as the *next sibling* under the
 *     target's parent. Without this fallback the right-click "Insert module
 *     here" / paste actions silently no-op on leaf targets.
 *
 *   - Visual-Component refs are containers in the tree sense (their
 *     slot-instance children are managed by the editor), but user-authored
 *     content goes inside the FIRST slot-instance, not as a direct child of
 *     the ref. We redirect into that slot here so callers don't have to
 *     repeat the logic. A ref without any slot-instances is a defensive
 *     dead-end (syncSlotInstances guarantees it can't happen) — return null
 *     rather than inserting orphan content.
 */

import { registry } from '@core/module-engine/registry'
import type { Page } from '@core/page-tree/schemas'

export interface InsertLocation {
  parentId: string
  /** Insertion index inside parent. Undefined means "append to end". */
  index: number | undefined
}

export function resolveInsertLocation(
  page: Page,
  targetNodeId: string,
): InsertLocation | null {
  const target = page.nodes[targetNodeId]
  if (!target) return null

  // The page root always accepts children even if its module entry is
  // unregistered (load-order edge case) — pages are never leaves.
  const isRoot = page.rootNodeId === targetNodeId
  const definition = registry.get(target.moduleId)
  const acceptsChildren = isRoot || definition?.canHaveChildren === true

  if (!acceptsChildren) {
    // Leaf target → insert as next sibling under target's parent.
    const parent = Object.values(page.nodes).find((n) =>
      n.children.includes(targetNodeId),
    )
    if (!parent) return null
    const idx = parent.children.indexOf(targetNodeId)
    return { parentId: parent.id, index: idx >= 0 ? idx + 1 : undefined }
  }

  // base.visual-component-ref is a container, but user content must land
  // inside its first slot-instance child — direct children are managed by
  // syncSlotInstances. The redirect happens here so every caller doesn't
  // repeat the logic.
  if (target.moduleId === 'base.visual-component-ref') {
    const slotInstanceChildId = target.children.find(
      (childId) => page.nodes[childId]?.moduleId === 'base.slot-instance',
    )
    if (!slotInstanceChildId) {
      // Defensive: a VC ref without slot-instances shouldn't exist post-
      // syncSlotInstances. Surface the dead-end rather than insert orphan
      // content into a ref that the publisher would discard.
      return null
    }
    return { parentId: slotInstanceChildId, index: undefined }
  }

  return { parentId: targetNodeId, index: undefined }
}
