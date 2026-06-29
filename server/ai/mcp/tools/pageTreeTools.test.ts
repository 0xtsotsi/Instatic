import { describe, expect, it } from 'bun:test'
import { pageTreeMcpTools } from './pageTreeTools'

describe('page-tree MCP tools', () => {
  it('exposes server-resolved read + mutate tools', () => {
    const names = pageTreeMcpTools.map((t) => t.name)
    expect(names).toContain('read_page_tree')
    expect(names).toContain('mutate_page_tree')
    expect(pageTreeMcpTools.every((t) => t.execution === 'server')).toBe(true)
    expect(pageTreeMcpTools.every((t) => typeof t.handler === 'function')).toBe(true)
  })

  it('marks mutate as a write tool gated on structural edit caps', () => {
    const mutate = pageTreeMcpTools.find((t) => t.name === 'mutate_page_tree')!
    expect(mutate.mutates).toBe(true)
    expect(mutate.requiredCapabilities).toContain('site.structure.edit')
  })

  it('read tool is not a write tool', () => {
    const read = pageTreeMcpTools.find((t) => t.name === 'read_page_tree')!
    expect(read.mutates).toBeFalsy()
    expect(read.requiredCapabilities).toContain('site.read')
  })
})
