/**
 * SEO health indicators — computed client-side from raw target values plus
 * the resolved metadata, so the target index, the preview editor, and
 * published output agree by construction (one resolver, one health rule set).
 */

import type { SeoMetadata } from './schema'
import type { ResolvedSeoMetadata } from './resolve'
import {
  approxPixelWidth,
  meterZone,
  TITLE_PIXEL_BUDGET,
  DESCRIPTION_PIXEL_BUDGET,
} from './lengthMeter'

export type TextHealth = 'ok' | 'missing' | 'long'
export type ImageHealth = 'ok' | 'missing' | 'missingAlt'

export interface SeoHealth {
  title: TextHealth
  description: TextHealth
  image: ImageHealth
  /** false when the target is set to noindex. */
  indexable: boolean
  /** Count of non-ok indicators, for index sorting / summary chips. */
  issueCount: number
}

export function computeSeoHealth(
  target: SeoMetadata | undefined,
  resolved: ResolvedSeoMetadata,
): SeoHealth {
  const title: TextHealth =
    resolved.title === ''
      ? 'missing'
      : meterZone(approxPixelWidth(resolved.title), TITLE_PIXEL_BUDGET) === 'over'
        ? 'long'
        : 'ok'

  const description: TextHealth =
    resolved.description === undefined || resolved.description === ''
      ? 'missing'
      : meterZone(approxPixelWidth(resolved.description), DESCRIPTION_PIXEL_BUDGET) === 'over'
        ? 'long'
        : 'ok'

  const image: ImageHealth = !resolved.ogImage
    ? 'missing'
    : !resolved.ogImageAlt
      ? 'missingAlt'
      : 'ok'

  const indexable = target?.noindex !== true

  const issueCount =
    (title === 'ok' ? 0 : 1) +
    (description === 'ok' ? 0 : 1) +
    (image === 'ok' ? 0 : 1) +
    (indexable ? 0 : 1)

  return { title, description, image, indexable, issueCount }
}
