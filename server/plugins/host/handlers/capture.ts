/** Host handler for the plugin-facing headless URL capture pipeline. */
import type { CaptureOutput } from '@core/plugin-sdk/captureSchemas'
import type { ApiCallFor } from '../../protocol/apiCallSchema'
import type { DbClient } from '../../../db/client'
import { createPlaywrightFetcher } from '../../../ai/mcp/capture/core/playwrightFetcher'
import { createSafeFetcher } from '../../../ai/mcp/capture/core/safeFetcher'
import { runCapture, validateSelector } from '../../../ai/mcp/capture/runCapture'
import { replyApiOk } from '../apiReplies'
import { hostMatchesAllowlist } from '../network'
import type { HostPluginRecord } from '../types'

/** Build the asset fetcher once with the plugin manifest's host allowlist. */
export function createPluginCaptureAssetFetcher(allowedHosts: ReadonlyArray<string>) {
  return createSafeFetcher(undefined, undefined, {
    allowedHosts: [...allowedHosts],
    allowInsecure: true,
  })
}

export async function handleCaptureFromUrl(
  msg: ApiCallFor<'cms.capture.fromUrl'>,
  entry: HostPluginRecord,
  db: DbClient,
): Promise<void> {
  const [input] = msg.args
  const allowedHosts = entry.manifest.networkAllowedHosts ?? []
  const url = new URL(input.url)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Capture URL protocol is not allowed: ${url.protocol}`)
  }
  if (!hostMatchesAllowlist(url.hostname, allowedHosts)) {
    throw new Error(`Capture URL host is not in networkAllowedHosts: ${url.hostname}`)
  }

  const scope = input.scope ?? 'page'
  if (scope !== 'page' && !input.selector) {
    throw new Error(`scope=${scope} requires a selector`)
  }
  if (input.selector) {
    const validation = validateSelector(input.selector)
    if (!validation.ok) throw new Error(validation.error)
  }

  const fetcher = await createPlaywrightFetcher({ allowedHosts: [...allowedHosts] })
  const result: CaptureOutput = await runCapture(input, {
    fetcher,
    db,
    assetFetcher: createPluginCaptureAssetFetcher(allowedHosts),
    persist: async (localPath, bytes) => {
      await Bun.write(localPath, bytes)
    },
  })

  replyApiOk(msg.pluginId, msg.correlationId, result)
}
