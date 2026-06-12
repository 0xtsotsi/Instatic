import { describe, expect, test } from 'bun:test'
import { generateRobotsTxt } from '../robots'
import { AI_ANSWER_CRAWLERS, AI_TRAINING_CRAWLERS } from '../aiCrawlers'

describe('generateRobotsTxt', () => {
  test('default output allows everything and links the sitemap', () => {
    const out = generateRobotsTxt({ sitemapEnabled: true, origin: 'https://acme.com' })
    expect(out).toBe('User-agent: *\nAllow: /\n\nSitemap: https://acme.com/sitemap.xml\n')
  })

  test('omits the sitemap line without an origin or when disabled', () => {
    expect(generateRobotsTxt({ sitemapEnabled: true })).not.toContain('Sitemap:')
    expect(generateRobotsTxt({ sitemapEnabled: false, origin: 'https://a.com' })).not.toContain(
      'Sitemap:',
    )
  })

  test('indexing disabled produces a global Disallow', () => {
    const out = generateRobotsTxt({
      robots: { indexingEnabled: false },
      sitemapEnabled: true,
      origin: 'https://acme.com',
    })
    expect(out).toContain('User-agent: *\nDisallow: /')
    expect(out).not.toContain('Allow: /')
  })

  test('blocking AI training crawlers emits one block per bot', () => {
    const out = generateRobotsTxt({
      robots: { allowAiTrainingCrawlers: false },
      sitemapEnabled: false,
    })
    for (const bot of AI_TRAINING_CRAWLERS) {
      expect(out).toContain(`User-agent: ${bot}\nDisallow: /`)
    }
    for (const bot of AI_ANSWER_CRAWLERS) {
      expect(out).not.toContain(`User-agent: ${bot}`)
    }
  })

  test('blocking AI answer crawlers emits one block per bot', () => {
    const out = generateRobotsTxt({
      robots: { allowAiAnswerCrawlers: false },
      sitemapEnabled: false,
    })
    for (const bot of AI_ANSWER_CRAWLERS) {
      expect(out).toContain(`User-agent: ${bot}\nDisallow: /`)
    }
    expect(out).toContain('User-agent: *\nAllow: /')
  })
})
