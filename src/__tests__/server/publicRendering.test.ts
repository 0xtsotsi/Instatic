import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/cms/db'
import type { PublishedPageSnapshot } from '../../../server/cms/publishRepository'
import { renderPublishedSnapshot } from '../../../server/cms/publicRenderer'
import { handleServerRequest } from '../../../server/router'

function snapshot(text: string): PublishedPageSnapshot {
  return {
    cmsSnapshotVersion: 1,
    pageId: 'page_home',
    site: {
      id: 'project_1',
      name: 'Public Site',
      pages: [
        {
          id: 'page_home',
          title: 'Home',
          slug: 'index',
          rootNodeId: 'root',
          nodes: {
            root: {
              id: 'root',
              moduleId: 'base.root',
              props: {},
              breakpointOverrides: {},
              children: ['text_1'],
            },
            text_1: {
              id: 'text_1',
              moduleId: 'base.text',
              props: { text, tag: 'h1' },
              breakpointOverrides: {},
              children: [],
            },
          },
        },
      ],
      files: [],
      visualComponents: [],
      breakpoints: [
        { id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' },
      ],
      settings: {
        metaTitle: 'Public Site',
        colorTokens: {},
        typeScale: { baseSize: 16, ratio: 1.25 },
        shortcuts: {},
      },
      classes: {},
      createdAt: 1000,
      updatedAt: 2000,
    },
  }
}

class PublicFakeDb implements DbClient {
  constructor(
    private readonly activeSnapshot: PublishedPageSnapshot | null,
    private readonly runtimeAssets: Record<string, unknown>[] = [],
  ) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<DbResult<Row>> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (normalized.startsWith('select public_path, content_type, content_bytes')) {
      const row = this.runtimeAssets.find((asset) => asset.public_path === params[0])
      return { rows: row ? [row as Row] : [], rowCount: row ? 1 : 0 }
    }
    if (normalized.startsWith('select page_versions.snapshot_json')) {
      return {
        rows: this.activeSnapshot ? [{ snapshot_json: this.activeSnapshot } as Row] : [],
        rowCount: this.activeSnapshot ? 1 : 0,
      }
    }
    return { rows: [], rowCount: 0 }
  }
}

describe('public rendering', () => {
  it('renders complete HTML from a published snapshot', () => {
    const html = renderPublishedSnapshot(snapshot('Visible to public'))

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Visible to public')
    expect(html).toContain('<title>Public Site</title>')
  })

  it('injects stored runtime asset manifests when rendering a published snapshot', () => {
    const published = snapshot('Runtime page')
    published.runtimeAssets = {
      scripts: [
        {
          fileId: 'entry',
          src: '/_pb/assets/version_1/entries/entry.js',
          placement: 'body-end',
          timing: 'dom-ready',
          priority: 10,
        },
      ],
    }

    const html = renderPublishedSnapshot(published)

    expect(html).toContain("script-src 'self'")
    expect(html).toContain('/_pb/assets/version_1/entries/entry.js')
  })

  it('serves / from the active published index snapshot', async () => {
    const res = await handleServerRequest(new Request('http://localhost/'), {
      db: new PublicFakeDb(snapshot('Homepage')),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('Homepage')
  })

  it('serves immutable published runtime assets by public path', async () => {
    const res = await handleServerRequest(new Request('http://localhost/_pb/assets/version_1/entries/entry.js'), {
      db: new PublicFakeDb(null, [
        {
          public_path: '/_pb/assets/version_1/entries/entry.js',
          content_type: 'text/javascript; charset=utf-8',
          content_bytes: new TextEncoder().encode('console.log("runtime")'),
        },
      ]),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(await res.text()).toBe('console.log("runtime")')
  })

  it('returns 404 when there is no active published snapshot', async () => {
    const res = await handleServerRequest(new Request('http://localhost/'), {
      db: new PublicFakeDb(null),
    })

    expect(res.status).toBe(404)
  })
})
