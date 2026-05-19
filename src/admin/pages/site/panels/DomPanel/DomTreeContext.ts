/**
 * DomTreeContext — local UI state for the DOM tree panel.
 * Tracks which nodes are expanded/collapsed in the tree view.
 * This is UI-only state — it is NOT part of the Zustand site store.
 * (Constraint #182: no document-model state outside the store.)
 */
import { createContext, use } from 'react'

interface DomTreeContextValue {
  /** Set of expanded node IDs */
  expanded: Set<string>
  isExpanded: (nodeId: string) => boolean
  toggleExpanded: (nodeId: string) => void
  /** Add a single node to the expanded set without replacing others */
  expandNode: (nodeId: string) => void
  expandAll: (nodeIds: string[]) => void
  collapseAll: () => void
}

export const DomTreeContext = createContext<DomTreeContextValue>({
  expanded: new Set(),
  isExpanded: () => false,
  toggleExpanded: () => {},
  expandNode: () => {},
  expandAll: () => {},
  collapseAll: () => {},
})

export function useDomTree() {
  return use(DomTreeContext)
}
