/**
 * canvasFraming — DOM measurement glue for "frame to selection" /
 * "fit content" / "fit page" commands.
 *
 * The math (computeFitTransform) lives in `./math.ts` and is pure. This file
 * is the thin DOM layer that reads where things currently are on screen and
 * dispatches the resulting transform to the store. It deliberately stays
 * imperative (no React) so it can be called from keyboard shortcuts, toolbar
 * buttons, the agent runtime, or anywhere else that wants to focus the canvas
 * on something — without dragging React-tree coupling along.
 *
 * Selection scoping
 * ─────────────────
 * When a node is selected and the canvas is rendering several breakpoint
 * frames side-by-side, the same `data-node-id` appears once per frame.
 * Framing prefers the active breakpoint's frame, so the user sees the layer
 * they're editing rather than the leftmost frame.
 *
 * Coordinate model
 * ────────────────
 * Every rect we measure is converted to **canvas-local** screen coordinates
 * (i.e. relative to the canvas root viewport's top-left). `computeFitTransform`
 * then un-applies the current transform internally to recover design-space.
 */

import { useEditorStore } from '@site/store/store'
import { unionRects, type ScreenRect } from './math'

const CANVAS_ROOT_SELECTOR = '[data-testid="canvas-root"]'
const TRANSFORM_LAYER_SELECTOR = '[data-testid="canvas-transform-layer"]'

/** Default padding (in viewport CSS pixels) around the framed rect. */
const FRAME_PADDING = 48
/** Larger padding used when fitting the whole document — leaves room for breakpoint labels. */
const FIT_PADDING = 80

interface CanvasGeometry {
  canvasEl: HTMLElement
  canvasRect: DOMRect
  viewport: { width: number; height: number }
}

/**
 * Locate the canvas viewport and its on-screen rect. Returns `null` when the
 * canvas isn't mounted (called before first render, on a non-site page, etc.).
 */
function getCanvasGeometry(): CanvasGeometry | null {
  if (typeof document === 'undefined') return null
  const canvasEl = document.querySelector<HTMLElement>(CANVAS_ROOT_SELECTOR)
  if (!canvasEl) return null
  const canvasRect = canvasEl.getBoundingClientRect()
  return {
    canvasEl,
    canvasRect,
    viewport: { width: canvasRect.width, height: canvasRect.height },
  }
}

/**
 * Convert an absolute DOMRect into the canvas's local screen coordinates.
 * Skips rects with zero size (transient layout states) by returning `null`.
 */
function toCanvasLocal(rect: DOMRect, canvasRect: DOMRect): ScreenRect | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: rect.left - canvasRect.left,
    y: rect.top - canvasRect.top,
    width: rect.width,
    height: rect.height,
  }
}

/**
 * For a selected node id, find its rendered element inside (in order):
 *   1. the active breakpoint's frame, if mounted
 *   2. any other breakpoint frame (in document order)
 *
 * Returns the rect in canvas-local coordinates, or `null` if the node isn't
 * laid out anywhere (e.g. hidden subtree, page mid-swap).
 *
 * Why search by breakpoint first: the same `data-node-id` exists in every
 * breakpoint frame the canvas is showing. We prefer the one the user is
 * actively editing so the camera framing matches their mental model.
 */
function getNodeRect(
  nodeId: string,
  activeBreakpointId: string,
  canvasRect: DOMRect,
): ScreenRect | null {
  const escaped = escapeAttribute(nodeId)
  const activeFrame = document.querySelector<HTMLElement>(
    `[data-breakpoint-id="${escapeAttribute(activeBreakpointId)}"]`,
  )

  const findInFrame = (frame: HTMLElement | null): HTMLElement | null => {
    if (!frame) return null
    const wrapper = frame.querySelector<HTMLElement>(`[data-node-id="${escaped}"]`)
    if (!wrapper) return null
    // NodeWrapper is `display: contents` so its own rect is zero-sized — read
    // the first rendered child instead. Same trick used by
    // BreakpointSelectionOverlay.
    const target = (wrapper.firstElementChild as HTMLElement | null) ?? wrapper
    return target
  }

  const target = findInFrame(activeFrame) ?? (() => {
    const frames = document.querySelectorAll<HTMLElement>('[data-breakpoint-id]')
    for (const frame of frames) {
      const found = findInFrame(frame)
      if (found) return found
    }
    return null
  })()

  if (!target) return null
  return toCanvasLocal(target.getBoundingClientRect(), canvasRect)
}

/**
 * Frame the current selection (single or multi).
 *
 * Behaviour:
 *  - If nothing is selected, falls through to {@link fitContentCanvas} so the
 *    same shortcut never feels like a no-op for the user.
 *  - With one selection, frames just that node's bounding box.
 *  - With multi-selection, frames the union of every selected node's bbox.
 *
 * Returns `true` when a transform was dispatched. The toolbar uses this to
 * decide whether to flash a subtle animation; tests use it to assert the
 * happy path fired.
 */
export function frameSelectedNodes(padding = FRAME_PADDING): boolean {
  const geom = getCanvasGeometry()
  if (!geom) return false
  const store = useEditorStore.getState()
  const ids = store.selectedNodeIds
  if (ids.length === 0) return fitContentCanvas(FIT_PADDING)

  const rects: ScreenRect[] = []
  for (const id of ids) {
    const rect = getNodeRect(id, store.activeBreakpointId, geom.canvasRect)
    if (rect) rects.push(rect)
  }
  const target = unionRects(rects)
  if (!target) return fitContentCanvas(FIT_PADDING)
  store.zoomToRect(target, geom.viewport, padding)
  return true
}

/**
 * Fit the entire document (every breakpoint frame) into the viewport.
 *
 * Reads the bounding rect of the transform layer directly — that already
 * contains every BreakpointFrame and is what's actually visible on screen.
 *
 * Returns `true` when a transform was dispatched.
 */
export function fitContentCanvas(padding = FIT_PADDING): boolean {
  const geom = getCanvasGeometry()
  if (!geom) return false
  const layer = document.querySelector<HTMLElement>(TRANSFORM_LAYER_SELECTOR)
  if (!layer) return false
  const target = toCanvasLocal(layer.getBoundingClientRect(), geom.canvasRect)
  if (!target) return false

  useEditorStore.getState().zoomToRect(target, geom.viewport, padding)
  return true
}

/**
 * Smart "fit" — frames the selection when there is one, otherwise fits the
 * whole document. Wired to the `1` and `F` keyboard shortcuts and to the
 * primary toolbar button.
 */
export function frameOrFitCanvas(): boolean {
  const ids = useEditorStore.getState().selectedNodeIds
  return ids.length > 0 ? frameSelectedNodes() : fitContentCanvas()
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
