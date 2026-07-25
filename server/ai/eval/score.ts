/**
 * Phase 5 score step.
 *
 * Reads a `RunResult[]` from the harness and writes a markdown report
 * to `outDir/report.md`. The report is what the human reviewer reads
 * to decide whether to flip the default runtime.
 *
 * The report shows:
 *  - per-(scenario, runtime) event count + tool breakdown
 *  - usage + cost
 *  - latency
 *  - rubric scores (mock-mode stubs)
 *  - path to rendered preview HTML
 *
 * The reviewer is expected to open each preview, grade the rubric
 * items 0/1/2, and commit a follow-up if the gg-agent path regresses.
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvalReport, Scenario } from './types'

export interface ScoreArgs {
  readonly outDir: string
  readonly report: EvalReport
  readonly scenarios: ReadonlyArray<Scenario>
}

export async function writeReport(args: ScoreArgs): Promise<string> {
  const { outDir, report, scenarios } = args
  const path = join(outDir, 'report.md')
  const lines: string[] = []
  lines.push(`# Phase 5 Evaluation Report`)
  lines.push('')
  lines.push(`- Generated: ${report.generatedAt}`)
  lines.push(`- Mode: **${report.mode}**`)
  if (report.mode === 'mock') {
    lines.push(
      `- This is a mock-mode report. Rubric scores are stubs (1 each). Real scoring is a human step after a live-provider run.`,
    )
  }
  lines.push('')
  for (const scenario of scenarios) {
    lines.push(`## ${scenario.title} (\`${scenario.id}\`)`)
    lines.push('')
    lines.push(`> ${scenario.description}`)
    lines.push('')
    const runs = report.runs.filter((r) => r.scenarioId === scenario.id)
    lines.push(
      `| runtime | duration | tools ok/fail/abort | tokens (in/out) | cost USD | events | rubric |`,
    )
    lines.push(`| --- | ---: | --- | --- | ---: | ---: | --- |`)
    for (const r of runs) {
      const ok = r.toolCalls.succeeded
      const fail = r.toolCalls.failed
      const ab = r.toolCalls.aborted
      const total = r.toolCalls.total
      const rubTotal = r.rubricScores.reduce((s, x) => s + x.score, 0)
      const rubMax = scenario.rubric.length * 2
      lines.push(
        `| ${r.runtime} | ${r.durationMs}ms | ${ok}/${fail}/${ab} (of ${total}) | ${r.usage.inputTokens}/${r.usage.outputTokens} | ${r.usage.costUsd.toFixed(6)} | ${r.events.length} | ${rubTotal}/${rubMax} |`,
      )
    }
    lines.push('')
    lines.push(`**Rendered previews:**`)
    for (const r of runs) {
      lines.push(
        `- ${r.runtime}: \`${r.renderPaths.desktop}\` (desktop), \`${r.renderPaths.mobile}\` (mobile)`,
      )
    }
    lines.push('')
    lines.push(`**Rubric:**`)
    for (const item of scenario.rubric) {
      const scores = runs
        .map((r) => `${r.runtime}=${r.rubricScores.find((s) => s.id === item.id)?.score ?? '?'}`)
        .join(', ')
      lines.push(`- \`${item.id}\` — ${item.label} _(${scores})_`)
    }
    if (runs[0]?.notes.length) {
      lines.push('')
      lines.push(`**Notes:** ${runs[0].notes.join('; ')}`)
    }
    lines.push('')
  }
  lines.push(`---`)
  lines.push('')
  lines.push(`## Rollout gate`)
  lines.push('')
  lines.push(
    `Per the plan: enable gg-agent by default only when there are no contract regressions, no capability bypasses, and a clear reduction in generic layouts without unacceptable latency/cost.`,
  )
  lines.push('')
  lines.push(
    `Mock mode cannot decide the visual-quality half. Re-run with a real provider credential to populate that side of the gate.`,
  )
  await writeFile(path, lines.join('\n'), 'utf8')
  return path
}
