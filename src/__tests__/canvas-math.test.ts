/**
 * Canvas Math — pure function unit tests
 *
 * Tests clampZoom, nearestZoomStep, and ZOOM_STEPS from the canvas slice.
 * These are exported as pure functions for regression testing (see Performance
 * Engineer's Contribution #311 which adds timing assertions on top of these).
 *
 * All tests use bun:test. No DOM required — these are purely mathematical functions.
 */

import { describe, it, expect } from 'bun:test'
import {
  clampZoom,
  nearestZoomStep,
  ZOOM_STEPS,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_ZOOM,
  computeFitTransform,
  unionRects,
} from '@site/canvas/math'

// ---------------------------------------------------------------------------
// clampZoom
// ---------------------------------------------------------------------------

describe('clampZoom', () => {
  it('returns value unchanged when within valid range', () => {
    expect(clampZoom(0.5)).toBe(0.5)
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(1.5)).toBe(1.5)
    expect(clampZoom(2)).toBe(2)
    expect(clampZoom(3)).toBe(3)
  })

  it('clamps to MIN_ZOOM when below minimum', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(-1)).toBe(MIN_ZOOM)
    expect(clampZoom(-999)).toBe(MIN_ZOOM)
    expect(clampZoom(MIN_ZOOM - 0.001)).toBe(MIN_ZOOM)
  })

  it('clamps to MAX_ZOOM when above maximum', () => {
    expect(clampZoom(5)).toBe(MAX_ZOOM)
    expect(clampZoom(10)).toBe(MAX_ZOOM)
    expect(clampZoom(999)).toBe(MAX_ZOOM)
    expect(clampZoom(MAX_ZOOM + 0.001)).toBe(MAX_ZOOM)
  })

  it('returns exactly MIN_ZOOM at the lower boundary', () => {
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM)
  })

  it('returns exactly MAX_ZOOM at the upper boundary', () => {
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM)
  })

  it('DEFAULT_ZOOM is within valid range and unaffected by clamp', () => {
    expect(clampZoom(DEFAULT_ZOOM)).toBe(DEFAULT_ZOOM)
    expect(DEFAULT_ZOOM).toBeGreaterThanOrEqual(MIN_ZOOM)
    expect(DEFAULT_ZOOM).toBeLessThanOrEqual(MAX_ZOOM)
  })
})

// ---------------------------------------------------------------------------
// nearestZoomStep
// ---------------------------------------------------------------------------

