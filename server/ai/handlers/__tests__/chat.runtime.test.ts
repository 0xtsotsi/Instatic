/**
 * Runtime selection smoke test.
 *
 * The chat handler picks between `legacy` and `gg-agent` based on the
 * `IN_STATIC_AI_RUNTIME` env var. The branching lives in
 * `resolveRuntimeKind`, exported from `server/ai/handlers/chat.ts` so
 * tests can exercise it without mutating process state.
 *
 * The plan's Phase 5 acceptance criterion #5: "the new runtime can be
 * enabled or rolled back with one server-side flag." This test pins
 * that contract.
 */

import { describe, expect, it } from 'bun:test'
import { resolveRuntimeKind } from '../chat'

describe('resolveRuntimeKind', () => {
  it('returns "legacy" when env is unset', () => {
    expect(resolveRuntimeKind(undefined)).toBe('legacy')
  })

  it('returns "legacy" for any value other than "gg-agent"', () => {
    expect(resolveRuntimeKind('')).toBe('legacy')
    expect(resolveRuntimeKind('LEGACY')).toBe('legacy')
    expect(resolveRuntimeKind('gg-agent ')).toBe('legacy')
    expect(resolveRuntimeKind('auto')).toBe('legacy')
  })

  it('returns "gg-agent" only for the exact token', () => {
    expect(resolveRuntimeKind('gg-agent')).toBe('gg-agent')
  })
})
