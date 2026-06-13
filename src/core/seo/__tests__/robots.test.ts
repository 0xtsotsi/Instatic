import { describe, expect, test } from 'bun:test'
import { generateRobotsTxt, SYSTEM_DISALLOW_PATHS } from '../robots'
import { AI_ANSWER_CRAWLERS, AI_TRAINING_CRAWLERS } from '../aiCrawlers'

describe('generateRobotsTxt', () => {
  test('default output allows everything, disallows system paths, links the sitemap', () => {
    const out = generateRobotsTxt({ sitemapEnabled: true, origin: 'https://acme.com' })
    expect(out).toBe(
      'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /_instatic/\n\n' +
        'Sitemap: https://acme.com/sitemap.xml\n',
    )
  })

  test('system-path defaults can be opted out', () => {
    const out = generateRobotsTxt({ robots: { disallowSystemPaths: false }, sitemapEnabled: false })
    expect(out).toBe('User-agent: *\nAllow: /\n')
    for (const path of SYSTEM_DISALLOW_PATHS) expect(out).not.toContain(`Disallow: ${path}`)
  })

  test('omits the sitemap line without an origin or when disabled', () => {
    expect(generateRobotsTxt({ sitemapEnabled: true })).not.toContain('Sitemap:')
    expect(generateRobotsTxt({ sitemapEnabled: false, origin: 'https://a.com' })).not.toContain('Sitemap:')
  })

  test('indexing disabled produces a global Disallow', () => {
    const out = generateRobotsTxt({
      robots: { indexingEnabled: false },
      sitemapEnabled: true,
      origin: 'https://acme.com',
    })
    expect(out).toContain('User-agent: *\nDisallow: /')
    expect(out).not.toContain('Allow: /')
    expect(out).not.toContain('Disallow: /admin') // blanket block, not the system list
  })

  test('blockAll serves a bare Disallow with no sitemap or extras', () => {
    const out = generateRobotsTxt({
      robots: { extraDirectives: 'Host: example.com', rules: [{ userAgent: 'Googlebot', disallow: ['/x'] }] },
      sitemapEnabled: true,
      origin: 'https://acme.com',
      blockAll: true,
    })
    expect(out).toBe('User-agent: *\nDisallow: /\n')
  })

  test('blocking AI training crawlers emits one block per bot', () => {
    const out = generateRobotsTxt({ robots: { allowAiTrainingCrawlers: false }, sitemapEnabled: false })
    for (const bot of AI_TRAINING_CRAWLERS) expect(out).toContain(`User-agent: ${bot}\nDisallow: /`)
    for (const bot of AI_ANSWER_CRAWLERS) expect(out).not.toContain(`User-agent: ${bot}`)
  })

  test('blocking AI answer crawlers emits one block per bot', () => {
    const out = generateRobotsTxt({ robots: { allowAiAnswerCrawlers: false }, sitemapEnabled: false })
    for (const bot of AI_ANSWER_CRAWLERS) expect(out).toContain(`User-agent: ${bot}\nDisallow: /`)
    expect(out).toContain('User-agent: *\nAllow: /')
  })

  test('custom rules render as their own user-agent groups', () => {
    const out = generateRobotsTxt({
      robots: {
        disallowSystemPaths: false,
        rules: [{ userAgent: 'Googlebot', allow: ['/public'], disallow: ['/private', '/tmp'] }],
      },
      sitemapEnabled: false,
    })
    expect(out).toContain('User-agent: Googlebot\nAllow: /public\nDisallow: /private\nDisallow: /tmp')
  })

  test('a custom `*` rule merges into the wildcard group (no duplicate header)', () => {
    const out = generateRobotsTxt({
      robots: { disallowSystemPaths: false, rules: [{ userAgent: '*', disallow: ['/search'] }] },
      sitemapEnabled: false,
    })
    expect(out).toBe('User-agent: *\nAllow: /\nDisallow: /search\n')
    expect(out.match(/User-agent: \*/g)?.length).toBe(1)
  })

  test('a custom rule for a toggled-off AI bot merges into one block', () => {
    const out = generateRobotsTxt({
      robots: {
        disallowSystemPaths: false,
        allowAiTrainingCrawlers: false,
        rules: [{ userAgent: 'GPTBot', disallow: ['/secret'] }],
      },
      sitemapEnabled: false,
    })
    expect(out.match(/User-agent: GPTBot/g)?.length).toBe(1)
    expect(out).toContain('User-agent: GPTBot\nDisallow: /\nDisallow: /secret')
  })

  test('extra directives append verbatim before the sitemap line', () => {
    const out = generateRobotsTxt({
      robots: { disallowSystemPaths: false, extraDirectives: 'Clean-param: ref /\nHost: acme.com' },
      sitemapEnabled: true,
      origin: 'https://acme.com',
    })
    expect(out).toBe(
      'User-agent: *\nAllow: /\n\nClean-param: ref /\nHost: acme.com\n\n' +
        'Sitemap: https://acme.com/sitemap.xml\n',
    )
  })
})