describe('nearestZoomStep — zoom in (direction: 1)', () => {
  it('returns the next step above current zoom', () => {
    expect(nearestZoomStep(0.1, 1)).toBe(0.25)
    expect(nearestZoomStep(0.25, 1)).toBe(0.5)
    expect(nearestZoomStep(0.5, 1)).toBe(0.75)
    expect(nearestZoomStep(0.75, 1)).toBe(1)
    expect(nearestZoomStep(1, 1)).toBe(1.25)
    expect(nearestZoomStep(1.25, 1)).toBe(1.5)
    expect(nearestZoomStep(1.5, 1)).toBe(2)
    expect(nearestZoomStep(2, 1)).toBe(3)
    expect(nearestZoomStep(3, 1)).toBe(4)
  })

  it('returns MAX_ZOOM when already at max step', () => {
    expect(nearestZoomStep(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
  })

  it('returns MAX_ZOOM when above all steps (capped)', () => {
    expect(nearestZoomStep(3.9, 1)).toBe(MAX_ZOOM)
  })

  it('snaps correctly from a non-step value between steps', () => {
    // Between 1.0 and 1.25 — zooming in should snap to 1.25
    expect(nearestZoomStep(1.1, 1)).toBe(1.25)
    // Between 0.5 and 0.75 — zooming in should snap to 0.75
    expect(nearestZoomStep(0.6, 1)).toBe(0.75)
  })
})

describe('nearestZoomStep — zoom out (direction: -1)', () => {
  it('returns the next step below current zoom', () => {
    expect(nearestZoomStep(0.25, -1)).toBe(0.1)
    expect(nearestZoomStep(0.5, -1)).toBe(0.25)
    expect(nearestZoomStep(0.75, -1)).toBe(0.5)
    expect(nearestZoomStep(1, -1)).toBe(0.75)
    expect(nearestZoomStep(1.25, -1)).toBe(1)
    expect(nearestZoomStep(1.5, -1)).toBe(1.25)
    expect(nearestZoomStep(2, -1)).toBe(1.5)
    expect(nearestZoomStep(3, -1)).toBe(2)
    expect(nearestZoomStep(4, -1)).toBe(3)
  })

  it('returns MIN_ZOOM when already at min step', () => {
    expect(nearestZoomStep(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })

  it('returns MIN_ZOOM when below all steps (floored)', () => {
    expect(nearestZoomStep(0.11, -1)).toBe(MIN_ZOOM)
  })

  it('snaps correctly from a non-step value between steps', () => {
    // Between 1.0 and 1.25 — zooming out should snap to 1.0
    expect(nearestZoomStep(1.1, -1)).toBe(1)
    // Between 0.5 and 0.75 — zooming out should snap to 0.5
    expect(nearestZoomStep(0.6, -1)).toBe(0.5)
  })
})

// ---------------------------------------------------------------------------
// ZOOM_STEPS array invariants
// ---------------------------------------------------------------------------

describe('ZOOM_STEPS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(ZOOM_STEPS)).toBe(true)
    expect(ZOOM_STEPS.length).toBeGreaterThan(0)
  })

  it('all values are positive numbers', () => {
    for (const step of ZOOM_STEPS) {
      expect(step).toBeGreaterThan(0)
    }
  })

  it('is monotonically increasing (no duplicate or out-of-order values)', () => {
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      expect(ZOOM_STEPS[i]).toBeGreaterThan(ZOOM_STEPS[i - 1])
    }
  })

  it('starts at MIN_ZOOM', () => {
    expect(ZOOM_STEPS[0]).toBe(MIN_ZOOM)
  })

  it('ends at MAX_ZOOM', () => {
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(MAX_ZOOM)
  })

  it('contains DEFAULT_ZOOM (1.0) as a named step', () => {
    expect(ZOOM_STEPS).toContain(DEFAULT_ZOOM)
  })

  it('all values are within [MIN_ZOOM, MAX_ZOOM]', () => {
    for (const step of ZOOM_STEPS) {
      expect(step).toBeGreaterThanOrEqual(MIN_ZOOM)
      expect(step).toBeLessThanOrEqual(MAX_ZOOM)
    }
  })
})

// ---------------------------------------------------------------------------
// clampZoom + nearestZoomStep integration
// ---------------------------------------------------------------------------

describe('clampZoom + nearestZoomStep integration', () => {
  it('zooming in from every ZOOM_STEPS value never exceeds MAX_ZOOM after clamping', () => {
    for (const step of ZOOM_STEPS) {
      const next = nearestZoomStep(step, 1)
      expect(clampZoom(next)).toBe(next)
      expect(next).toBeLessThanOrEqual(MAX_ZOOM)
    }
  })

  it('zooming out from every ZOOM_STEPS value never goes below MIN_ZOOM after clamping', () => {
    for (const step of ZOOM_STEPS) {
      const prev = nearestZoomStep(step, -1)
      expect(clampZoom(prev)).toBe(prev)
      expect(prev).toBeGreaterThanOrEqual(MIN_ZOOM)
    }
  })
})

// ---------------------------------------------------------------------------
// computeFitTransform — frame-to-rect math
// ---------------------------------------------------------------------------

