/**
 * Walk a rendered DOM and produce ExtractedNode records.
 *
 * Two entry points:
 *   - extractDom(target, ctx) — PURE TypeScript. Takes a Document + Window
 *     and walks in-process. Used by tests (which inject a happy-dom Window).
 *   - makePageWalker(target, props) — bridges to a page realm via
 *     page.evaluate. The Playwright fetcher uses this; the actual walking
 *     happens in the page's V8 where document and window are real globals.
 *
 * PURE module: no Instatic imports, no DB, no top-level side effects.
 * The architecture test in captureTool.test.ts only bans @core/, server/,
 * and src/core/ specifiers in core/ — happy-dom and playwright-core are
 * allowed.
 *
 * NO `new Function`, NO `Function` constructor, NO string-serialised
 * walker on the test path. The only `new Function` use is inside
 * makePageWalker, which exists to bridge the Playwright page.evaluate
 * boundary — it is acceptable at this boundary because document/window
 * must be live page globals there.
 */

export type ExtractedNode = {
  selector: string
  outerHTML: string
  computedStyles: Record<string, string>
}

export interface CaptureTarget {
  /** CSS selector for the capture root. null/undefined = document.body. */
  selector?: string | null
  /** Max depth to walk from the root. Default 0 (root only). Use Infinity for everything. */
  maxDepth?: number
}

export interface ExtractContext {
  /** A live Document object the walker reads from. */
  document: Document
  /** A live Window object the walker uses for getComputedStyle. */
  window: Window & typeof globalThis
  /** The original HTML string. Useful for diagnostics and tests. */
  html: string
  /** Release any resources held by the context. Always async-safe. */
  close(): Promise<void>
}

/** Properties captured per node. Order = order in emitted CSS. */
export const COMPUTED_PROPS: readonly string[] = [
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
]

// --- PURE TypeScript walker (used by tests via happy-dom) ---

/** Build a unique CSS selector for `el` relative to `root` (tag:nth-of-type). */
function uniqueSelector(el: Element, root: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur !== root.parentElement) {
    const parent = cur.parentElement
    if (!parent) break
    const tag = cur.tagName.toLowerCase()
    const sameTag: Element[] = []
    for (let i = 0; i < parent.children.length; i++) {
      const s = parent.children.item(i)
      if (s && s.tagName === cur.tagName) sameTag.push(s)
    }
    const idx = sameTag.indexOf(cur) + 1
    parts.unshift(idx > 1 ? `${tag}:nth-of-type(${idx})` : tag)
    if (cur === root) break
    cur = parent
  }
  return parts.join(' > ')
}

/** Read COMPUTED_PROPS from a single element via window.getComputedStyle. */
function captureStyles(
  el: Element,
  win: Window & typeof globalThis,
  props: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {}
  let cs: CSSStyleDeclaration
  try {
    cs = win.getComputedStyle(el)
  } catch {
    return out
  }
  for (const prop of props) {
    let v = ''
    try {
      v = cs.getPropertyValue(prop)
    } catch {
      continue
    }
    if (v) out[prop] = v
  }
  return out
}

/** Depth-first walk from `el` to `maxDepth`, emitting into `out`. */
function walk(
  el: Element,
  depth: number,
  maxDepth: number,
  root: Element,
  win: Window & typeof globalThis,
  props: readonly string[],
  out: ExtractedNode[],
): void {
  out.push({
    selector: uniqueSelector(el, root),
    outerHTML: el.outerHTML,
    computedStyles: captureStyles(el, win, props),
  })
  if (depth >= maxDepth) return
  for (let i = 0; i < el.children.length; i++) {
    const c = el.children.item(i)
    if (c) walk(c, depth + 1, maxDepth, root, win, props, out)
  }
}

/**
 * Walk the rendered DOM rooted at target.selector (or document.body) and
 * return nodes. PURE: takes a context object with document + window, no
 * global side effects, no string-serialised code.
 */
export function extractDom(target: CaptureTarget, ctx: ExtractContext): ExtractedNode[] {
  const root: Element | null = target.selector
    ? ctx.document.querySelector(target.selector)
    : ctx.document.body
  if (!root) return []
  const maxDepth = target.maxDepth === undefined ? 0 : target.maxDepth
  const out: ExtractedNode[] = []
  walk(root, 0, maxDepth, root, ctx.window, COMPUTED_PROPS, out)
  return out
}

// --- Page-side walker source (used by playwrightFetcher.ts via page.evaluate) ---
//
// IMPORTANT: this MUST mirror the TypeScript walker above. If you change
// the algorithm, change both. Tests cover the TypeScript version; the
// Playwright fetcher asserts the page-side version produces equivalent
// output for a known-good input (gated on CAPTURE_LIVE=1 in Task 6).
//
// The only difference from the TypeScript version: this version reads
// `document` and `window` as ambient page-globals (Playwright's
// page.evaluate runs in the page's V8 context where those are real
// globals), where the TypeScript version takes them as arguments.
const PAGE_WALKER_SOURCE = `
"use strict";
function uniqueSelector(el, root) {
  var parts = [];
  var cur = el;
  while (cur && cur !== root.parentElement) {
    var parent = cur.parentElement;
    if (!parent) break;
    var tag = cur.tagName.toLowerCase();
    var sameTag = [];
    for (var i = 0; i < parent.children.length; i++) {
      var s = parent.children[i];
      if (s.tagName === cur.tagName) sameTag.push(s);
    }
    var idx = sameTag.indexOf(cur) + 1;
    parts.unshift(idx > 1 ? (tag + ":nth-of-type(" + idx + ")") : tag);
    if (cur === root) break;
    cur = parent;
  }
  return parts.join(" > ");
}
function captureStyles(el, win, props) {
  var out = {};
  var cs;
  try { cs = win.getComputedStyle(el); } catch (e) { return out; }
  for (var j = 0; j < props.length; j++) {
    var v = "";
    try { v = cs.getPropertyValue(props[j]); } catch (e) { continue; }
    if (v) out[props[j]] = v;
  }
  return out;
}
function walk(el, depth, maxDepth, root, win, props, out) {
  out.push({
    selector: uniqueSelector(el, root),
    outerHTML: el.outerHTML,
    computedStyles: captureStyles(el, win, props)
  });
  if (depth >= maxDepth) return;
  for (var k = 0; k < el.children.length; k++) {
    walk(el.children[k], depth + 1, maxDepth, root, win, props, out);
  }
}
function runExtract(target, COMPUTED_PROPS_) {
  var root = target.selector
    ? document.querySelector(target.selector)
    : document.body;
  if (!root) return [];
  var maxDepth = target.maxDepth === undefined ? 0 : target.maxDepth;
  var out = [];
  walk(root, 0, maxDepth, root, window, COMPUTED_PROPS_, out);
  return out;
}
return runExtract(target, COMPUTED_PROPS_);
`

/**
 * Page-side walker. Used by the Playwright fetcher via page.evaluate —
 * the function body runs in the page's V8 where `document` and `window`
 * are real globals. Bun serialises the function source before Playwright
 * sends it to the page.
 *
 * This is the ONLY place in the module that uses `new Function` —
 * it exists to bridge the Playwright page.evaluate boundary. The pure
 * TypeScript walker used by tests (extractDom) never touches this.
 */
export function makePageWalker(target: CaptureTarget, props: readonly string[]): ExtractedNode[] {
  // eslint-disable-next-line no-new-func
  const fn = new Function('target', 'COMPUTED_PROPS_', PAGE_WALKER_SOURCE) as (
    target: CaptureTarget,
    props: readonly string[],
  ) => ExtractedNode[]
  return fn(target, props)
}
