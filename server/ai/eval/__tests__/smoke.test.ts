/**
 * Phase 5 smoke test.
 *
 * Runs the eval harness end-to-end in mock mode and asserts:
 *  - one run per (scenario, runtime) is produced
 *  - the gg-agent run produced a terminal `done` event
 *  - the report file was written
 *
 * This is the test `bun test` exercises in CI before any real-provider
 * run. If this fails, the harness regressed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runAll, loadScenarios } from '../harness'
import { writeReport } from '../score'
import type { EvalReport } from '../types'

let outDir: string

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'eval-smoke-'))
})

afterAll(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true })
})

describe('phase 5 eval harness (mock mode)', () => {
  it('produces one run per (scenario, runtime) with a terminal event', async () => {
    const scenarios = await loadScenarios()
    const runs = await runAll({ outDir, mode: 'mock' })
    expect(runs).toHaveLength(scenarios.length * 2)
    const ggRuns = runs.filter((r) => r.runtime === 'gg-agent')
    expect(ggRuns).toHaveLength(scenarios.length)
    for (const r of ggRuns) {
      const terminals = r.events.filter((e) => e.terminal)
      expect(terminals.length).toBeGreaterThanOrEqual(1)
      expect(terminals.at(-1)?.type).toBe('done')
    }
    const report: EvalReport = {
      generatedAt: new Date().toISOString(),
      mode: 'mock',
      runs,
    }
    const md = await writeReport({ outDir, report, scenarios })
    const s = await stat(md)
    expect(s.isFile()).toBe(true)
    const body = await readFile(md, 'utf8')
    expect(body).toContain('Phase 5 Evaluation Report')
    expect(body).toContain('saas-landing')
  }, 30_000)

  it('writes render HTML for every gg-agent scenario', async () => {
    const scenarios = await loadScenarios()
    for (const s of scenarios) {
      // In mock mode the legacy path is a stub (no AiProvider mock), so
      // we only assert on the gg-agent rendered previews here. The
      // legacy side is exercised in live mode.
      const desktop = resolve(outDir, s.id, 'gg-agent', 'render', 'desktop.html')
      const mobile = resolve(outDir, s.id, 'gg-agent', 'render', 'mobile.html')
      expect((await stat(desktop)).isFile()).toBe(true)
      expect((await stat(mobile)).isFile()).toBe(true)
    }
  }, 10_000)
})
