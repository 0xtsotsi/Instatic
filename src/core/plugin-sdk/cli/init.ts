/**
 * `pb-plugin init <name>` — scaffold a new plugin project.
 *
 * Creates a minimal but real plugin: one canvas module, a settings entry,
 * and a `pb-plugin.config.ts` that uses the SDK builders. The author can
 * `cd <name>` and run `pb-plugin dev` immediately.
 *
 * Convention: `<name>` becomes the plugin id `<vendor>.<short>`. We split
 * on the first `.` so `acme.confetti` → directory `confetti`, plugin id
 * stays as-given. A short name without a dot becomes
 * `local.<short>` to enforce the namespace requirement.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

interface InitTemplate {
  pluginId: string
  pluginName: string
  packageName: string
}

function pluginIdFromName(input: string): { pluginId: string; pluginName: string; dirName: string } {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Plugin name is required: `pb-plugin init <name>`')
  }
  const safeId = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!safeId) {
    throw new Error(`Cannot derive a plugin id from "${input}"`)
  }
  const pluginId = safeId.includes('.') ? safeId : `local.${safeId}`
  const dirName = pluginId.split('.').slice(1).join('-') || pluginId
  const pluginName = capitaliseWords(dirName)
  return { pluginId, pluginName, dirName }
}

function capitaliseWords(input: string): string {
  return input
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export async function runPluginInit(rawName: string, parentDir: string = process.cwd()): Promise<string> {
  const { pluginId, pluginName, dirName } = pluginIdFromName(rawName)
  const pluginDir = resolve(parentDir, dirName)

  if (existsSync(pluginDir)) {
    throw new Error(`Directory already exists: ${pluginDir}`)
  }

  await mkdir(join(pluginDir, 'modules'), { recursive: true })

  const template: InitTemplate = {
    pluginId,
    pluginName,
    packageName: dirName,
  }

  await writeFile(join(pluginDir, 'pb-plugin.config.ts'), pluginConfigTemplate(template), 'utf-8')
  await writeFile(join(pluginDir, 'modules', 'hello.ts'), helloModuleTemplate(template), 'utf-8')
  await writeFile(join(pluginDir, 'README.md'), readmeTemplate(template), 'utf-8')
  await writeFile(join(pluginDir, '.gitignore'), gitignoreTemplate(), 'utf-8')

  return pluginDir
}

function pluginConfigTemplate({ pluginId, pluginName }: InitTemplate): string {
  return `import { definePlugin, permissions } from '@core/plugin-sdk'
import hello from './modules/hello'

export default definePlugin({
  id: '${pluginId}',
  name: '${pluginName}',
  version: '0.1.0',
  description: 'A new ${pluginName} plugin.',
  permissions: [permissions.modulesRegister],
  modules: [hello],
  // Add settings, admin pages, hooks, frontend bundles, or a Visual Component
  // pack here as your plugin grows. See docs/features/plugin-system.md for the
  // full SDK surface.
})
`
}

function helloModuleTemplate({ pluginId }: InitTemplate): string {
  return `import { control, defineModule, html } from '@core/plugin-sdk'

export default defineModule({
  id: '${pluginId}.hello',
  name: 'Hello',
  description: 'Sample canvas module emitted by the scaffolded plugin.',
  category: '${capitaliseWordsFromId(pluginId)}',
  htmlTag: 'div',
  defaults: {
    message: 'Hello from your new plugin.',
  },
  schema: {
    message: control.text('Message'),
  },
  render: ({ props }) => ({
    html: html\`<div class="hello">\${props.message}</div>\`,
    css: \`.hello { padding: 12px; border: 1px dashed currentColor; border-radius: 6px; }\`,
  }),
})
`
}

function capitaliseWordsFromId(pluginId: string): string {
  const tail = pluginId.split('.').slice(1).join(' ')
  return capitaliseWords(tail)
}

function readmeTemplate({ pluginId, pluginName }: InitTemplate): string {
  return `# ${pluginName}

> Plugin id: \`${pluginId}\`

## Develop

\`\`\`bash
pb-plugin dev          # watch + sync into the running CMS
pb-plugin build        # produce a .plugin.zip
\`\`\`

The dev command writes built files directly into the host CMS's
\`uploads/plugins/${pluginId}/<version>/\` directory. On first run it
auto-detects the host's \`uploads/\` folder by walking up from the plugin
directory; pass \`--uploads <path>\` (or set \`PB_UPLOADS_DIR\`) when running
outside the page-builder monorepo.

You'll need to install the plugin once via the admin UI (\`/admin/plugins\` →
Upload Plugin) so the host registers it and approves permissions. After
that, every \`pb-plugin dev\` rebuild flows in without another upload.

See [docs/features/plugin-system.md](../page-builder/docs/features/plugin-system.md)
for the full plugin SDK surface.
`
}

function gitignoreTemplate(): string {
  return `node_modules
dist
*.plugin.zip
.DS_Store
`
}
