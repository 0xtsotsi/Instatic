/**
 * SEO workspace API tests — /admin/api/cms/seo/*.
 *
 * Real isolated SQLite DB via the capability harness: migrations applied,
 * owner seeded through the real setup endpoints, requests dispatched through
 * handleCmsRequest. Covers the target index (pages incl. the seeded entry
 * template, post rows), target writes (incl. ownership gates), and site SEO
 * settings persistence.
 */
import { beforeAll, afterAll, describe, expect, it } from 'bun:test'
import {
  createCapabilityTestHarness,
  expectForbidden,
  readJson,
  type CapabilityTestHarness,
} from '../helpers/capabilityHarness'
import type { SeoMetadata, SiteSeoSettings } from '@core/seo'

interface SeoTarget {
  kind: 'page' | 'template' | 'post'
  id: string
  title: string
  route: string | null
  tableSlug?: string
  seo: SeoMetadata | null
  status: string
}

interface TargetsResponse {
  siteName: string
  publicOrigin: string | null
  siteSeo: SiteSeoSettings | null
  targets: SeoTarget[]
}

let h: CapabilityTestHarness
let owner: string

beforeAll(async () => {
  h = await createCapabilityTestHarness()
  owner = await h.setupOwner()
})

afterAll(async () => {
  await h.cleanup()
})

async function fetchTargets(cookie: string): Promise<TargetsResponse> {
  const res = await h.cms('/admin/api/cms/seo/targets', { cookie })
  expect(res.status).toBe(200)
  return readJson<TargetsResponse>(res)
}

describe('GET /admin/api/cms/seo/targets', () => {
  it('returns pages, entry templates, and post rows', async () => {
    // Creating a postType table through the data API seeds its default entry
    // template page — the migration-seeded `posts` table predates the boot
    // backfill in this isolated test DB.
    const createTableRes = await h.cms('/admin/api/cms/data/tables', {
      method: 'POST',
      cookie: owner,
      json: { name: 'Guides', kind: 'postType', routeBase: '/guides' },
    })
    expect([200, 201]).toContain(createTableRes.status)

    // Create one post row through the data API so the index has a 'post' target.
    const createRes = await h.cms('/admin/api/cms/data/tables/posts/rows', {
      method: 'POST',
      cookie: owner,
      json: { cells: { title: 'Hello world', slug: 'hello-world' } },
    })
    expect(createRes.status).toBe(201)

    const body = await fetchTargets(owner)
    expect(body.siteName.length).toBeGreaterThan(0)

    const kinds = new Set(body.targets.map((t) => t.kind))
    expect(kinds.has('page')).toBe(true)
    expect(kinds.has('template')).toBe(true)
    expect(kinds.has('post')).toBe(true)

    const post = body.targets.find((t) => t.kind === 'post' && t.title === 'Hello world')
    expect(post).toBeDefined()
    expect(post!.route).toBe('/posts/hello-world')

    const template = body.targets.find((t) => t.kind === 'template')
    expect(template!.route).toBeNull()
  })

  it('requires seo.read', async () => {
    const stranger = await h.createRoleUser({
      name: 'No SEO',
      slug: 'no-seo',
      capabilities: ['dashboard.read'],
    })
    await expectForbidden(await h.cms('/admin/api/cms/seo/targets', { cookie: stranger.cookie }))
  })
})

