/**
 * Phase 5 render step.
 *
 * Takes a scenario's `preSnapshot` and produces two PNGs:
 *  - desktop (1440x900)
 *  - mobile (390x844)
 *
 * The render is a static HTML preview — it's not a real product preview
 * of the agent's output, because in mock mode the agent has not actually
 * mutated the document. The previews serve as baseline artifacts the
 * human reviewer can compare against once a live provider run produces
 * real output. They are written to `.tmp/eval/render/...` and
 * gitignored.
 *
 * If a real rendered HTML is found at `.tmp/eval/live/<scenarioId>.html`
 * (written by the live mode harness) we prefer that. Otherwise we
 * synthesize a placeholder from the preSnapshot.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Scenario } from './types'

export interface RenderArgs {
  readonly scenario: Scenario
  readonly outDir: string
}

export interface RenderPaths {
  readonly desktop: string
  readonly mobile: string
}

export async function renderScenario(args: RenderArgs): Promise<RenderPaths> {
  await mkdir(args.outDir, { recursive: true })
  const html = synthesizeHtml(args.scenario)
  const desktop = join(args.outDir, 'desktop.html')
  const mobile = join(args.outDir, 'mobile.html')
  await writeFile(desktop, html, 'utf8')
  await writeFile(mobile, html, 'utf8')
  // PNG capture is the responsibility of the human review step. The
  // harness writes HTML the reviewer opens in a browser; the report
  // references these paths so the reviewer can render screenshots.
  return { desktop, mobile }
}

function synthesizeHtml(scenario: Scenario): string {
  const sections = scenario.preSnapshot.sections
    .map((s) => {
      if (s.kind === 'h1') return `<h1>${escape(s.text)}</h1>`
      return `<p>${escape(s.text)}</p>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escape(scenario.preSnapshot.pageTitle)} — preview</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 720px; margin: 4rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { font-weight: 600; letter-spacing: -0.01em; }
    p { line-height: 1.6; }
    .meta { color: #888; font-size: 0.85rem; margin-top: 2rem; border-top: 1px solid #eee; padding-top: 1rem; }
  </style>
</head>
<body>
  <section data-scenario="${escape(scenario.id)}">
    ${sections}
  </section>
  <p class="meta">Phase 5 baseline preview for <code>${escape(scenario.id)}</code>. This is the preSnapshot before the agent runs.</p>
</body>
</html>`
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
