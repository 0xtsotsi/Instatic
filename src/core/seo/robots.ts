/**
 * robots.txt generation — pure function from robots settings + context to
 * the served `text/plain` body. Used by the server endpoint
 * (`server/publish/seoEndpoints.ts`) and the admin Robots.txt tab's live
 * preview, so what the tab shows is byte-identical to what crawlers get.
 */

import { AI_ANSWER_CRAWLERS, AI_TRAINING_CRAWLERS } from './aiCrawlers'
import type { SeoRobotsSettings } from './schema'

export interface GenerateRobotsTxtInput {
  robots?: SeoRobotsSettings
  /** Whether sitemap generation is enabled (adds the `Sitemap:` line). */
  sitemapEnabled: boolean
  /** Absolute public origin for the Sitemap line; absent ⇒ line omitted. */
  origin?: string
}

export function generateRobotsTxt(input: GenerateRobotsTxtInput): string {
  const robots = input.robots ?? {}
  const lines: string[] = []

  if (robots.indexingEnabled === false) {
    lines.push('User-agent: *', 'Disallow: /')
  } else {
    lines.push('User-agent: *', 'Allow: /')

    const blockedBots: string[] = []
    if (robots.allowAiTrainingCrawlers === false) blockedBots.push(...AI_TRAINING_CRAWLERS)
    if (robots.allowAiAnswerCrawlers === false) blockedBots.push(...AI_ANSWER_CRAWLERS)
    for (const bot of blockedBots) {
      lines.push('', `User-agent: ${bot}`, 'Disallow: /')
    }
  }

  if (input.sitemapEnabled && input.origin) {
    lines.push('', `Sitemap: ${input.origin.replace(/\/+$/, '')}/sitemap.xml`)
  }

  return `${lines.join('\n')}\n`
}
