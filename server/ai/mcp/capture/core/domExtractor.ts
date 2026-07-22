/**
 * Walks a captured DOM and returns outerHTML + a computed-style map.
 * PURE: no Instatic imports, no DB, no side effects. Task 2 will fill this in.
 */
export type ExtractedNode = {
  selector: string
  outerHTML: string
  computedStyles: Record<string, string>
}

export function extractDom(_root: unknown): ExtractedNode[] {
  throw new Error('not implemented (Task 2)')
}