describe('computeFitTransform', () => {
  const VIEWPORT = { width: 1000, height: 800 }
  const IDENTITY = { zoom: 1, panX: 0, panY: 0 }

  it('centres a smaller-than-viewport rect at fit-zoom with padding', () => {
    // A 200×100 rect at (50, 30) — well within the viewport.
    const { zoom, panX, panY } = computeFitTransform(
      { x: 50, y: 30, width: 200, height: 100 },
      VIEWPORT,
      IDENTITY,
      32,
    )

    // Available area: (1000-64) × (800-64) = 936 × 736.
    // Fit zoom = min(936/200, 736/100) = min(4.68, 7.36) = 4.68 → clamped to 4.
    expect(zoom).toBe(4)

    // After framing, the rect's centre should land at viewport centre.
    const designCx = 50 + 100
    const designCy = 30 + 50
    const screenCx = zoom * designCx + panX
    const screenCy = zoom * designCy + panY
    expect(screenCx).toBeCloseTo(500, 5)
    expect(screenCy).toBeCloseTo(400, 5)
  })

  it('downscales a larger-than-viewport rect to fit', () => {
    // 2000×1500 rect — must be shrunk to fit 936×736 available area.
    const { zoom, panX, panY } = computeFitTransform(
      { x: 0, y: 0, width: 2000, height: 1500 },
      VIEWPORT,
      IDENTITY,
      32,
    )

    // min(936/2000, 736/1500) = min(0.468, 0.4906...) = 0.468.
    expect(zoom).toBeCloseTo(0.468, 3)
    // Rect centre at design (1000, 750) should land at viewport centre.
    expect(0.468 * 1000 + panX).toBeCloseTo(500, 2)
    expect(0.468 * 750 + panY).toBeCloseTo(400, 2)
  })

  it('clamps the result to MAX_ZOOM', () => {
    // 1×1 rect — would fit at insane zoom; ensure we clamp.
    const { zoom } = computeFitTransform(
      { x: 0, y: 0, width: 1, height: 1 },
      VIEWPORT,
      IDENTITY,
      32,
    )
    expect(zoom).toBe(MAX_ZOOM)
  })

  it('correctly un-applies a non-identity input transform', () => {
    // Take a node currently rendering on-screen at (500, 400, 100, 80) while
    // the canvas is at zoom=2, pan=(-50, -100). Its design-space rect is:
    //   dx = (500 - (-50)) / 2 = 275
    //   dy = (400 - (-100)) / 2 = 250
    //   dw = 50, dh = 40
    const current = { zoom: 2, panX: -50, panY: -100 }
    const target = { x: 500, y: 400, width: 100, height: 80 }
    const { zoom, panX, panY } = computeFitTransform(target, VIEWPORT, current, 32)

    // After framing, the same design-space centre (275 + 25, 250 + 20) = (300, 270)
    // should land at viewport centre (500, 400).
    expect(zoom * 300 + panX).toBeCloseTo(500, 4)
    expect(zoom * 270 + panY).toBeCloseTo(400, 4)
  })

  it('returns the current transform unchanged for degenerate inputs', () => {
    const current = { zoom: 1.5, panX: 12, panY: 34 }
    const result = computeFitTransform(
      { x: 0, y: 0, width: 0, height: 0 },
      VIEWPORT,
      current,
    )
    expect(result).toEqual(current)
  })

  it('respects the padding parameter — larger padding means less zoom', () => {
    const rect = { x: 0, y: 0, width: 500, height: 400 }
    const tight = computeFitTransform(rect, VIEWPORT, IDENTITY, 0)
    const loose = computeFitTransform(rect, VIEWPORT, IDENTITY, 100)
    expect(tight.zoom).toBeGreaterThan(loose.zoom)
  })
})

// ---------------------------------------------------------------------------
// unionRects — bounding box of multi-selection
// ---------------------------------------------------------------------------

describe('unionRects', () => {
  it('returns null for an empty list', () => {
    expect(unionRects([])).toBeNull()
  })

  it('returns the single rect when given exactly one', () => {
    const r = { x: 10, y: 20, width: 30, height: 40 }
    expect(unionRects([r])).toEqual(r)
  })

  it('computes the bounding box of disjoint rects', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 200, y: 150, width: 50, height: 50 }
    expect(unionRects([a, b])).toEqual({ x: 0, y: 0, width: 250, height: 200 })
  })

  it('handles overlapping rects', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 50, y: 50, width: 100, height: 100 }
    expect(unionRects([a, b])).toEqual({ x: 0, y: 0, width: 150, height: 150 })
  })

  it('skips rects with zero or negative dimensions', () => {
    const valid = { x: 0, y: 0, width: 100, height: 100 }
    const zero = { x: 500, y: 500, width: 0, height: 0 }
    expect(unionRects([valid, zero])).toEqual(valid)
  })

  it('returns null when every rect is degenerate', () => {
    expect(unionRects([
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 10, y: 10, width: -5, height: 5 },
    ])).toBeNull()
  })
})
