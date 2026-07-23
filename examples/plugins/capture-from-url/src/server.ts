import type { CaptureInput, ServerPluginApi } from '@instatic/plugin-sdk'

export function activate(api: ServerPluginApi): void {
  api.cms.routes.post('/capture', 'site.read', async ({ body }) => {
    return api.cms.capture.fromUrl(body as CaptureInput)
  })
}