describe('PUT /admin/api/cms/seo/targets/:kind/:id', () => {
  it('writes the structured seo cell on a post row and round-trips', async () => {
    const before = await fetchTargets(owner)
    const post = before.targets.find((t) => t.kind === 'post')!

    const seo: SeoMetadata = {
      title: 'Custom SEO title',
      description: 'Custom description',
      ogImage: '/uploads/og.png',
      ogImageAlt: 'OG image',
      noindex: false,
    }
    const res = await h.cms(`/admin/api/cms/seo/targets/post/${post.id}`, {
      method: 'PUT',
      cookie: owner,
      json: { seo },
    })
    expect(res.status).toBe(200)
    const { target } = await readJson<{ target: SeoTarget }>(res)
    expect(target.seo?.title).toBe('Custom SEO title')

    const after = await fetchTargets(owner)
    expect(after.targets.find((t) => t.id === post.id)!.seo?.description).toBe('Custom description')
  })

  it('writes page targets through the page kind', async () => {
    const index = await fetchTargets(owner)
    const page = index.targets.find((t) => t.kind === 'page')!
    const res = await h.cms(`/admin/api/cms/seo/targets/page/${page.id}`, {
      method: 'PUT',
      cookie: owner,
      json: { seo: { title: 'Page SEO title' } },
    })
    expect(res.status).toBe(200)
    const after = await fetchTargets(owner)
    expect(after.targets.find((t) => t.id === page.id)!.seo?.title).toBe('Page SEO title')
  })

  it('rejects a kind that does not match the row', async () => {
    const index = await fetchTargets(owner)
    const page = index.targets.find((t) => t.kind === 'page')!
    const res = await h.cms(`/admin/api/cms/seo/targets/post/${page.id}`, {
      method: 'PUT',
      cookie: owner,
      json: { seo: { title: 'X' } },
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid payloads', async () => {
    const index = await fetchTargets(owner)
    const page = index.targets.find((t) => t.kind === 'page')!
    const res = await h.cms(`/admin/api/cms/seo/targets/page/${page.id}`, {
      method: 'PUT',
      cookie: owner,
      json: { seo: { ogType: 'banana' } },
    })
    expect(res.status).toBe(400)
  })

  it('enforces target ownership beyond seo.manage', async () => {
    // seo.manage but no pages.edit / content edit → 403 on both target kinds.
    const seoOnly = await h.createRoleUser({
      name: 'SEO only',
      slug: 'seo-only',
      capabilities: ['seo.read', 'seo.manage'],
    })
    const index = await fetchTargets(owner)
    const page = index.targets.find((t) => t.kind === 'page')!
    const post = index.targets.find((t) => t.kind === 'post')!

    await expectForbidden(await h.cms(`/admin/api/cms/seo/targets/page/${page.id}`, {
      method: 'PUT',
      cookie: seoOnly.cookie,
      json: { seo: { title: 'X' } },
    }))
    await expectForbidden(await h.cms(`/admin/api/cms/seo/targets/post/${post.id}`, {
      method: 'PUT',
      cookie: seoOnly.cookie,
      json: { seo: { title: 'X' } },
    }))
  })
})

describe('PUT /admin/api/cms/seo/site', () => {
  it('persists site SEO defaults incl. robots and sitemap settings', async () => {
    const seo: SiteSeoSettings = {
      titlePattern: '{page.title} — {site.name}',
      description: 'Site default description',
      defaultXCard: 'summary_large_image',
      xSiteHandle: '@acme',
      organization: { name: 'Acme Inc', logoUrl: '/uploads/logo.png' },
      robots: { allowAiTrainingCrawlers: false },
      sitemap: { enabled: true, excludedTargets: [] },
    }
    const res = await h.cms('/admin/api/cms/seo/site', {
      method: 'PUT',
      cookie: owner,
      json: { seo },
    })
    expect(res.status).toBe(200)

    const after = await fetchTargets(owner)
    expect(after.siteSeo?.titlePattern).toBe('{page.title} — {site.name}')
    expect(after.siteSeo?.robots?.allowAiTrainingCrawlers).toBe(false)
    expect(after.siteSeo?.organization?.name).toBe('Acme Inc')
  })

  it('requires seo.manage', async () => {
    const reader = await h.createRoleUser({
      name: 'SEO reader',
      slug: 'seo-reader',
      capabilities: ['seo.read'],
    })
    await expectForbidden(await h.cms('/admin/api/cms/seo/site', {
      method: 'PUT',
      cookie: reader.cookie,
      json: { seo: {} },
    }))
  })
})
