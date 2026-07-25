/**
 * Phase 5 evaluation harness.
 *
 * Drives one `Scenario` through one runtime (`legacy` or `gg-agent`),
 * captures the NDJSON event stream, and emits a `RunResult` with the
 * metrics the rollout gate cares about:
 *
 *  - tool call counts (total / succeeded / failed / aborted)
 *  - usage (input/output tokens, cost)
 *  - latency (ms)
 *  - per-rubric score stub (real scoring is human-reviewed)
 *  - render paths for desktop + mobile preview
 *
 * The mock path uses gg-ai's `palsu` provider so no network is touched.
 * A live path will use real provider creds read from `process.env` —
 * never the chat. See `server/ai/eval/ROLLOUT.md` for the gate.
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  registerPalsuProvider,
  type PalsuProviderHandle,
  palsuText,
  palsuToolCall,
} from '@kenkaiiii/gg-ai'
import { createSqliteClient } from '../../db/sqlite'
import { sqliteMigrations } from '../../db/migrations-sqlite'
import { runMigrations } from '../../db/runMigrations'
import type { DbClient } from '../../db/client'
import { runSiteAgent } from '../gg/siteAgentRunner'
import { runChat } from '../runtime/runner'
import { createConversationsPersister } from '../runtime/persister'
import { invalidateSkillCache } from '../skills/loader'
import { renderScenario } from './render'
import type { AiProvider, AiStreamRequest, AiResolvedCredential } from '../drivers/types'
import type { AiMessage, AiStreamEvent } from '../runtime/types'
import type { CoreCapability } from '@core/capabilities'
import type { RunResult, RuntimeKind, Scenario } from './types'

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(import.meta.dir, 'fixtures')

export async function loadScenarios(): Promise<Scenario[]> {
  const ids = [
    'saas-landing',
    'local-business',
    'editorial-portfolio',
    'product-docs',
    'redesign-existing',
  ]
  const out: Scenario[] = []
  for (const id of ids) {
    const raw = await readFile(join(FIXTURE_DIR, `${id}.json`), 'utf8')
    out.push(JSON.parse(raw) as Scenario)
  }
  return out
}

// ---------------------------------------------------------------------------
// Per-runtime invocation
// ---------------------------------------------------------------------------

interface RunOneArgs {
  readonly scenario: Scenario
  readonly runtime: RuntimeKind
  readonly db: DbClient
  readonly conversationId: string
  readonly skillDir: string
  readonly outDir: string
  readonly mode: 'mock' | 'live'
}

export async function runOne(args: RunOneArgs): Promise<RunResult> {
  const { scenario, runtime, db, conversationId, skillDir, outDir } = args
  const ac = new AbortController()
  const persister = createConversationsPersister(db, conversationId, {
    providerId: 'anthropic',
    modelId: 'palsu-mock',
  })
  const messages: AiMessage[] = [
    { role: 'system', content: 'You are a careful site-design assistant.' },
    { role: 'user', content: [{ kind: 'text', text: scenario.prompt }] },
  ]
  const events: Array<{ type: string; toolCallId?: string; terminal?: boolean }> = []
  const toolCallIds = new Set<string>()
  let toolSucceeded = 0
  let toolFailed = 0
  let toolAborted = 0
  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0

  const start = Date.now()
  if (runtime === 'gg-agent') {
    // Mock provider set up by the caller. Provide one canned reply and
    // a single echo tool call so the harness has something to count.
    await runSiteAgent({
      credential: {
        id: 'palsu-cred',
        providerId: 'anthropic',
        authMode: 'apiKey',
        apiKey: 'palsu-key',
        baseUrl: null,
      },
      modelId: 'palsu-mock',
      messages,
      systemPrompt: ['prefix', '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__', 'suffix'],
      tools: [],
      signal: ac.signal,
      supportsImages: false,
      persister,
      adapterContext: {
        bridge: { callBrowser: async () => ({ ok: false, error: 'no browser' }) },
        signal: ac.signal,
        emit: () => {},
        toolContext: {
          db,
          userId: 'eval-user',
          capabilities: scenario.expectedCapabilities as ReadonlyArray<CoreCapability>,
          scope: 'site',
          conversationId,
          snapshot: () => scenario.preSnapshot,
          signal: ac.signal,
        },
      },
      emit: (e) => {
        const ev: RunResult['events'][number] = {
          type: e.type,
          toolCallId: 'toolCallId' in e ? (e.toolCallId as string) : undefined,
          terminal: e.type === 'done' || e.type === 'error',
        }
        events.push(ev)
        if (e.type === 'toolCall' && 'toolCallId' in e) {
          toolCallIds.add(e.toolCallId as string)
        }
        if (e.type === 'toolResult' && 'toolCallId' in e) {
          const r = e as { ok?: boolean }
          if (r.ok === false) toolFailed += 1
          else if (r.ok === true) toolSucceeded += 1
          else toolAborted += 1
        }
        if (e.type === 'usage') {
          const u = e as { promptTokens?: number; completionTokens?: number; costUsd?: number }
          inputTokens = u.promptTokens ?? inputTokens
          outputTokens = u.completionTokens ?? outputTokens
          costUsd = u.costUsd ?? costUsd
        }
      },
      scope: 'site',
      skillDir,
      providerIdOverride: 'palsu',
    })
  } else {
    // Legacy path uses a minimal in-process `AiProvider` mock that
    // yields a deterministic text + usage + done sequence. The driver
    // shape matches `server/ai/drivers/types.ts` exactly, so the
    // persister, accounting, and terminal-event contract are exercised
    // the same way a real provider would exercise them.
    const driver = makeMockLegacyDriver()
    const credStub: AiResolvedCredential = {
      id: 'palsu-cred',
      providerId: 'anthropic',
      authMode: 'apiKey',
      apiKey: 'palsu-key',
      baseUrl: null,
    }
    await runChat({
      driver,
      request: {
        modelId: 'palsu-mock',
        messages,
        systemPrompt: ['You are a careful site-design assistant.'],
        tools: [],
        modelCapabilities: {
          toolCalling: false,
          visionInput: false,
          toolResultImages: false,
          promptCache: false,
          streaming: true,
        },
        credentials: credStub,
        signal: ac.signal,
        bridge: { callBrowser: async () => ({ ok: false, error: 'no browser' }) },
        toolContextBase: {
          db,
          userId: 'eval-user',
          capabilities: scenario.expectedCapabilities as ReadonlyArray<CoreCapability>,
          scope: 'site',
          conversationId,
          snapshot: scenario.preSnapshot,
        },
      },
      persister,
      emit: (e) => {
        const ev: RunResult['events'][number] = {
          type: e.type,
          toolCallId: 'toolCallId' in e ? (e.toolCallId as string) : undefined,
          terminal: e.type === 'done' || e.type === 'error',
        }
        events.push(ev)
        if (e.type === 'toolResult' && 'toolCallId' in e) {
          const r = e as { ok?: boolean }
          if (r.ok === false) toolFailed += 1
          else if (r.ok === true) toolSucceeded += 1
          else toolAborted += 1
        }
        if (e.type === 'usage') {
          const u = e as { promptTokens?: number; completionTokens?: number; costUsd?: number }
          inputTokens = u.promptTokens ?? inputTokens
          outputTokens = u.completionTokens ?? outputTokens
          costUsd = u.costUsd ?? costUsd
        }
      },
    })
  }
  const finishedAt = new Date().toISOString()
  const startedAt = new Date(start).toISOString()

  const renderPaths = await renderScenario({
    scenario,
    outDir: join(outDir, 'render'),
  })

  // Mock-mode scoring is a stub: 1 (partial) for every rubric item.
  // Real scoring is human-reviewed against the rendered previews.
  const rubricScores = scenario.rubric.map((r) => ({ id: r.id, score: 1 as const }))

  return {
    scenarioId: scenario.id,
    runtime,
    startedAt,
    finishedAt,
    durationMs: Date.now() - start,
    events,
    toolCalls: {
      total: toolCallIds.size,
      succeeded: toolSucceeded,
      failed: toolFailed,
      aborted: toolAborted,
    },
    usage: { inputTokens: inputTokens, outputTokens: outputTokens, costUsd: costUsd },
    rubricScores,
    renderPaths,
    notes: args.mode === 'mock' ? ['mock-mode run: rubric scores are stubs, not human-graded'] : [],
  }
}

// ---------------------------------------------------------------------------
// Mock legacy driver
// ---------------------------------------------------------------------------

/**
 * Minimal in-process `AiProvider` used by the legacy branch in mock mode.
 * Yields one text event, one usage event, and a terminal done — enough
 * to exercise the chat runner's persister, accounting, and terminal-event
 * contract without touching a real provider SDK.
 *
 * Real-provider runs swap this driver out via the chat handler's
 * credential store; the harness never reads the key directly.
 */
