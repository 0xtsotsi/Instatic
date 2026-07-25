# Phase 5 Rollout Decision

**Status: `legacy` remains the default. Do not flip.**

## Why we are not flipping the default

The plan's acceptance criteria for enabling `gg-agent` by default are:

> Enable GG by default only when it has no contract regressions, no
> capability bypasses, and materially improves design quality without
> unacceptable latency/cost.

This branch produces the mock-mode evaluation harness, the five fixed
scenarios, and the smoke tests. The mock-mode report is **insufficient**
to clear the visual-quality half of that gate:

- The mock driver (`palsu`) returns canned text. It cannot demonstrate
  the "clear reduction in generic layouts" the plan calls for.
- The legacy path cannot be exercised in mock mode without a full
  `AiProvider` mock; we record it as a stub in the report for that
  reason.
- Capability gates and accounting are smoke-tested but not stress-tested
  with real tool chains.

A live-provider run is required before any default flip. That run is
intentionally not part of this PR because:

1. The provider key must live in `process.env` only, not in chat or
   commit history.
2. The reviewer (human) must grade the rendered previews, not the
   harness.
3. The legacy path needs a non-mock `AiProvider` in the live harness
   (the legacy `runChat` consumes a real driver from `server/ai/drivers/*`).

## How to clear the gate

1. Export the key in your shell:
   ```bash
   export IN_STATIC_AI_PROVIDER_KEY=...
   ```
   (Replace with the actual env var the credentials store expects. See
   `server/ai/credentials/`.)

2. Run the eval with the live flag:
   ```bash
   IN_STATIC_AI_EVAL_LIVE=1 bun run eval:phase5
   ```

3. Open each scenario's rendered previews in `.tmp/eval/<id>/<runtime>/render/`
   and grade the rubric items 0/1/2. The report at `.tmp/eval/report.md`
   has the per-item stub scores; replace them with your numbers and
   commit the report.

4. Re-run `bun run smoke:runtime` against the live harness.

5. If and only if:
   - contract tests pass
   - no capability bypass appears
   - visual review shows clear quality win
   - cost + latency are within budget
   then flip the default in `resolveRuntimeKind` and update the JSDoc.

## What this PR does deliver

- 5 fixed evaluation scenarios under `server/ai/eval/fixtures/`
- A mock-mode harness (`server/ai/eval/harness.ts`) that runs gg-agent
  end-to-end through `palsu` and writes a per-(scenario, runtime) report
- A render step (`server/ai/eval/render.ts`) that produces HTML previews
  for the human reviewer
- A scoring step (`server/ai/eval/score.ts`) that writes `report.md`
- A runner entry point (`server/ai/eval/index.ts`) and `bun run eval:phase5`
- Smoke tests for the runtime selection flag and the gg-agent trace
- `resolveRuntimeKind` exported from `server/ai/handlers/chat.ts` so
  unit tests can exercise the branch without `process.env` mutation

## What this PR does not do

- Flip the default runtime
- Touch AgentPanel, the Zustand store, conversation tables, or the
  credentials UI
- Load `.agents/skills` or `.gg/skills` automatically
- Add GGCoder `runPrintMode()`, daemon, launchd, or autonomous-job support
