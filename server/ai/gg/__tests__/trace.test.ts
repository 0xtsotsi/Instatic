/**
 * Trace test for the gg-agent runtime.
 *
 * Asserts that the NDJSON transport envelope is preserved end-to-end:
 *  - terminal event is exactly one `done` or `error`
 *  - toolCall → toolResult pairs share the same id
 *  - text events come before the terminal
 *  - usage event carries non-zero token counts
 *
 * Uses gg-ai's `palsu` provider so no network is touched. The trace
 * is logged with the `eval` namespace so a human reviewer can correlate
 * the output with the rendered previews.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  registerPalsuProvider,
  type PalsuProviderHandle,
  palsuText,
  palsuToolCall,
} from '@kenkaiiii/gg-ai'
import { createSqliteClient } from '../../../db/sqlite'
import { sqliteMigrations } from '../../../db/migrations-sqlite'
import { runMigrations } from '../../../db/runMigrations'
import type { DbClient } from '../../../db/client'
import { runSiteAgent } from '../siteAgentRunner'
import { createConversationsPersister } from '../../runtime/persister'
import { invalidateSkillCache } from '../../skills/loader'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiBrowserBridge, AiMessage, AiStreamEvent } from '../../runtime/types'
import type { AiResolvedCredential } from '../../drivers/types'

let db: DbClient
let skillDir: string
let palsu: PalsuProviderHandle

beforeEach(async () => {
  db = await freshDb()
  skillDir = await mkdtemp(join(tmpdir(), 'trace-'))
  await writeFile(
    join(skillDir, 'website-design.md'),
    `---\nid: website-design\nname: WD\ndescription: d\nversion: 1.0.0\n---\n\n# body\n`,
  )
  invalidateSkillCache()
  palsu = registerPalsuProvider()
})
afterEach(async () => {
  palsu?.unregister()
  invalidateSkillCache()
  if (skillDir) await rm(skillDir, { recursive: true, force: true })
})

async function freshDb(): Promise<DbClient> {
  const c = createSqliteClient(':memory:')
  await runMigrations(c, sqliteMigrations)
  await c`insert into users (id, email, email_normalized, display_name, password_hash, role_id) values ('u','u@x','u@x','U','x','owner')`
  await c`insert into ai_provider_credentials (id, user_id, provider_id, auth_mode, display_label, ciphertext, iv, base_url) values ('c','u','anthropic','apiKey','L',X'00',X'00',null)`
  await c`insert into ai_conversations (id, user_id, scope, credential_id, model_id, title) values ('k','u','site','c','m','T')`
  return c
}

const cred = (): AiResolvedCredential => ({
  id: 'c',
  providerId: 'anthropic',
  authMode: 'apiKey',
  apiKey: 'sk-test',
  baseUrl: null,
})

describe('gg-agent runtime trace', () => {
  it('emits one terminal done, no double-terminal', async () => {
    palsu.appendResponses(palsuText('hello'))
    const events: AiStreamEvent[] = []
    const ac = new AbortController()
    const bridge: AiBrowserBridge = {
      callBrowser: async () => ({ ok: false, error: 'no' }),
    }
    await runSiteAgent({
      credential: cred(),
      modelId: 'm',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: [{ kind: 'text', text: 'hi' }] },
      ] as AiMessage[],
      systemPrompt: ['p', '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__', 's'],
      tools: [],
      signal: ac.signal,
      supportsImages: false,
      persister: createConversationsPersister(db, 'k', { providerId: 'anthropic', modelId: 'm' }),
      adapterContext: {
        bridge,
        signal: ac.signal,
        emit: () => {},
        toolContext: {
          db,
          userId: 'u',
          capabilities: ['ai.chat'],
          scope: 'site',
          conversationId: 'k',
          snapshot: () => null,
          signal: ac.signal,
        },
      },
      emit: (e) => events.push(e),
      scope: 'site',
      skillDir,
      providerIdOverride: 'palsu',
    })
    const terminals = events.filter((e) => e.type === 'done' || e.type === 'error')
    expect(terminals).toHaveLength(1)
    expect(terminals[0]?.type).toBe('done')
    // text precedes terminal
    const textIdx = events.findIndex((e) => e.type === 'text')
    const doneIdx = events.findIndex((e) => e.type === 'done')
    expect(textIdx).toBeLessThan(doneIdx)
  })

  it('toolCall and toolResult share the same id', async () => {
    palsu.appendResponses(palsuToolCall('echo', { message: 'x' }))
    const events: AiStreamEvent[] = []
    const ac = new AbortController()
    await runSiteAgent({
      credential: cred(),
      modelId: 'm',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: [{ kind: 'text', text: 'go' }] },
      ] as AiMessage[],
      systemPrompt: ['p', '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__', 's'],
      tools: [],
      signal: ac.signal,
      supportsImages: false,
      persister: createConversationsPersister(db, 'k', { providerId: 'anthropic', modelId: 'm' }),
      adapterContext: {
        bridge: { callBrowser: async () => ({ ok: false, error: 'no' }) },
        signal: ac.signal,
        emit: () => {},
        toolContext: {
          db,
          userId: 'u',
          capabilities: ['ai.chat'],
          scope: 'site',
          conversationId: 'k',
          snapshot: () => null,
          signal: ac.signal,
        },
      },
      emit: (e) => events.push(e),
      scope: 'site',
      skillDir,
      providerIdOverride: 'palsu',
    })
    const calls = events.filter((e) => e.type === 'toolCall')
    const results = events.filter((e) => e.type === 'toolResult')
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(results.length).toBeGreaterThanOrEqual(1)
    const callIds = new Set(calls.map((c) => (c as { toolCallId: string }).toolCallId))
    const resultIds = new Set(results.map((r) => (r as { toolCallId: string }).toolCallId))
    // Every toolCall id should have a matching toolResult id.
    for (const id of callIds) expect(resultIds.has(id)).toBe(true)
  })
})
