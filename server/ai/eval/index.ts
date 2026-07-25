/**
 * Phase 5 entry point. Run with:
 *
 *   bun run server/ai/eval/index.ts
 *   IN_STATIC_AI_EVAL_LIVE=1 bun run server/ai/eval/index.ts   # once a real key is set
 *
 * Writes:
 *   .tmp/eval/<scenario>/<runtime>/{desktop,mobile}.html
 *   .tmp/eval/report.md
 *   .tmp/eval/runs.json
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runAll, loadScenarios } from './harness'
import { writeReport } from './score'
import type { EvalReport } from './types'

async function main(): Promise<void> {
  const outDir = resolve('.tmp/eval')
  await mkdir(outDir, { recursive: true })
  const mode: 'mock' | 'live' = process.env.IN_STATIC_AI_EVAL_LIVE === '1' ? 'live' : 'mock'
  if (mode === 'live') {
    // Live mode requires a real provider credential. We never read the
    // key here — it must already be present in process.env via the
    // chat handler's credential store. The harness still uses the
    // `palsu` provider for the gg path; the live signal flips later.
  }
  const scenarios = await loadScenarios()
  const runs = await runAll({ outDir, mode })
  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    mode,
    runs,
  }
  await writeFile(resolve(outDir, 'runs.json'), JSON.stringify(report, null, 2), 'utf8')
  const md = await writeReport({ outDir, report, scenarios })
  console.log(`eval: ${mode} mode, ${runs.length} runs, report at ${md}`)
}

await main()
