/**
 * @core/seo — public barrel.
 *
 * The SEO engine: persisted schemas, the shared fallback resolver, JSON-LD
 * builders, robots.txt generation, AI-crawler lists, health indicators, and
 * length meters. Imported by the publisher, server handlers, and the admin
 * SEO workspace. Deep imports are gated by
 * `src/__tests__/architecture/no-core-barrel-deep-imports.test.ts`.
 */

export {
  SeoMetadataSchema,
  SiteSeoSettingsSchema,
  SeoOrganizationSchema,
  SeoRobotsSettingsSchema,
  SeoSitemapSettingsSchema,
  OgTypeSchema,
  XCardTypeSchema,
  parseSeoMetadata,
  parseSiteSeoSettings,
  type SeoMetadata,
  type SiteSeoSettings,
  type SeoOrganization,
  type SeoRobotsSettings,
  type SeoSitemapSettings,
  type OgType,
  type XCardType,
} from './schema'

export {
  resolveSeoMetadata,
  isSafeCanonicalUrl,
  absoluteUrl,
  type ResolveSeoInput,
  type ResolvedSeoMetadata,
} from './resolve'

export {
  buildJsonLdEntities,
  serializeJsonLd,
  type JsonLdContext,
  type JsonLdEntity,
} from './jsonLd'

export { AI_TRAINING_CRAWLERS, AI_ANSWER_CRAWLERS } from './aiCrawlers'

export { generateRobotsTxt, type GenerateRobotsTxtInput } from './robots'

export { computeSeoHealth, type SeoHealth, type TextHealth, type ImageHealth } from './health'

export {
  approxPixelWidth,
  meterZone,
  TITLE_PIXEL_BUDGET,
  DESCRIPTION_PIXEL_BUDGET,
  TITLE_CHAR_GUIDE,
  DESCRIPTION_CHAR_GUIDE,
  type MeterZone,
} from './lengthMeter'
