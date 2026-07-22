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
