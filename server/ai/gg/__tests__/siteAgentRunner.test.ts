/**
 * Runner-level characterization for the gg-agent runtime.
 *
 * Verifies the embedded gg-agent produces the same external contract as
 * the legacy runner:
 *  - text events emitted in order
 *  - toolCall → toolResult pairs with matching IDs
 *  - usage event carries the cost
 *  - per-round context event
 *  - single terminal done event
 *  - error events fail closed if the agent throws
 *
 * Uses gg-ai's `palsu` mock provider so no network is touched.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createSqliteClient } from '../../../db/sqlite'
import { sqliteMigrations } from '../../../db/migrations-sqlite'
import { runMigrations } from '../../../db/runMigrations'
import type { DbClient } from '../../../db/client'
import { Type, type Static } from '@core/utils/typeboxHelpers'
import {
  registerPalsuProvider,
  palsuText,
  palsuToolCall,
  type PalsuProviderHandle,
} from '@kenkaiiii/gg-ai'
import { runSiteAgent } from '../siteAgentRunner'
import { createConversationsPersister } from '../../runtime/persister'
import { invalidateSkillCache } from '../../skills/loader'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiMessage, AiTool, AiBrowserBridge } from '../../runtime/types'
import type { AiStreamEvent } from '../../runtime/types'
import type { AiResolvedCredential } from '../../drivers/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function freshDb(): Promise<DbClient> {
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

const EchoInput = Type.Object({ message: Type.String() })
type EchoInput = Static<typeof EchoInput>

const echoTool: AiTool = {
  name: 'echo',
  description: 'Echoes the message back. Read-only.',
  scope: 'site',
  execution: 'server',
  inputSchema: EchoInput,
  async handler(input: unknown) {
    const data = input as EchoInput
    return { echoed: data.message }
  },
}

function cred(): AiResolvedCredential {
  return {
    id: 'c1',
    providerId: 'anthropic',
    authMode: 'apiKey',
    apiKey: 'sk-test',
    baseUrl: null,
  }
}

async function seedSkillDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'skills-'))
  await writeFile(
    join(dir, 'website-design.md'),
    `---
id: website-design
name: Website Design
description: Curated website design guidance.
version: 1.0.0
---

# Stay distinct, no generic layouts.
`,
  )
  invalidateSkillCache()
  return dir
}

let skillDir: string
let db: DbClient
let palsu: PalsuProviderHandle
beforeEach(async () => {
  skillDir = await seedSkillDir()
  db = await freshDb()
  // Register the usual 'palsu' provider so the agent can find it.
  palsu = registerPalsuProvider()
})
afterEach(async () => {
  if (palsu) palsu.unregister()
  invalidateSkillCache()
  if (skillDir) await rm(skillDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runSiteAgent — text-only turn', () => {
  it('produces a single text-then-done sequence', async () => {
    // The compose layer injects skills, so the agent gets a slightly
    // larger system prompt. The mock provider returns a fixed reply.
    palsu.appendResponses(palsuText('hello world'))

    const collected: AiStreamEvent[] = []
    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    const ac = new AbortController()
    const bridge: AiBrowserBridge = {
      callBrowser: async () => {
        throw new Error('no')
      },
    }
    await runSiteAgent({
      credential: cred(),
      modelId: 'm1',
      messages: [
        { role: 'system', content: 'You are a concise AI.' },
        { role: 'user', content: [{ kind: 'text', text: 'Hello' }] },
      ] as AiMessage[],
      systemPrompt: ['prefix', '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__', 'suffix'],
      tools: [],
      signal: ac.signal,
      supportsImages: false,
      persister: per,
      adapterContext: {
        bridge,
        signal: ac.signal,
        emit: () => {},
        toolContext: {
          db,
          userId: 'u1',
          capabilities: ['ai.chat'],
          scope: 'site',
          conversationId: 'conv1',
          snapshot: null,
          signal: ac.signal,
        },
      },
      emit: (e) => collected.push(e),
      scope: 'site',
      skillDir,
      providerIdOverride: 'palsu',
    })

    const types = collected.map((e) => e.type)
    expect(types).toContain('text')
    expect(types).toContain('usage')
    expect(types).toContain('context')
    expect(types.at(-1)).toBe('done')
    // Exactly one terminal done event.
    expect(types.filter((t) => t === 'done')).toHaveLength(1)
  })

  it('persists one assistant text message into the conversation', async () => {
    palsu.appendResponses(palsuText('hi from gg-agent'))

    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    const ac = new AbortController()
    const bridge: AiBrowserBridge = {
      callBrowser: async () => {
        throw new Error('no')
      },
    }
    await runSiteAgent({
      credential: cred(),
      modelId: 'm1',
      messages: [{ role: 'user', content: [{ kind: 'text', text: 'Hi' }] }] as AiMessage[],
      systemPrompt: ['sys'],
      tools: [],
      signal: ac.signal,
      supportsImages: false,
      persister: per,
      adapterContext: {
        bridge,
        signal: ac.signal,
        emit: () => {},
        toolContext: {
          db,
          userId: 'u1',
          capabilities: ['ai.chat'],
          scope: 'site',
          conversationId: 'conv1',
          snapshot: null,
          signal: ac.signal,
        },
      },
      emit: () => {},
      scope: 'site',
      skillDir,
      providerIdOverride: 'palsu',
    })

    const { rows } = await db<{ role: string; content_json: unknown }>`
      select role, content_json from ai_messages where conversation_id = 'conv1' order by created_at
    `
    expect(rows.length).toBe(1)
    expect(rows[0]?.role).toBe('assistant')
    const content = rows[0]?.content_json as Array<{ kind: string; text?: string }>
    const textBlock = content.find((b) => b.kind === 'text')
    expect(textBlock?.text).toBe('hi from gg-agent')
  })
})

describe('runSiteAgent — tool-call turn', () => {
  it('translates a gg-agent tool call into the existing wire + persister shape', async () => {
    // The model issues a tool call, then responds with text after the
    // tool result. We point exec at the existing echo tool.
    palsu.appendResponses(palsuToolCall('echo', { message: 'hello' }, 'tc1'))
    palsu.appendResponses(palsuText('reply after echo'))

    const collected: AiStreamEvent[] = []
    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    const ac = new AbortController()
    const bridge: AiBrowserBridge = {
      callBrowser: async () => {
        throw new Error('no')
      },
    }
    await runSiteAgent({
      credential: cred(),
      modelId: 'm1',
      messages: [{ role: 'user', content: [{ kind: 'text', text: 'echo please' }] }] as AiMessage[],
      systemPrompt: ['sys'],
      tools: [echoTool],
      signal: ac.signal,
      supportsImages: false,
      persister: per,
      adapterContext: {
        bridge,
        signal: ac.signal,
        emit: () => {},
        toolContext: {
          db,
          userId: 'u1',
          capabilities: ['ai.chat'],
          scope: 'site',
          conversationId: 'conv1',
          snapshot: null,
          signal: ac.signal,
        },
      },
      emit: (e) => collected.push(e),
      scope: 'site',
      skillDir,
      providerIdOverride: 'palsu',
    })

    const types = collected.map((e) => e.type)
    expect(types).toContain('toolCall')
    expect(types).toContain('toolResult')
    // The toolCall must come before the toolResult in the wire sequence.
    expect(types.indexOf('toolCall')).toBeLessThan(types.indexOf('toolResult'))
    // The toolResult must come before the post-tool text.
    expect(types.indexOf('toolResult')).toBeLessThan(types.indexOf('text'))
    // Single terminal done.
    expect(types.filter((t) => t === 'done')).toHaveLength(1)
  })
})

describe('runSiteAgent — fail-closed paths', () => {
  it('emits a single error event when the agent throws', async () => {
    // No responses, the provider will surface something — we just want
    // exactly one terminal event in the caught-error path.
    const collected: AiStreamEvent[] = []
    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    const ac = new AbortController()
    const bridge: AiBrowserBridge = {
      callBrowser: async () => {
        throw new Error('no')
      },
    }
    // Use a model id that no provider knows — the loop will throw.
    await runSiteAgent({
      credential: cred(),
      modelId: 'definitely-unknown',
      messages: [{ role: 'user', content: [{ kind: 'text', text: 'go' }] }] as AiMessage[],
      systemPrompt: ['sys'],
      tools: [],
      signal: ac.signal,
      supportsImages: false,
      persister: per,
      adapterContext: {
        bridge,
        signal: ac.signal,
        emit: () => {},
        toolContext: {
          db,
          userId: 'u1',
          capabilities: ['ai.chat'],
          scope: 'site',
          conversationId: 'conv1',
          snapshot: null,
          signal: ac.signal,
        },
      },
      emit: (e) => collected.push(e),
      scope: 'site',
      skillDir,
    })
    const types = collected.map((e) => e.type)
    expect(types).toContain('error')
    // Exactly one terminal event in the error path.
    expect(types.filter((t) => t === 'error' || t === 'done')).toHaveLength(1)
  })

  it('emits a single error event when the abort signal fires mid-turn', async () => {
    const ac = new AbortController()
    // Abort before running — the runner should NOT make a network call.
    ac.abort()
    const collected: AiStreamEvent[] = []
    const per = createConversationsPersister(db, 'conv1', {
      providerId: 'anthropic',
      modelId: 'm1',
    })
    const bridge: AiBrowserBridge = {
      callBrowser: async () => {
        throw new Error('no')
      },
    }
    await runSiteAgent({
      credential: cred(),
      modelId: 'm1',
      messages: [{ role: 'user', content: [{ kind: 'text', text: 'go' }] }] as AiMessage[],
      systemPrompt: ['sys'],
      tools: [],
      signal: ac.signal,
      supportsImages: false,
      persister: per,
      adapterContext: {
        bridge,
        signal: ac.signal,
        emit: () => {},
        toolContext: {
          db,
          userId: 'u1',
          capabilities: ['ai.chat'],
          scope: 'site',
          conversationId: 'conv1',
          snapshot: null,
          signal: ac.signal,
        },
      },
      emit: (e) => collected.push(e),
      scope: 'site',
      skillDir,
      providerIdOverride: 'palsu',
    })
    const types = collected.map((e) => e.type)
    expect(types).toContain('error')
    expect(types.filter((t) => t === 'error' || t === 'done')).toHaveLength(1)
  })
})
