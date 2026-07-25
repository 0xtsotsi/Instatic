# Embedded GG Website Agent — Phase 1 Plan

## Goal

Replace Instatic’s custom interactive site-agent model/tool loop with an adapter around `@kenkaiiii/gg-agent`, while preserving every existing product contract: AgentPanel behavior, conversation persistence, provider/model selection, NDJSON events, abort handling, audit/cost accounting, capability gates, editor bridge, and site mutation tools.

GGCoder `runPrintMode()` and daemon orchestration are explicitly out of scope for phase 1. They remain a future backend for autonomous jobs, not interactive editor turns.

## Architecture decision

Use an **in-process adapter**, not a rewrite:

```text
AgentPanel → existing /admin/api/ai/chat/site handler
           → existing auth/conversation/provider validation
           → GgSiteAgentAdapter (@kenkaiiii/gg-agent)
           → adapters around existing site tools/editor bridge
           → existing NDJSON transport + persistence + audit
```

The route remains the lifecycle owner. The GG adapter owns only model invocation and the iterative tool loop. Existing Instatic schemas remain the public contract.

## Phase 0 — Contract characterization

1. Add focused contract tests around `server/ai/handlers/chat.ts`, `server/ai/runtime/*`, and the site tool registry.
2. Record the exact current NDJSON event sequence for text, tool call, tool result, done, provider error, abort, and bridge timeout.
3. Characterize conversation token/cost updates and audit events so the adapter cannot silently change accounting.
4. Confirm which tools execute server-side and which require the browser editor bridge.

**Exit:** tests describe current externally observable behavior and pass before runtime changes.

## Phase 1 — Dependency and compatibility spike

1. Add `@kenkaiiii/gg-agent` pinned **exactly** to the version Noledge consumes at integration time, and re-verify on every dependency bump. The pin lives in `package.json`; any drift is a plan regression. Verify with:
   ```bash
   grep '@kenkaiiii/gg-agent' package.json
   bun pm ls @kenkaiiii/gg-agent
   ```
   Cross-check Noledge's `package.json` for the same string before bumping.
2. Inspect its installed declarations/source and create `server/ai/gg/types.ts` containing only the narrow interfaces Instatic consumes.
3. Build `server/ai/gg/modelAdapter.ts` to map Instatic credentials/model capabilities to the GG model/provider contract without moving secrets into prompts or client state.
4. Prove one text-only turn through a unit test; do not route production traffic through it yet.

**Exit:** a text-only GG agent run works with an Instatic-selected model and supports `AbortSignal`.

## Phase 2 — Site tool adapter

1. Add `server/ai/gg/siteToolAdapter.ts` to convert each existing site tool definition into a typed `AgentTool`.
2. Reuse current schemas, capability checks, content authorization, input limits, and editor-bridge dispatch; do not duplicate mutation logic.
3. Treat snapshots and tool output as untrusted data and frame them separately from system instructions, following Noledge’s `frameUntrustedToolResult` pattern.
4. Preserve tool-call IDs and map GG tool events back to existing Instatic runtime events.
5. Fail closed when a tool is unavailable, unauthorized, malformed, aborted, or disconnected from the browser bridge.

**Exit:** representative read, style, document mutation, publish, malformed-input, denied-capability, timeout, and abort tests pass.

## Phase 3 — Skill system

1. Create `server/ai/skills/types.ts`, `loader.ts`, and `catalog.ts`.
2. Store product-owned skills under a dedicated runtime directory such as `server/ai/skills/site/*.md`; do not load coding-agent `.agents/skills` implicitly.
3. Require frontmatter with stable `id`, `name`, `description`, `version`, and optional applicability tags. Enforce file-size/count limits, reject symlinks/path traversal, and cache validated content.
4. Start with one curated `website-design` skill covering discovery, hierarchy, responsive layout, accessibility, design tokens, non-generic visual direction, content realism, and preview-driven iteration.
5. Select skills server-side from an allowlisted catalog. Phase 1 defaults the site scope to `website-design`; no arbitrary user filesystem paths or prompt-selected skill loading.
6. Compose prompts in explicit layers: immutable safety/capability rules → site-agent operating rules → selected skills → validated editor snapshot summary → user conversation.

**Exit:** deterministic loader/composition tests cover valid skills, malformed metadata, oversized files, duplicate IDs, symlinks, and prompt-injection text inside snapshots/tool results.

## Phase 4 — Runtime integration behind a flag

