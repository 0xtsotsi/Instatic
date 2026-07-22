/**
 * Rewrites a flat map of element-styles into class-scoped CSS rules.
 *
 * Each input key is a CSS selector (the captured node's unique selector).
 * The output is `.scopeClass .cap_<hash> { declarations }` — the hash is
 * FNV-1a over the original selector, base36 padded, so quoting issues
 * disappear when reusing generated CSS selectors as class names.
 *
 * Declaration order follows COLLAPSE_KEEP so the emitted CSS is stable.
 *
 * PURE: no Instatic knowledge; the Instatic-side token rewriter lives in
 * adapters/tokens.ts.
 */

import { COLLAPSE_KEEP } from './styleCollapse'

export const DEFAULT_SCOPE_CLASS = 'instatic-capture'

export interface RewriteCssOptions {
  scopeClass?: string
  stableOrder?: boolean
}

function selectorToClass(selector: string): string {
  // FNV-1a 32-bit hash, base36, padded to 10 chars. Avoids quoting
  // issues when reusing generated CSS selectors as class names.
  let h = 0x811c9dc5
  for (let i = 0; i < selector.length; i++) {
    h ^= selector.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  const base36 = h.toString(36).padStart(10, '0').slice(-10)
  return `cap_${base36}`
}

function kebab(prop: string): string {
  if (prop.startsWith('--')) return prop
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

function formatRule(scopeClass: string, selector: string, decls: Record<string, string>): string {
  const inner = selectorToClass(selector)
  const lines: string[] = []
  for (const prop of COLLAPSE_KEEP) {
    const val = decls[prop]
    if (val === undefined) continue
    lines.push(`  ${kebab(prop)}: ${val};`)
  }
  // Defensive: include any decls not in COLLAPSE_KEEP.
  for (const [prop, val] of Object.entries(decls)) {
    if (COLLAPSE_KEEP.has(prop)) continue
    lines.push(`  ${kebab(prop)}: ${val};`)
  }
  return `.${scopeClass} .${inner} {\n${lines.join('\n')}\n}\n`
}

export function rewriteCss(
  styles: Record<string, Record<string, string>>,
  opts: RewriteCssOptions = {},
): string {
  const scope = opts.scopeClass ?? DEFAULT_SCOPE_CLASS
  const selectors = opts.stableOrder ? Object.keys(styles).sort() : Object.keys(styles)
  let out = ''
  for (const sel of selectors) {
    out += formatRule(scope, sel, styles[sel])
  }
  return out
}
