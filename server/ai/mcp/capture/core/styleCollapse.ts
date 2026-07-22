/**
 * Collapses a getComputedStyle result to the visually-meaningful subset.
 *
 * A computed style has ~390 properties; most are empty. This module filters
 * the result down to a curated allowlist (~50 properties) and drops values
 * that match CSS initial defaults (e.g. `display: block`, `position: static`,
 * `margin-top: 0px`) so the emitted CSS is minimal.
 *
 * PURE: no Instatic imports, no DOM access.
 */

export const COLLAPSE_KEEP: ReadonlySet<string> = new Set([
  // colour + background
  'color', 'background-color', 'background-image', 'background-size',
  'background-position', 'background-repeat',
  // typography
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-align', 'text-transform', 'text-decoration',
  'text-decoration-color', 'text-shadow',
  // box model
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  // border
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-radius',
  // layout
  'display', 'position', 'width', 'height', 'max-width', 'min-height',
  'overflow', 'opacity', 'box-shadow', 'transform', 'transition', 'z-index',
])

/** Default values that mean "no styling applied" — drop the declaration if equal. */
const DEFAULT_VALUES: Record<string, string> = {
  'color': 'rgb(0, 0, 0)',
  'background-color': 'rgba(0, 0, 0, 0)',
  'background-image': 'none',
  'background-size': 'auto',
  'background-position': '0% 0%',
  'background-repeat': 'repeat',
  'font-family': '',
  'font-size': '',
  'font-weight': '400',
  'font-style': 'normal',
  'line-height': 'normal',
  'letter-spacing': 'normal',
  'text-align': 'start',
  'text-transform': 'none',
  'text-decoration': 'none',
  'text-decoration-color': '',
  'text-shadow': 'none',
  'margin-top': '0px',
  'margin-right': '0px',
  'margin-bottom': '0px',
  'margin-left': '0px',
  'padding-top': '0px',
  'padding-right': '0px',
  'padding-bottom': '0px',
  'padding-left': '0px',
  'border-top-width': '0px',
  'border-right-width': '0px',
  'border-bottom-width': '0px',
  'border-left-width': '0px',
  'border-top-color': 'rgb(0, 0, 0)',
  'border-right-color': 'rgb(0, 0, 0)',
  'border-bottom-color': 'rgb(0, 0, 0)',
  'border-left-color': 'rgb(0, 0, 0)',
  'border-top-style': 'none',
  'border-right-style': 'none',
  'border-bottom-style': 'none',
  'border-left-style': 'none',
  'border-radius': '0px',
  'display': 'block',
  'position': 'static',
  'width': 'auto',
  'height': 'auto',
  'max-width': 'none',
  'min-height': 'auto',
  'overflow': 'visible',
  'opacity': '1',
  'box-shadow': 'none',
  'transform': 'none',
  'transition': 'all 0s ease 0s',
  'z-index': 'auto',
}

function isEmptyValue(prop: string, value: string): boolean {
  if (value === '' || value === 'none' || value === 'auto' || value === 'normal') {
    if (prop === 'line-height' || prop === 'letter-spacing') return false
    return true
  }
  if (value === '0px' || value === 'rgba(0, 0, 0, 0)') return true
  return false
}

export function collapseStyles(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [prop, value] of Object.entries(raw)) {
    if (!COLLAPSE_KEEP.has(prop)) continue
    if (isEmptyValue(prop, value)) continue
    if (value === DEFAULT_VALUES[prop]) continue
    out[prop] = value
  }
  return out
}
