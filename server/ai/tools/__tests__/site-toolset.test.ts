/**
 * Contract characterization tests for the site tool registry.
 *
 * Phase 0: pin the contracts any gg-agent adapter must honour.
 *  - read tools are server-side
 *  - write tools are mutating
 *  - write tools require `ai.tools.write` capability
 *  - canonical names are stable (the wire contract)
 *  - selectToolsForScope only exposes mutating tools to capable callers
 */

import { describe, expect, it } from 'bun:test'
import { siteTools } from '../site'
import { selectToolsForScope } from '../index'
import { toolAllowedForCapabilities } from '../capabilityGate'

describe('site tool registry', () => {
  it('contains the canonical site tool names', () => {
    const names = siteTools.map((t) => t.name)
    expect(names).toContain('site_insert_html')
    expect(names).toContain('site_read_document')
    expect(names).toContain('site_apply_css')
    expect(names).toContain('site_set_color_tokens')
    expect(names).toContain('site_set_type_scale')
    expect(names).toContain('site_set_spacing_scale')
    expect(names).toContain('site_set_font_tokens')
    expect(names).toContain('site_add_page')
    expect(names).toContain('site_write_code_asset')
  })

  it('exposes mutating tools with mutates: true', () => {
    const byName = new Map(siteTools.map((t) => [t.name, t]))
    expect(byName.get('site_insert_html')?.mutates).toBe(true)
    expect(byName.get('site_apply_css')?.mutates).toBe(true)
    expect(byName.get('site_set_color_tokens')?.mutates).toBe(true)
    expect(byName.get('site_add_page')?.mutates).toBe(true)
    expect(byName.get('site_write_code_asset')?.mutates).toBe(true)
  })

  it('exposes purely-read tools with mutates: false', () => {
    const byName = new Map(siteTools.map((t) => [t.name, t]))
    expect(byName.get('site_list_documents')?.mutates).toBeFalsy()
    expect(byName.get('site_list_modules')?.mutates).toBeFalsy()
    expect(byName.get('site_list_tokens')?.mutates).toBeFalsy()
    expect(byName.get('site_list_post_types')?.mutates).toBeFalsy()
    expect(byName.get('site_list_loop_sources')?.mutates).toBeFalsy()
  })

  it('declares an execution mode for every tool', () => {
    for (const tool of siteTools) {
      expect(['server', 'browser']).toContain(tool.execution)
    }
  })

  it('has a unique tool name for every entry', () => {
    const seen = new Set<string>()
    for (const tool of siteTools) {
      expect(seen.has(tool.name)).toBe(false)
      seen.add(tool.name)
    }
  })

  it('every tool has a non-empty description and a schema', () => {
    for (const tool of siteTools) {
      expect(tool.name.length).toBeGreaterThan(0)
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.inputSchema).toBeDefined()
    }
  })

  it('server-execution tools have a handler (browser tools may use the bridge)', () => {
    for (const tool of siteTools) {
      if (tool.execution === 'server') {
        expect(typeof tool.handler).toBe('function')
      }
    }
  })
})

describe('selectToolsForScope capability filter', () => {
  it('grants read tools to a caller with site.read, even without write', () => {
    const tools = selectToolsForScope('site', ['ai.chat', 'site.read'])
    expect(tools.map((t) => t.name)).toContain('site_list_documents')
    expect(tools.map((t) => t.name)).not.toContain('site_insert_html')
  })

  it('exposes mutating tools to a caller with ai.tools.write + site.structure.edit + site.style.edit', () => {
    const tools = selectToolsForScope('site', [
      'ai.chat',
      'ai.tools.write',
      'site.read',
      'site.structure.edit',
      'site.style.edit',
    ])
    expect(tools.map((t) => t.name)).toContain('site_insert_html')
    expect(tools.map((t) => t.name)).toContain('site_apply_css')
  })

  it('returns an empty toolset for scopes with no tools', () => {
    expect(selectToolsForScope('data', ['ai.chat'])).toEqual([])
    expect(selectToolsForScope('plugin', ['ai.chat', 'site.write'])).toEqual([])
  })

  it('toolAllowedForCapabilities denies a tool with requiredCapabilities when the caller lacks them', () => {
    const tools = siteTools.filter(
      (t) => t.requiredCapabilities && t.requiredCapabilities.length > 0,
    )
    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) {
      const allowed = toolAllowedForCapabilities(tool, ['ai.chat'])
      expect(allowed).toBe(false)
      const allowedFull = toolAllowedForCapabilities(tool, [
        'ai.chat',
        'ai.tools.write',
        ...(tool.requiredCapabilities ?? []),
      ])
      expect(allowedFull).toBe(true)
    }
  })
})
