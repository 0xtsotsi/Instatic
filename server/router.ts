import { handleAgentRequest } from './agentHandler'
import { handleCmsRequest } from './cms/handlers'
import type { DbClient } from './cms/db'
import { getPublishedPageBySlug } from './cms/publishRepository'
import { renderPublishedSnapshot } from './cms/publicRenderer'
import { jsonResponse } from './http'
import { serveAdminApp, serveStaticFile } from './static'

export interface ServerRuntime {
  db: DbClient
  staticDir?: string
}

function publicSlugFromPath(pathname: string): string {
  const trimmed = pathname.replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? 'index' : trimmed
}

export async function handleServerRequest(
  req: Request,
  runtime: ServerRuntime,
): Promise<Response> {
  const url = new URL(req.url)

  if (url.pathname === '/health') {
    return jsonResponse({ status: 'ok', ts: Date.now() })
  }

  if (url.pathname.startsWith('/api/cms/')) {
    return handleCmsRequest(req, runtime.db)
  }

  if (url.pathname === '/api/agent') {
    return handleAgentRequest(req)
  }

  if (runtime.staticDir && url.pathname.startsWith('/assets/')) {
    const asset = await serveStaticFile(runtime.staticDir, url.pathname)
    if (asset) return asset
  }

  if (
    runtime.staticDir &&
    (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))
  ) {
    const adminApp = await serveAdminApp(runtime.staticDir)
    if (adminApp) return adminApp
  }

  if (req.method === 'GET') {
    const snapshot = await getPublishedPageBySlug(runtime.db, publicSlugFromPath(url.pathname))
    if (snapshot) {
      return new Response(renderPublishedSnapshot(snapshot), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
  }

  return jsonResponse({ error: 'Not found' }, { status: 404 })
}
