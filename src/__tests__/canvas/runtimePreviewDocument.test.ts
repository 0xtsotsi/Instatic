import { describe, expect, it } from 'bun:test'
import { materializeRuntimePreviewDocument } from '../../editor/components/Canvas/runtimePreviewDocument'

describe('runtime preview document materialization', () => {
  it('rewrites preview asset paths to sandbox-safe data module URLs', () => {
    const result = materializeRuntimePreviewDocument({
      html:
        `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" ` +
        `content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'none';">` +
        `<script type="module" src="/_pb/preview/runtime/entries/entry.js"></script>`,
      assets: [{
        path: 'entries/entry.js',
        publicPath: '/_pb/preview/runtime/entries/entry.js',
        content: 'window.__preview = true',
        contentType: 'text/javascript; charset=utf-8',
      }],
    })

    expect(result.html).toContain('data:text/javascript; charset=utf-8,window.__preview%20%3D%20true')
    expect(result.html).not.toContain('src="blob:')
    expect(result.html).toContain("script-src 'self' data:")
    expect(result.html).toContain("worker-src 'self' blob: data:")
  })

  it('replaces an existing restrictive worker-src directive for sandbox previews', () => {
    const result = materializeRuntimePreviewDocument({
      html:
        `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" ` +
        `content="default-src 'self'; script-src 'self'; worker-src 'none';">`,
      assets: [],
    })

    expect(result.html).toContain("worker-src 'self' blob: data:")
    expect(result.html).not.toContain("worker-src 'none' blob:")
  })
})
