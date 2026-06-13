/**
 * robots.txt generation — pure function from robots settings + context to
 * the served `text/plain` body. Used by the server endpoint
 * (`server/publish/seoEndpoints.ts`) and the admin Robots.txt tab's live
 * preview, so what the tab shows is byte-identical to what crawlers get.
 *
 * Composition model: every directive resolves into one user-agent group
 * (`User-agent: <ua>` + its Allow/Disallow lines). System-path defaults, the
 * AI-crawler toggles, and custom rules all merge into the same group when
 * they target the same agent, so the output never repeats a `User-agent:`
 * header. Order: the `*` group first, then the rest in first-seen order.
 * Raw `extraDirectives` append verbatim; the `Sitemap:` line is always last.
 */

import { AI_ANSWER_CRAWLERS, AI_TRAINING_CRAWLERS } from './aiCrawlers'
import type { SeoRobotsSettings } from './schema'

export interface GenerateRobotsTxtInput {
  robots?: SeoRobotsSettings
  /** Whether sitemap generation is enabled (adds the `Sitemap:` line). */
  sitemapEnabled: boolean
  /** Absolute public origin for the Sitemap line; absent ⇒ line omitted. */
  origin?: string
  /**
   * When true, serve a blanket `Disallow: /` regardless of settings —
   * used by the endpoint on a non-canonical host (preview/staging) so a
   * non-production deploy never gets indexed. Skips custom rules, AI
   * toggles, and extra directives, and omits the Sitemap line.
   */
  blockAll?: boolean
}

/**
 * Non-content routes disallowed by default under `User-agent: *`. `/admin`
 * also covers `/admin/api`; `/_instatic/` covers the lazy fragment + runtime
 * endpoints. Opt out with `disallowSystemPaths: false`.
 */
export const SYSTEM_DISALLOW_PATHS = ['/admin', '/_instatic/'] as const

interface Group {
  allow: string[]
  disallow: string[]
}

/** Append a path once (deduped) to a group's allow/disallow list. */
function addPath(list: string[], path: string): void {
  const trimmed = path.trim()
  if (trimmed !== '' && !list.includes(trimmed)) list.push(trimmed)
}

export function generateRobotsTxt(input: GenerateRobotsTxtInput): string {
  const robots = input.robots ?? {}

  if (input.blockAll || robots.indexingEnabled === false) {
    const lines = ['User-agent: *', 'Disallow: /']
    if (input.blockAll) return `${lines.join('\n')}\n`
    // A user-chosen global block still lists the sitemap + extras.
    return finalize(lines, input, /* allowExtras */ true)
  }

  // Ordered map of user-agent → group. The `*` group always exists and
  // renders first; everything else keeps first-seen order.
  const groups = new Map<string, Group>()
  const groupFor = (ua: string): Group => {
    const key = ua.trim()
    let group = groups.get(key)
    if (!group) {
      group = { allow: [], disallow: [] }
      groups.set(key, group)
    }
    return group
  }

  const star = groupFor('*')
  if (robots.disallowSystemPaths !== false) {
    for (const path of SYSTEM_DISALLOW_PATHS) addPath(star.disallow, path)
  }

  // AI-crawler toggles → blanket Disallow groups per bot.
  const blockedBots: string[] = []
  if (robots.allowAiTrainingCrawlers === false) blockedBots.push(...AI_TRAINING_CRAWLERS)
  if (robots.allowAiAnswerCrawlers === false) blockedBots.push(...AI_ANSWER_CRAWLERS)
  for (const bot of blockedBots) addPath(groupFor(bot).disallow, '/')

  // Custom rules merge into their target group.
  for (const rule of robots.rules ?? []) {
    if (rule.userAgent.trim() === '') continue
    const group = groupFor(rule.userAgent)
    for (const path of rule.allow ?? []) addPath(group.allow, path)
    for (const path of rule.disallow ?? []) addPath(group.disallow, path)
  }

  // Render: `*` first, then the rest in insertion order.
  const orderedKeys = ['*', ...[...groups.keys()].filter((key) => key !== '*')]
  const lines: string[] = []
  let first = true
  for (const ua of orderedKeys) {
    const group = groups.get(ua)!
    if (!first) lines.push('')
    first = false
    lines.push(`User-agent: ${ua}`)
    // The `*` group with no explicit allow means "index everything" — emit
    // an explicit `Allow: /` so the intent reads clearly. A bare disallow
    // group (a blocked bot) needs no Allow line.
    if (ua === '*' && group.allow.length === 0) lines.push('Allow: /')
    for (const path of group.allow) lines.push(`Allow: ${path}`)
    for (const path of group.disallow) lines.push(`Disallow: ${path}`)
  }

  return finalize(lines, input, /* allowExtras */ true)
}

/** Append the optional extra-directives block, then the Sitemap line. */
function finalize(lines: string[], input: GenerateRobotsTxtInput, allowExtras: boolean): string {
  const extra = allowExtras ? (input.robots?.extraDirectives ?? '').trim() : ''
  if (extra !== '') lines.push('', extra)
  if (input.sitemapEnabled && input.origin) {
    lines.push('', `Sitemap: ${input.origin.replace(/\/+$/, '')}/sitemap.xml`)
  }
  return `${lines.join('\n')}\n`
}
