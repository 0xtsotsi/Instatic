import '../../src/modules/base'
import { registry } from '../../src/core/module-engine/registry'
import { publishPage } from '../../src/core/publisher/render'
import type { PublishedPageSnapshot } from './publishRepository'

export function renderPublishedSnapshot(snapshot: PublishedPageSnapshot): string {
  const page = snapshot.project.pages.find((candidate) => candidate.id === snapshot.pageId)
  if (!page) throw new Error(`Published page "${snapshot.pageId}" not found in snapshot`)
  return publishPage(page, snapshot.project, registry).html
}
