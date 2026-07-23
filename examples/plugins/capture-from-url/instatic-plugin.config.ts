import { definePlugin } from '@core/plugin-sdk'

export default definePlugin({
  id: 'instatic.capture-from-url',
  name: 'Capture from URL',
  version: '1.0.0',
  description: 'Capture a live URL and inspect the generated Instatic HTML, CSS, and next actions.',
  permissions: ['cms.routes', 'admin.navigation', 'editor.code', 'cms.capture'],
  networkAllowedHosts: ['example.com'],
  adminPages: [
    {
      id: 'capture',
      title: 'Capture',
      navLabel: 'Capture',
      route: '/capture',
      content: {
        kind: 'app',
        heading: 'Capture from URL',
        entry: './admin/workflow.js',
      },
    },
  ],
})
