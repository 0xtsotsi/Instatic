import { describe, expect, it } from 'bun:test'
import { mcpToolsForCapabilities } from './registry'

const FULL: Parameters<typeof mcpToolsForCapabilities>[0] = [
  'ai.chat',
  'ai.tools.write',
  'content.manage',
  'site.read',
  'site.structure.edit',
  'data.custom.tables.read',
  'data.system.tables.read',
  'media.read',
]

describe('mcp registry', () => {
  it('only includes server-resolved tools (no browser-bridged)', () => {
    const tools = mcpToolsForCapabilities(FULL)
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.every((t) => t.execution === 'server')).toBe(true)
    expect(tools.some((t) => t.name === 'mutate_page_tree')).toBe(true)
    expect(tools.some((t) => t.name === 'read_page_tree')).toBe(true)
  })

  it('filters out mutating tools when ai.tools.write is absent', () => {
    const readOnly = FULL.filter((c) => c !== 'ai.tools.write')
    const tools = mcpToolsForCapabilities(readOnly)
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.some((t) => t.mutates)).toBe(false)
    expect(tools.some((t) => t.name === 'mutate_page_tree')).toBe(false)
  })

  it('returns nothing a bare ai.chat connector can mutate', () => {
    const tools = mcpToolsForCapabilities(['ai.chat'])
    expect(tools.every((t) => !t.mutates)).toBe(true)
  })
})
