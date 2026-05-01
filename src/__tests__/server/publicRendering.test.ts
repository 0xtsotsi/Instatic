import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/cms/db'
import type { PublishedPageSnapshot } from '../../../server/cms/publishRepository'
import { renderPublishedSnapshot } from '../../../server/cms/publicRenderer'
import { handleServerRequest } from '../../../server/router'

function snapshot(text: string): PublishedPageSnapshot {
  return {
    cmsSnapshotVersion: 1,
    pageId: 'page_home',
    project: {
      id: 'project_1',
      name: 'Public Site',
      projectMode: 'html',
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
  constructor(private readonly activeSnapshot: PublishedPageSnapshot | null) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
  ): Promise<DbResult<Row>> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
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

  it('serves / from the active published index snapshot', async () => {
    const res = await handleServerRequest(new Request('http://localhost/'), {
      db: new PublicFakeDb(snapshot('Homepage')),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('Homepage')
  })

  it('returns 404 when there is no active published snapshot', async () => {
    const res = await handleServerRequest(new Request('http://localhost/'), {
      db: new PublicFakeDb(null),
    })

    expect(res.status).toBe(404)
  })
})
