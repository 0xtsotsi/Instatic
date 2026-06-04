/**
 * SiteSnapshot — the page-context payload the chat handler hands to
 * site-scope tool handlers via `ToolContext.snapshot`.
 *
 * This is the same wire shape the editor's `renderEvidence` builds and POSTs
 * with each chat turn. Kept loose in shape on purpose so the snapshot can
 * evolve without coupling the server to the editor's internal types — the
 * boundary validation lives in the chat handler.
 */

export interface SiteSnapshot {
  pageId: string
  pageTitle: string
  rootNodeId: string
  pages: PageSummary[]
  activeBreakpointId: string
  breakpoints: BreakpointInfo[]
  nodes: NodeInfo[]
  availableModules: ModuleInfo[]
  selectedNodeId: string | null
  classes: ClassInfo[]
  tokens: SnapshotTokens
}

/**
 * The site's design tokens, surfaced so the agent references the design system
 * (`var(--primary)`, `class="text-l text-primary"`) instead of hardcoding
 * off-brand colors, sizes, and fonts. Built by `buildPageContext` from
 * `describeFrameworkTokens` + `describeFontTokens`.
 */
export interface SnapshotTokens {
  colors: SnapshotColorToken[]
  typography: SnapshotScaleGroup[]
  spacing: SnapshotScaleGroup[]
  fonts: SnapshotFontToken[]
}

export interface SnapshotTokenRef {
  /** CSS custom property incl. leading dashes, e.g. "--primary". */
  cssVar: string
  /** `var(--…)` expression ready to drop into a style value. */
  ref: string
  /** Resolved value (light theme / min breakpoint). */
  value: string
  /** Utility class names bound to this token, e.g. ["text-primary","bg-primary"]. */
  utilityClasses: string[]
}

export interface SnapshotColorVariant extends SnapshotTokenRef {
  /** Variant label, e.g. "d-1" (shade), "l-2" (tint), "30" (transparent). */
  variant: string
}

export interface SnapshotColorToken extends SnapshotTokenRef {
  slug: string
  category: string
  darkValue?: string
  variants: SnapshotColorVariant[]
}

export interface SnapshotScaleStep extends SnapshotTokenRef {
  /** Step label, e.g. "xs","m","2xl". */
  step: string
}

export interface SnapshotScaleGroup {
  id: string
  family: 'typography' | 'spacing'
  name: string
  /** Variable/class naming convention, e.g. "text" or "space". */
  namingConvention: string
  steps: SnapshotScaleStep[]
}

export interface SnapshotFontToken {
  name: string
  cssVar: string
  ref: string
  /** Resolved installed family, or "" for a fallback-only token. */
  family: string
  /** Full resolved font-family stack, e.g. `"Inter", sans-serif`. */
  stack: string
}

export interface PageSummary {
  id: string
  title: string
  slug: string
  active: boolean
  isHomepage: boolean
}

export interface BreakpointInfo {
  id: string
  label: string
  width: number
  mediaQuery?: string
  icon: string
}

export interface NodeInfo {
  id: string
  moduleId: string
  label?: string
  parentId: string | null
  children: string[]
  props: Record<string, unknown>
  breakpointOverrides: Record<string, Partial<Record<string, unknown>>>
  classIds: string[]
}

export interface ModuleInfo {
  id: string
  name: string
  description?: string
  category: string
  canHaveChildren: boolean
  defaults: Record<string, unknown>
  props: ModulePropInfo[]
  styles: ModuleStyleInfo[]
}

export interface ModulePropInfo {
  key: string
  type: string
  label: string
  description?: string
  defaultValue?: unknown
  options?: Array<{ label: string; value: unknown }>
  breakpointOverridable?: boolean
}

export interface ModuleStyleInfo {
  key: string
  type: string
  label: string
  description?: string
  defaultValue?: unknown
  cssProperties: string[]
  options?: Array<{ label: string; value: unknown }>
}

export interface ClassInfo {
  id: string
  name: string
  styles?: Record<string, unknown>
  breakpointStyles?: Record<string, Record<string, unknown>>
  /**
   * Set when this class is a locked framework utility class generated from a
   * design token (so the agent can prefer it over an ad-hoc class). The value
   * is the token family it came from; omitted for user-authored classes.
   */
  generated?: 'color' | 'typography' | 'spacing'
}
