# Phase 5 Rollout Decision

**Status: `legacy` remains the default. Do not flip.**

## Why we are not flipping the default

The plan's acceptance criteria for enabling `gg-agent` by default are:

> Enable GG by default only when it has no contract regressions, no
> capability bypasses, and materially improves design quality without
> unacceptable latency/cost.

This branch produces the mock-mode evaluation harness, the five fixed
scenarios, and the smoke tests. In mock mode the harness runs **both**
runtimes via in-process mock drivers — the gg-agent path through gg-ai's
`palsu` provider, the legacy path through a minimal `AiProvider` shim
that yields one text + usage + done sequence. That gives a real
side-by-side comparison of events, latency, tokens, and cost, but the
mock drivers return canned content, so:

- The "clear reduction in generic layouts" half of the gate cannot be
  cleared without a real provider run.
- Capability gates and accounting are smoke-tested but not stress-tested
  with real tool chains.
- The `IN_STATIC_AI_EVAL_LIVE=1` flag currently only changes the report
  header from "mock" to "live" — the harness still uses mock drivers.
  Wiring a real provider into the harness is intentionally out of scope
  for this PR because the provider key must live in `process.env` only,
  not in chat or commit history, and the reviewer (human) must grade
  the rendered previews, not the harness.

A live-provider run is required before any default flip.

## How to clear the gate

1. Export the key in your shell:

   ```bash
   export IN_STATIC_AI_PROVIDER_KEY=...
   ```

   (Replace with the actual env var the credentials store expects. See
   `server/ai/credentials/`.)

2. Wire the harness's `runOne` to read the credential from the chat
   handler's credential store (not from `process.env` directly) and
   resolve a real `AiProvider` for the legacy path. The current mock
   driver at `harness.ts` `makeMockLegacyDriver()` is the seam.

3. Run the eval with the live flag:

   ```bash
   IN_STATIC_AI_EVAL_LIVE=1 bun run eval:phase5
   ```

4. Open each scenario's rendered previews in `.tmp/eval/<id>/<runtime>/render/`
   and grade the rubric items 0/1/2. The report at `.tmp/eval/report.md`
   has the per-item stub scores; replace them with your numbers and
   commit the report.

5. Re-run `bun run smoke:runtime` against the live harness.

6. If and only if:
   - contract tests pass
   - no capability bypass appears
   - visual review shows clear quality win
   - cost + latency are within budget
     then flip the default in `resolveRuntimeKind` and update the JSDoc.

## What this PR does deliver

- 5 fixed evaluation scenarios under `server/ai/eval/fixtures/`
- A mock-mode harness (`server/ai/eval/harness.ts`) that runs **both**
  the gg-agent runtime (via `palsu`) and the legacy runtime (via a
  minimal `AiProvider` shim) end-to-end and writes a per-(scenario,
  runtime) report
- A render step (`server/ai/eval/render.ts`) that produces HTML previews
  for the human reviewer
- A scoring step (`server/ai/eval/score.ts`) that writes `report.md`
- A runner entry point (`server/ai/eval/index.ts`) and `bun run eval:phase5`
- Smoke tests for the runtime selection flag, the gg-agent trace, and
  the harness end-to-end (both runtimes produce a terminal `done`)
- `resolveRuntimeKind` exported from `server/ai/handlers/chat.ts` so
  unit tests can exercise the branch without `process.env` mutation

## What this PR does not do

- Flip the default runtime
- Touch AgentPanel, the Zustand store, conversation tables, or the
  credentials UI
- Load `.agents/skills` or `.gg/skills` automatically
- Add GGCoder `runPrintMode()`, daemon, launchd, or autonomous-job support
