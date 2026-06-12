import { describe, expect, test } from 'bun:test'
import { computeSeoHealth } from '../health'
import { resolveSeoMetadata } from '../resolve'
import { approxPixelWidth, meterZone, TITLE_PIXEL_BUDGET } from '../lengthMeter'

const BASE = { siteName: 'Acme', routeKind: 'page' as const, routePath: '/about' }

describe('computeSeoHealth', () => {
  test('healthy target has zero issues', () => {
    const target = {
      title: 'Nice short title',
      description: 'A reasonable description for the page.',
      ogImage: '/img.png',
      ogImageAlt: 'An image',
    }
    const health = computeSeoHealth(target, resolveSeoMetadata({ ...BASE, target }))
    expect(health).toEqual({
      title: 'ok',
      description: 'ok',
      image: 'ok',
      indexable: true,
      issueCount: 0,
    })
  })

  test('flags missing description, image, alt, and noindex', () => {
    const target = { title: 'T', noindex: true, ogImage: '/img.png' }
    const health = computeSeoHealth(target, resolveSeoMetadata({ ...BASE, target }))
    expect(health.description).toBe('missing')
    expect(health.image).toBe('missingAlt')
    expect(health.indexable).toBe(false)
    expect(health.issueCount).toBe(3)
  })

  test('flags over-budget title as long', () => {
    const longTitle = 'Wide MMMM Words '.repeat(8)
    expect(meterZone(approxPixelWidth(longTitle), TITLE_PIXEL_BUDGET)).toBe('over')
    const target = { title: longTitle }
    const health = computeSeoHealth(target, resolveSeoMetadata({ ...BASE, target }))
    expect(health.title).toBe('long')
  })
})