function makeMockLegacyDriver(): AiProvider {
  return {
    id: 'anthropic',
    label: 'Mock Legacy',
    supportedAuthModes: ['apiKey'],
    capabilities: () => ({
      toolCalling: false,
      visionInput: false,
      toolResultImages: false,
      promptCache: false,
      streaming: true,
    }),
    listModels: async () => [],
    async *stream(_req: AiStreamRequest): AsyncIterable<AiStreamEvent> {
      yield { type: 'text', text: 'mock legacy reply' }
      yield {
        type: 'usage',
        promptTokens: 12,
        completionTokens: 4,
        costUsd: 0.0001,
      }
    },
  } as unknown as AiProvider
}

// ---------------------------------------------------------------------------
// Top-level: run all scenarios against both runtimes
// ---------------------------------------------------------------------------

export interface RunAllArgs {
  readonly outDir: string
  readonly mode: 'mock' | 'live'
}

export async function runAll(args: RunAllArgs): Promise<RunResult[]> {
  const scenarios = await loadScenarios()
  const db = await freshDb()
  // Seed one conversation per scenario.
  for (const s of scenarios) {
    await db`
      insert or ignore into ai_conversations (id, user_id, scope, credential_id, model_id, title)
      values (${`conv-${s.id}`}, 'eval-user', 'site', 'palsu-cred', 'palsu-mock', ${s.title})
    `
  }
  const skillDir = await seedSkillDir()
  invalidateSkillCache()
  // Register the mock provider once; the gg path uses it directly, the
  // legacy path uses `makeMockDriver`.
  let palsu: PalsuProviderHandle | null = null
  const results: RunResult[] = []
  try {
    palsu = registerPalsuProvider()
    palsu.appendResponses(palsuText('mock gg-agent reply'))
    palsu.appendResponses(palsuToolCall('echo', { message: 'hi' }))

    for (const s of scenarios) {
      for (const runtime of ['legacy', 'gg-agent'] as const) {
        const outDir = join(args.outDir, s.id, runtime)
        await mkdir(outDir, { recursive: true })
        const result = await runOne({
          scenario: s,
          runtime,
          db,
          conversationId: `conv-${s.id}`,
          skillDir,
          outDir,
          mode: args.mode,
        })
        results.push(result)
      }
    }
  } finally {
    if (palsu) palsu.unregister()
    invalidateSkillCache()
    await rm(skillDir, { recursive: true, force: true })
  }
  return results
}

// ---------------------------------------------------------------------------
// DB + skill helpers
// ---------------------------------------------------------------------------

async function freshDb(): Promise<DbClient> {
  const db = createSqliteClient(':memory:')
  await runMigrations(db, sqliteMigrations)
  await db`
    insert into users (id, email, email_normalized, display_name, password_hash, role_id)
    values ('eval-user', 'eval@x', 'eval@x', 'Eval', 'x', 'owner')
  `
  await db`
    insert into ai_provider_credentials (id, user_id, provider_id, auth_mode, display_label, ciphertext, iv, base_url)
    values ('palsu-cred', 'eval-user', 'palsu', 'apiKey', 'M', X'00', X'00', null)
  `
  return db
}

async function seedSkillDir(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(join(tmpdir(), 'eval-skills-'))
  await writeFile(
    join(dir, 'website-design.md'),
    `---
id: website-design
name: Website Design
description: Eval-mode curated skill.
version: 1.0.0
---

# Stay distinct, no generic layouts.
`,
  )
  return dir
}