1. Add `server/ai/gg/siteAgentRunner.ts` implementing the current runner/transport boundary.
2. Update `server/ai/handlers/chat.ts` to select `legacy` or `gg-agent` via a server-side environment/config flag, defaulting to `legacy` initially.
3. Translate GG events into existing `ServerStreamEventSchema`; do not change AgentPanel or `agentSlice` in this phase.
4. Keep the existing handler responsible for conversation locks, persistence, usage totals, pricing, audit records, cancellation, terminal events, and bridge teardown.
5. Guarantee exactly one terminal `done` or `error` event and cleanup in `finally`, including client disconnects.

**Exit:** both runtimes pass the same contract suite; no frontend changes are required to switch them.

## Phase 5 — Evaluation and rollout

1. Add a fixed evaluation set: SaaS landing page, local business, editorial portfolio, product documentation, and redesign of an existing page.
2. Score tool success, task completion, visual specificity, responsive structure, accessibility basics, unintended mutations, latency, tokens, and cost.
3. Run legacy and GG implementations against identical snapshots/prompts and manually inspect rendered desktop/mobile previews.
4. Enable GG by default only when it has no contract regressions, no capability bypasses, and materially improves design quality without unacceptable latency/cost.
5. Keep the legacy flag for one release; remove it only after production evidence and rollback confidence.

## Primary file changes

- `package.json`, `bun.lock` — exact GG dependency.
- `server/ai/handlers/chat.ts` — runtime selection and unchanged lifecycle ownership.
- `server/ai/gg/types.ts` — narrow framework boundary.
- `server/ai/gg/modelAdapter.ts` — provider/model mapping.
- `server/ai/gg/siteToolAdapter.ts` — existing-tool wrappers.
- `server/ai/gg/siteAgentRunner.ts` — Agent construction/event translation.
- `server/ai/skills/types.ts` — validated metadata.
- `server/ai/skills/loader.ts` — safe bounded loader/cache.
- `server/ai/skills/catalog.ts` — allowlisted selection.
- `server/ai/skills/site/website-design.md` — initial product skill.
- Existing runtime/handler test directories — shared contract, tool, skill, abort, accounting, and integration tests.

## Non-goals

- Replacing AgentPanel, Zustand state, conversation tables, credentials UI, or provider drivers wholesale.
- Loading `.agents/skills` or `.gg/skills` automatically.
- Giving the model shell/filesystem access.
- Running `@kenkaiiii/ggcoder` print mode inside an HTTP request.
- Adding launchd, command-bus, Lemma runtime-profile, or autonomous background-job support.
- Changing the browser-visible stream schema in phase 1.

## Risks and controls

- **Framework/version mismatch:** exact pin in `package.json`, narrow adapter, installed-source verification. Before each phase that touches the GG boundary, re-run the verification commands above and diff against Noledge.
- **Double tool loops:** GG adapter is the sole loop when selected; legacy driver loop is bypassed, not nested.
- **Capability bypass:** every adapted tool calls existing authorization and execution paths.
- **Prompt injection:** skills are trusted/allowlisted; snapshots and tool output are explicitly untrusted.
- **Event mismatch:** shared golden contract tests and exhaustive event translation.
- **Broken cancellation:** propagate one request signal through Agent, provider calls, tools, and editor bridge.
- **Accounting drift:** handler remains authoritative; tests compare usage/cost/audit behavior.
- **Generic output persists:** evaluation gates include rendered visual review, not prompt-only assertions.

## Verification commands

Run targeted tests during each phase, then the project gates before rollout:

```bash
bun run lint
bun run format:check
bunx tsc -b --noEmit
bun test
bun run bootstrap:check
bun run icons:check
```

## Acceptance criteria

1. Existing AgentPanel behavior and NDJSON schemas require no frontend migration.
2. Existing conversations, provider selection, usage/cost totals, and audits remain correct.
3. All site tools retain current validation, authorization, bridge, and abort behavior.
4. A curated website-design skill is safely loaded and appears in the composed agent instructions.
5. The new runtime can be enabled or rolled back with one server-side flag.
6. Contract, security, integration, and project quality checks pass.
7. Comparative rendered evaluations show a clear reduction in generic layouts with no increase in unintended mutations.

## Future phase

After the embedded runtime is stable, design a separate autonomous-job service using GGCoder `runPrintMode()` or a Lemma runtime profile. It should operate through constrained Instatic APIs/MCP, use explicit job approval and durable checkpoints, and never share the latency-sensitive interactive chat request lifecycle.
