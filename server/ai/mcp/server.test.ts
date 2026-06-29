import { describe, expect, it, beforeEach } from 'bun:test'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createSqliteClient } from '../../db/sqlite'
import { sqliteMigrations } from '../../db/migrations-sqlite'
import { runMigrations } from '../../db/runMigrations'
import type { DbClient } from '../../db/client'
import { buildMcpServer } from './server'

const PAGE_TREE = {
  rootNodeId: 'root',
  nodes: {
    root: { id: 'root', moduleId: 'base.body', props: {}, breakpointOverrides: {}, classIds: [], children: [] },
  },
}

async function freshDb(): Promise<DbClient> {
  const db = createSqliteClient(':memory:')
  await runMigrations(db, sqliteMigrations)
  await db`
    insert into users (id, email, email_normalized, display_name, password_hash, role_id)
    values ('u1', 'u1@example.com', 'u1@example.com', 'User One', 'x', 'owner')
  `
  const cells = JSON.stringify({ title: 'Home', slug: 'home', body: PAGE_TREE })
  await db`insert into data_rows (id, table_id, cells_json, slug, status)
           values ('page1', 'pages', ${cells}, 'home', 'draft')`
  return db
}

async function connectClient(db: DbClient, capabilities: Parameters<typeof buildMcpServer>[0]['capabilities']) {
  const server = buildMcpServer({ db, userId: 'u1', connectorId: 'c1', capabilities })
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await server.connect(serverT)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientT)
  return client
}

let db: DbClient
beforeEach(async () => { db = await freshDb() })

describe('mcp server', () => {
  it('lists only the tools the capabilities allow', async () => {
    const client = await connectClient(db, ['ai.chat', 'content.manage', 'site.read']) // no ai.tools.write
    const { tools } = await client.listTools()
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.some((t) => t.name === 'read_page_tree')).toBe(true)
    expect(tools.some((t) => t.name === 'mutate_page_tree')).toBe(false) // write gated out
    await client.close()
  })

  it('reads a page tree through a tool call', async () => {
    const client = await connectClient(db, ['ai.chat', 'site.read', 'content.manage'])
    const result = await client.callTool({ name: 'read_page_tree', arguments: { entryId: 'page1' } })
    expect(result.isError).toBeFalsy()
    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    expect(text).toContain('rootNodeId')
    await client.close()
  })

  it('mutates a page tree and persists when write caps are present', async () => {
    const client = await connectClient(db, ['ai.chat', 'ai.tools.write', 'site.structure.edit', 'content.manage'])
    const result = await client.callTool({
      name: 'mutate_page_tree',
      arguments: {
        entryId: 'page1',
        operations: [
          { kind: 'insertNode', parentId: 'root', index: 0,
            node: { id: 'n_new', moduleId: 'base.text', props: {}, breakpointOverrides: {}, classIds: [], children: [] } },
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    const { rows } = await db<{ cells_json: { body: unknown } }>`select cells_json from data_rows where id='page1'`
    expect(JSON.stringify(rows[0].cells_json)).toContain('n_new')
    await client.close()
  })

  it('returns a tool error (not a throw) when an entry is missing', async () => {
    const client = await connectClient(db, ['ai.chat', 'site.read', 'content.manage'])
    const result = await client.callTool({ name: 'read_page_tree', arguments: { entryId: 'nope' } })
    expect(result.isError).toBe(true)
    await client.close()
  })

  it('lists browser tools but errors with an open-editor hint when no editor is connected', async () => {
    const client = await connectClient(db, ['ai.chat', 'ai.tools.write', 'site.structure.edit', 'content.manage'])
    const { tools } = await client.listTools()
    expect(tools.some((t) => t.name === 'insertHtml')).toBe(true) // browser tool is listed

    const result = await client.callTool({ name: 'insertHtml', arguments: { html: '<p>hi</p>' } })
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    expect(text).toContain('Instatic editor')
    await client.close()
  })
})
