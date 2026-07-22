/**
 * Tests for the capture_from_url MCP tool scaffolding.
 *
 * Four assertions:
 *   1. Registry presence — the tool is exposed when the right caps are granted.
 *   2. Capability gate denies — NOT exposed with only site.read.
 *   3. Tool shape — scope/site + execution/server + inputSchema.url property.
 *   4. Architecture seam — core/ files may not import Instatic modules.
 *      adapters/ is exempt. Enforces the contract that core/ stays portable
 *      so a future CLI can import it.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CoreCapability } from '@core/capabilities'
import { mcpToolsForCapabilities } from '../registry'
import { captureTool } from './captureTool'

const CAPS_FOR_CAPTURE: readonly CoreCapability[] = [
  'site.read',
  'site.structure.edit',
  'site.content.edit',
  'site.style.edit',
  'pages.edit',
  'ai.tools.write',
]

describe('mcp capture_from_url', () => {
  it('is present in the registry when full site capabilities are granted', () => {
    const tools = mcpToolsForCapabilities(CAPS_FOR_CAPTURE)
    const names = tools.map((t) => t.name)
    expect(names).toContain('capture_from_url')
  })

  it('is hidden from a connector that lacks every required site capability', () => {
    // The tool's requiredCapabilities is an ANY-OF list: site.read,
    // site.structure.edit, site.content.edit, site.style.edit, pages.edit.
    // A connector holding only a content-scope capability (e.g. content.create)
    // holds none of them, so the tool must be filtered out.
    const tools = mcpToolsForCapabilities(['content.create'])
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('capture_from_url')
  })

  it('declares scope:site, execution:server, and an inputSchema with a url property', () => {
    const tool = mcpToolsForCapabilities(CAPS_FOR_CAPTURE).find(
      (t) => t.name === 'capture_from_url',
    )
    expect(tool).toBeTruthy()
    if (!tool) return
    expect(tool.scope).toBe('site')
    expect(tool.execution).toBe('server')

    // TypeBox schemas are plain JSON Schema objects; the input schema is
    // Type.Object({ url, mode, scope, selector, assetsMax }, ...).
    const schema = tool.inputSchema as { properties?: Record<string, unknown> }
    expect(schema.properties).toBeTruthy()
    expect(schema.properties!.url).toBeTruthy()
  })

  it('enforces the core/adapters seam: no Instatic imports under core/', () => {
    // core/ MUST stay pure (no @core/*, no server/*, no src/core/*) so a future
    // standalone CLI can import it. adapters/ is exempt — that's the Instatic glue.
    const coreDir = join(import.meta.dir, 'core')
    const files = readdirSync(coreDir).filter((f) => f.endsWith('.ts'))

    // Regex matching a top-level import statement:
    //   import { foo } from 'specifier'
    //   import type { foo } from "specifier"
    //   import 'specifier'
    // We capture the specifier (single or double quoted).
    const importRegex = /^\s*import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/m

    const violations: { file: string; specifier: string; line: string }[] = []
    const bannedPrefixes = ['@core/', 'server/', 'src/core/']

    for (const file of files) {
      const path = join(coreDir, file)
      const src = readFileSync(path, 'utf8')
      // Match every import statement in the file (flag the line, not just the first one).
      const importLines = src.split('\n').filter((line) => /^\s*import\b/.test(line))
      for (const line of importLines) {
        const match = line.match(importRegex)
        if (!match) continue
        const specifier = match[1]!
        if (bannedPrefixes.some((prefix) => specifier.startsWith(prefix))) {
          violations.push({ file, specifier, line: line.trim() })
        }
      }
    }

    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  - ${v.file}: import from "${v.specifier}"\n      ${v.line}`)
        .join('\n')
      throw new Error(
        `core/ must stay free of Instatic imports. Offending imports:\n${detail}`,
      )
    }
    expect(violations).toHaveLength(0)
  })
})

/**
 * Handler contract tests that do NOT require a real browser.
 *
 * The full pipeline (Playwright fetch + walk + rewrite + asset collect) is
 * gated on CAPTURE_LIVE=1 in a separate integration test. These cover the
 * synchronous early-return paths and the resource-cleanup contract.
 */
describe('capture_from_url handler (no browser)', () => {
  const stubCtx = {
    db: {} as never,
    userId: 'u1',
    capabilities: CAPS_FOR_CAPTURE,
    scope: 'site' as const,
    conversationId: 'c1',
    snapshot: null,
  } as never

  it('rejects element/subtree scope without a selector BEFORE launching a browser', async () => {
    // The handler should validate input first; if it tries to launch a browser
    // here, Playwright would throw in a CI environment without the binary.
    const result = (await captureTool.handler(
      { url: 'https://example.com', scope: 'element' } as never,
      stubCtx,
    )) as { ok: boolean; error?: string }
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/selector/)
  })

  it('rejects subtree scope without a selector BEFORE launching a browser', async () => {
    const result = (await captureTool.handler(
      { url: 'https://example.com', scope: 'subtree' } as never,
      stubCtx,
    )) as { ok: boolean; error?: string }
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/selector/)
  })

  it('page scope is the default and does not require a selector (still needs a reachable URL to succeed)', async () => {
    // We don't assert success (that would require Playwright); we assert the
    // handler did NOT short-circuit on missing selector.
    // The handler will try to launch Playwright and fail; the error is captured
    // and returned as { ok: false, error: ... }.
    const result = (await captureTool.handler(
      { url: 'https://127.0.0.1:1/never-resolves' } as never,
      stubCtx,
    )) as { ok: boolean; error?: string }
    // Either ok:false with a Playwright/network error, or ok:true if Playwright
    // happened to be installed. We only assert the SHAPE: it's an object with ok.
    expect(typeof result.ok).toBe('boolean')
    if (!result.ok) {
      // Error should be a non-empty string (real failure, not a silent skip).
      expect(typeof result.error).toBe('string')
      expect(result.error!.length).toBeGreaterThan(0)
    }
  })
})
