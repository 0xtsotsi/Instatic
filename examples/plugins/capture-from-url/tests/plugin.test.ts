import { describe, expect, it } from 'bun:test'
import { definePlugin } from '@core/plugin-sdk'
import { parsePluginManifest } from '@core/plugins/manifest'

describe('capture-from-url plugin manifest', () => {
  it('round-trips through the runtime manifest parser', () => {
    const plugin = definePlugin({
      id: 'instatic.capture-from-url',
      name: 'Capture from URL',
      version: '1.0.0',
      permissions: ['cms.routes', 'admin.navigation', 'editor.code', 'cms.capture'],
  networkAllowedHosts: ['example.com'],
      adminPages: [{
        id: 'capture',
        title: 'Capture',
        route: '/capture',
        content: { kind: 'app', heading: 'Capture from URL', entry: './admin/workflow.js' },
      }],
    })

    const parsed = parsePluginManifest(JSON.parse(JSON.stringify(plugin.manifest)))

    const reparsed = parsePluginManifest(JSON.parse(JSON.stringify(parsed)))

    expect(reparsed).toEqual(parsed)
    expect(parsed.id).toBe(plugin.manifest.id)
    expect(parsed.adminPages[0]?.content.kind).toBe('app')
    expect(parsed.permissions).toContain('cms.capture')
  })
})
