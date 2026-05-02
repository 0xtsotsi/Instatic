import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/cms/db'
import {
  getPublishedRuntimeAsset,
  savePublishedRuntimeAssets,
} from '../../../server/cms/runtimeAssetRepository'

class RuntimeAssetFakeDb implements DbClient {
  rows: Record<string, unknown>[] = []

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<DbResult<Row>> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (normalized.startsWith('insert into published_runtime_assets')) {
      this.rows.push({
        id: params[0],
        page_version_id: params[1],
        asset_path: params[2],
        public_path: params[3],
        content_type: params[4],
        content_bytes: params[5],
      })
      return { rows: [], rowCount: 1 }
    }
    if (normalized.startsWith('select public_path, content_type, content_bytes')) {
      const row = this.rows.find((candidate) => candidate.public_path === params[0])
      return { rows: row ? [row as Row] : [], rowCount: row ? 1 : 0 }
    }
    throw new Error(`Unhandled SQL: ${sql}`)
  }
}

describe('published runtime asset repository', () => {
  it('stores and reads immutable runtime assets by public path', async () => {
    const db = new RuntimeAssetFakeDb()
    await savePublishedRuntimeAssets(db, 'version_1', [
      {
        path: 'entries/entry.js',
        publicPath: '/_pb/assets/version_1/entries/entry.js',
        content: 'console.log("ok")',
        bytes: new TextEncoder().encode('console.log("ok")'),
        contentType: 'text/javascript; charset=utf-8',
      },
    ])

    const asset = await getPublishedRuntimeAsset(db, '/_pb/assets/version_1/entries/entry.js')

    expect(asset).toMatchObject({
      publicPath: '/_pb/assets/version_1/entries/entry.js',
      contentType: 'text/javascript; charset=utf-8',
    })
    expect(new TextDecoder().decode(asset?.bytes)).toBe('console.log("ok")')
  })
})
