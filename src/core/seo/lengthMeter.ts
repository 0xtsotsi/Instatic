/**
 * Approximate pixel-width metering for SEO title / description fields.
 *
 * Google truncates result snippets by rendered pixel width, not character
 * count (~580px titles, ~990px descriptions on desktop). An exact
 * measurement would need the SERP font metrics; a per-character-class
 * width table gets within a few percent, which is plenty for an editor
 * meter with ok / amber / over zones.
 *
 * Pure module — usable from admin UI and tests without a DOM.
 */

export const TITLE_PIXEL_BUDGET = 580
export const DESCRIPTION_PIXEL_BUDGET = 990

/** Sensible character guides shown alongside the pixel meter. */
export const TITLE_CHAR_GUIDE = 60
export const DESCRIPTION_CHAR_GUIDE = 160

const NARROW = /[iljtf.,:;'!|()\[\]{} ]/
const WIDE = /[mwMW@%]/
const UPPER = /[A-Z0-9]/

/**
 * Approximate rendered width in pixels at the Google SERP's ~18px Arial
 * (titles) scale. Description text renders smaller, but the budgets above
 * are calibrated to the same per-class table, so one function serves both.
 */
export function approxPixelWidth(text: string): number {
  let width = 0
  for (const char of text) {
    if (NARROW.test(char)) width += 5
    else if (WIDE.test(char)) width += 15
    else if (UPPER.test(char)) width += 12
    else width += 9
  }
  return width
}

export type MeterZone = 'ok' | 'amber' | 'over'

/**
 * Zone for a measured width against a budget: green up to 85%, amber from
 * 85% to the budget, over beyond it.
 */
export function meterZone(pixelWidth: number, budget: number): MeterZone {
  if (pixelWidth > budget) return 'over'
  if (pixelWidth > budget * 0.85) return 'amber'
  return 'ok'
}
