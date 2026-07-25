/**
 * Phase 5 render step.
 *
 * Synthesizes a static HTML preview from a scenario's `preSnapshot` and
 * writes it to disk so a human reviewer can open it in a browser, take
 * a screenshot, and grade the rubric. The harness produces:
 *  - desktop preview (1440px-class layout, single column)
 *  - mobile preview (390px-class layout, same markup)
 *
 * The preview is a baseline artifact — in mock mode the agent has not
 * actually mutated the document, so this is the pre-state only. A real
 * live-provider run would write post-mutation HTML to a sibling path
 * (not yet implemented; see ROLLOUT.md).
 *
 * Written to `<outDir>/{desktop,mobile}.html` and gitignored via
 * `.tmp/eval/`.
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
  // PNG capture is the human reviewer's job: open the HTML in a browser
  // and screenshot. The report references these paths so the reviewer
  // can render screenshots from the markdown report.
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
