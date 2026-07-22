/**
 * Tests for collapseStyles — the visual-style filter that takes a raw
 * getComputedStyle result (~390 props, most empty) down to the curated
 * COLLAPSE_KEEP allowlist with default values stripped.
 */
import { describe, expect, it } from 'bun:test'
import { COLLAPSE_KEEP, collapseStyles } from './styleCollapse'

describe('COLLAPSE_KEEP', () => {
  it('contains the key typography and layout properties', () => {
    expect(COLLAPSE_KEEP.has('color')).toBe(true)
    expect(COLLAPSE_KEEP.has('font-size')).toBe(true)
    expect(COLLAPSE_KEEP.has('display')).toBe(true)
    expect(COLLAPSE_KEEP.has('position')).toBe(true)
  })

  it('has between 30 and 60 entries', () => {
    expect(COLLAPSE_KEEP.size).toBeGreaterThanOrEqual(30)
    expect(COLLAPSE_KEEP.size).toBeLessThanOrEqual(60)
  })
})

describe('collapseStyles', () => {
  it('returns {} for empty input', () => {
    expect(collapseStyles({})).toEqual({})
  })

  it('drops background-color and display when they equal their defaults', () => {
    const out = collapseStyles({
      color: 'rgb(255, 0, 0)',
      'background-color': 'rgba(0, 0, 0, 0)',
      display: 'block',
      'font-size': '16px',
    })
    expect(out).toEqual({
      color: 'rgb(255, 0, 0)',
      'font-size': '16px',
    })
  })

  it('drops default values for typical reset properties', () => {
    const out = collapseStyles({
      'margin-top': '0px',
      'margin-left': '10px',
      'padding-right': '0px',
      'border-radius': '0px',
      'opacity': '1',
      'font-weight': '400',
    })
    expect(out).toEqual({
      'margin-left': '10px',
    })
  })

  it('drops custom CSS variables (not in COLLAPSE_KEEP)', () => {
    const out = collapseStyles({
      color: 'rgb(255, 0, 0)',
      '--my-var': 'red',
      '--brand-color': '#fff',
    })
    expect(out).toEqual({ color: 'rgb(255, 0, 0)' })
    expect(out['--my-var']).toBeUndefined()
  })

  it('keeps a non-default value', () => {
    const out = collapseStyles({
      display: 'flex',
      'font-weight': '700',
      'text-align': 'center',
      position: 'relative',
    })
    expect(out).toEqual({
      display: 'flex',
      'font-weight': '700',
      'text-align': 'center',
      position: 'relative',
    })
  })
})
