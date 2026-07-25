/**
 * Contract characterization tests for the legacy `runChat` runner.
 *
 * Phase 0 of the GG-agent plan. These tests pin the current NDJSON event
 * sequence, accounting behaviour, and abort semantics so the upcoming
 * `gg-agent` adapter cannot silently drift them.
 *
 * No production code changes here — only fixtures that exercise the
 * existing runner with fake `AiProvider` drivers and assert the
 * externally observable stream events + DB writes.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { createSqliteClient } from '../../../db/sqlite'
import { sqliteMigrations } from '../../../db/migrations-sqlite'
import { runMigrations } from '../../../db/runMigrations'
import type { DbClient } from '../../../db/client'
import { runChat } from '../runner'
import { createConversationsPersister } from '../persister'
import type { AiProvider, AiStreamRequest } from '../../drivers/types'
import type { AiStreamEvent } from '../types'
import { INTERRUPTED_TOOL_RESULT_ERROR } from '@core/ai'

type StreamEvent = Extract<AiStreamEvent, { type: string }>

async function resetDb(): Promise<DbClient> {
  const db = createSqliteClient(':memory:')
  await runMigrations(db, sqliteMigrations)
  await db`
    insert into users (id, email, email_normalized, display_name, password_hash, role_id)
    values ('u1', 'u1@x', 'u1@x', 'User', 'x', 'owner')
  `
  await db`
    insert into ai_provider_credentials (id, user_id, provider_id, auth_mode, display_label, ciphertext, iv, base_url)
    values ('c1', 'u1', 'anthropic', 'apiKey', 'L', X'00', X'00', null)
  `
  await db`
    insert into ai_conversations (id, user_id, scope, credential_id, model_id, title)
    values ('conv1', 'u1', 'site', 'c1', 'm1', 'T')
  `
  return db
}

function fakeProvider(events: StreamEvent[]): AiProvider {
  return {
    id: 'anthropic',
    label: 'fake',
    supportedAuthModes: ['apiKey'],
    listModels: async () => [],
    capabilities: () => ({
      toolCalling: true,
      streaming: true,
      visionInput: false,
      toolResultImages: false,
      promptCache: false,
    }),
    stream: () => {
      async function* gen() {
        for (const e of events) yield e
      }
      return gen()
    },
  }
}

function req(overrides: Partial<AiStreamRequest> = {}): AiStreamRequest {
  return {
    systemPrompt: ['sys'],
    messages: [],
    tools: [],
    modelId: 'm1',
    modelCapabilities: {
      toolCalling: true,
      streaming: true,
      visionInput: false,
      toolResultImages: false,
      promptCache: false,
    },
    credentials: {
      id: 'c1',
      providerId: 'anthropic',
      authMode: 'apiKey',
      apiKey: 'k',
      baseUrl: null,
    },
    signal: new AbortController().signal,
    bridge: {
      callBrowser: async () => {
        throw new Error('no bridge')
      },
    },
    toolContextBase: {
      db: undefined as never,
      userId: 'u1',
      capabilities: [],
      scope: 'site',
      conversationId: 'conv1',
      snapshot: null,
    },
    ...overrides,
  }
}

describe('runChat — contract characterization', () => {
  let db: DbClient
  beforeEach(async () => {
    db = await resetDb()
  })

  it('emits done after a clean text-only stream and persists an assistant text row', async () => {
    const collected: AiStreamEvent[] = []
    const driver = fakeProvider([
      { type: 'text', text: 'hello' },
      { type: 'text', text: ' there' },
      {
        type: 'usage',
        promptTokens: 10,
        completionTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ])
    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    await runChat({ driver, request: req(), persister: per, emit: (e) => collected.push(e) })
    expect(collected.map((e) => e.type)).toEqual(['text', 'text', 'usage', 'done'])
    const { rows } = await db<{ role: string; content_json: unknown }>`
      select role, content_json from ai_messages where conversation_id = 'conv1' order by created_at
    `
    expect(rows.length).toBe(1)
    expect(rows[0].role).toBe('assistant')
    const content = rows[0].content_json as Array<{ kind: string; text?: string }>
    const textBlock = content.find((b) => b.kind === 'text')
    expect(textBlock?.text).toBe('hello there')
  })

  it('emits done when the stream ends without an explicit done/error', async () => {
    const collected: AiStreamEvent[] = []
    const driver = fakeProvider([{ type: 'text', text: 'x' }])
    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    await runChat({ driver, request: req(), persister: per, emit: (e) => collected.push(e) })
    expect(collected.at(-1)?.type).toBe('done')
    expect(collected.map((e) => e.type)).not.toContain('error')
  })

  it('interrupts trailing tool calls when the driver emits an error event', async () => {
    const collected: AiStreamEvent[] = []
    const driver = fakeProvider([
      {
        type: 'toolCall',
        toolCallId: 't1',
        toolName: 'site_insert_html',
        input: {},
        status: 'pending',
      },
      { type: 'error', message: 'boom' },
    ])
    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    await runChat({ driver, request: req(), persister: per, emit: (e) => collected.push(e) })
    const terminated = collected.find((e) => e.type === 'toolResult') as
      Extract<AiStreamEvent, { type: 'toolResult' }> | undefined
    expect(terminated).toBeDefined()
    expect(terminated?.ok).toBe(false)
    expect(terminated?.error).toBe(INTERRUPTED_TOOL_RESULT_ERROR)
    expect(collected.find((e) => e.type === 'error')).toBeDefined()
    expect(collected.find((e) => e.type === 'done')).toBeUndefined()
  })

  it('propagates provider errors as wire error events and never emits a follow-up done', async () => {
    const collected: AiStreamEvent[] = []
    const throwing: AiProvider = {
      ...fakeProvider([]),
      stream: () => {
        throw new Error('network down')
      },
    }
    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    await runChat({
      driver: throwing,
      request: req(),
      persister: per,
      emit: (e) => collected.push(e),
    })
    const err = collected.find((e) => e.type === 'error') as
      Extract<AiStreamEvent, { type: 'error' }> | undefined
    expect(err).toBeDefined()
    expect(err?.message).toContain('network down')
    expect(collected.find((e) => e.type === 'done')).toBeUndefined()
  })

  it('records usage on the last assistant message and bumps conversation totals', async () => {
    const collected: AiStreamEvent[] = []
    const driver = fakeProvider([
      { type: 'text', text: 'hi' },
      {
        type: 'usage',
        promptTokens: 7,
        completionTokens: 3,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ])
    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    await runChat({ driver, request: req(), persister: per, emit: (e) => collected.push(e) })
    const usage = collected.find((e) => e.type === 'usage') as
      Extract<AiStreamEvent, { type: 'usage' }> | undefined
    expect(usage).toBeDefined()
    expect(usage?.costUsd).toBeGreaterThanOrEqual(0)
    const { rows } = await db`
      select prompt_tokens_total as p, completion_tokens_total as c, cost_usd_total as cost
      from ai_conversations where id = 'conv1'
    `
    expect(Number(rows[0].p)).toBe(7)
    expect(Number(rows[0].c)).toBe(3)
  })

  it('keeps pending tool calls in order: text → toolCall → toolResult → done', async () => {
    const collected: AiStreamEvent[] = []
    const driver = fakeProvider([
      { type: 'text', text: 'checking' },
      {
        type: 'toolCall',
        toolCallId: 'tc1',
        toolName: 'site_read_document',
        input: { part: 1 },
        status: 'pending',
      },
      { type: 'toolResult', toolCallId: 'tc1', toolName: 'site_read_document', ok: true },
      { type: 'text', text: 'done' },
      {
        type: 'usage',
        promptTokens: 1,
        completionTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ])
    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    await runChat({ driver, request: req(), persister: per, emit: (e) => collected.push(e) })
    const order = collected.map((e) => e.type)
    expect(order.indexOf('text')).toBeLessThan(order.indexOf('toolCall'))
    expect(order.indexOf('toolCall')).toBeLessThan(order.indexOf('toolResult'))
    expect(order.indexOf('toolResult')).toBeLessThan(order.indexOf('text', 1))
    expect(order.at(-1)).toBe('done')
  })
})

describe('createConversationsPersister — contract accounting', () => {
  let db: DbClient
  beforeEach(async () => {
    db = await resetDb()
  })

  it('propagates prompt/completion deltas onto the conversation row', async () => {
    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    await per.appendAssistantText('a')
    await per.recordUsage({
      promptTokens: 12,
      completionTokens: 4,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
    const { rows } =
      await db`select prompt_tokens_total as p, completion_tokens_total as c from ai_conversations where id = 'conv1'`
    expect(Number(rows[0].p)).toBe(12)
    expect(Number(rows[0].c)).toBe(4)
  })

  it('returns the resolved costUsd from recordUsage', async () => {
    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    await per.appendAssistantText('a')
    const cost = await per.recordUsage({
      promptTokens: 1,
      completionTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
    expect(typeof cost).toBe('number')
    expect(cost).toBeGreaterThanOrEqual(0)
  })
})
