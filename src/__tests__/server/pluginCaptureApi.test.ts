import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { DbClient } from '../../../server/db/client'
import type { HostPluginRecord } from '../../../server/plugins/host/types'

const runCaptureMock = mock(async () => ({ ok: true, html: '<main>captured</main>' }))
const createPlaywrightFetcherMock = mock(async () => ({
  fetch: async () => { throw new Error('test fetcher should not run') },
  close: async () => {},
}))
const assetFetcher = { fetch: async () => ({ ok: false, error: 'not used' }) }
const createSafeFetcherMock = mock(() => assetFetcher)

mock.module('../../../server/ai/mcp/capture/runCapture', () => ({
  runCapture: runCaptureMock,
  validateSelector: () => ({ ok: true }),
}))
mock.module('../../../server/ai/mcp/capture/core/playwrightFetcher', () => ({
  createPlaywrightFetcher: createPlaywrightFetcherMock,
}))
mock.module('../../../server/ai/mcp/capture/core/safeFetcher', () => ({
  createSafeFetcher: createSafeFetcherMock,
}))

const { dispatchApiCall } = await import('../../../server/plugins/host/apiDispatch')
const { hostPlugins, setPluginWorkerDbClient } = await import('../../../server/plugins/host/registry')
const { workers } = await import('../../../server/plugins/host/workerState')
const { parseApiCall } = await import('../../../server/plugins/protocol/parser')

const PLUGIN_ID = 'acme.capture'

function hostEntry(grantedPermissions: string[], networkAllowedHosts: string[]): HostPluginRecord {
  return {
    manifest: {
      id: PLUGIN_ID,
      grantedPermissions,
      networkAllowedHosts,
    },
    routes: new Map(),
    hookListeners: [],
    hookFilters: [],
    loopSources: [],
    mediaAdapters: [],
    mediaUrlTransformers: [],
    inflightFetches: new Map(),
  } as HostPluginRecord
}

function captureCall(correlationId: string, url = 'https://capture.example/page') {
  return parseApiCall({
    kind: 'api-call',
    correlationId,
    pluginId: PLUGIN_ID,
    target: 'cms.capture.fromUrl',
    args: [{ url, scope: 'page', assetsMax: 5 }],
  })
}

describe('plugin cms.capture.fromUrl dispatch', () => {
  let postMessage: ReturnType<typeof mock>

  beforeEach(() => {
    hostPlugins.clear()
    workers.clear()
    runCaptureMock.mockClear()
    createPlaywrightFetcherMock.mockClear()
    createSafeFetcherMock.mockClear()
    setPluginWorkerDbClient({} as DbClient)
    postMessage = mock(() => {})
    workers.set(PLUGIN_ID, { postMessage } as unknown as Worker)
  })

  it('rejects dispatch when cms.capture was not granted', async () => {
    hostPlugins.set(PLUGIN_ID, hostEntry([], ['capture.example']))

    await dispatchApiCall(captureCall('denied'))

    expect(runCaptureMock).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith({
      kind: 'api-reply',
      correlationId: 'denied',
      ok: false,
      error: `Plugin "${PLUGIN_ID}" requires permission "cms.capture"`,
    })
  })

  it('invokes runCapture with the input and plugin host allowlist when granted', async () => {
    hostPlugins.set(PLUGIN_ID, hostEntry(['cms.capture'], ['capture.example', '*.cdn.example']))
    const call = captureCall('granted')

    await dispatchApiCall(call)

    expect(runCaptureMock).toHaveBeenCalledTimes(1)
    expect(createPlaywrightFetcherMock).toHaveBeenCalledWith({
      allowedHosts: ['capture.example', '*.cdn.example'],
    })
    const [input, deps] = runCaptureMock.mock.calls[0]!
    expect(input).toEqual(call.args[0])
    expect(deps).toMatchObject({ assetFetcher })
    expect(createSafeFetcherMock).toHaveBeenCalledWith(undefined, undefined, {
      allowedHosts: ['capture.example', '*.cdn.example'],
      allowInsecure: true,
    })
    expect(postMessage).toHaveBeenCalledWith({
      kind: 'api-reply',
      correlationId: 'granted',
      ok: true,
      value: { ok: true, html: '<main>captured</main>' },
    })
  })

  it('rejects a capture URL outside networkAllowedHosts', async () => {
    hostPlugins.set(PLUGIN_ID, hostEntry(['cms.capture'], ['allowed.example']))

    await dispatchApiCall(captureCall('blocked', 'https://blocked.example/page'))

    expect(runCaptureMock).not.toHaveBeenCalled()
    expect(createPlaywrightFetcherMock).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith({
      kind: 'api-reply',
      correlationId: 'blocked',
      ok: false,
      error: 'Capture URL host is not in networkAllowedHosts: blocked.example',
    })
  })
})
