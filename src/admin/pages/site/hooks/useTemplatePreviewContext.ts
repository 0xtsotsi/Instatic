import { useEffect, useMemo, useState } from 'react'
import type { Page } from '@core/page-tree'
import type { TemplateRenderDataContext } from '@core/templates/dynamicBindings'
import { dataTablePreviewToLoopItem } from '@core/templates/templatePreviewData'
import { getCmsDataTableBySlug } from '@core/persistence/cmsData'
import { buildPageFrame, buildRouteFrame, buildSiteFrame } from '@core/templates/contextFrames'
import { useEditorStore } from '@site/store/store'

/**
 * Build the canvas-side render context used by `resolveDynamicProps`.
 *
 * Always returns a populated context so bindings resolve live in the
 * editor without needing preview mode:
 *   - `page`, `site`, `route` — built from the in-memory site document
 *     and the currently active page. Match the values the publisher
 *     will compute at render time.
 *   - `entryStack` — populated only for template pages, with a single
 *     synthetic preview row from the table's schema. Loop iterations
 *     push/pop on top of this stack via `NodeRenderer`'s loop branch.
 */
export function useTemplatePreviewContext(page: Page | null): TemplateRenderDataContext | undefined {
  // Read site once; the page argument is already reactive via the caller.
  const site = useEditorStore((s) => s.site)

  // ── Template-page entry-stack seed (synthetic preview row) ───────────
  const template = page?.template
  const tableSlug = template?.enabled && template.context === 'entry'
    ? template.tableSlug
    : null
  const [previewState, setPreviewState] = useState<{
    tableSlug: string
    entryStack: TemplateRenderDataContext['entryStack']
  } | null>(null)

  useEffect(() => {
    if (!tableSlug) return
    let cancelled = false
    getCmsDataTableBySlug(tableSlug)
      .then((table) => {
        if (cancelled) return
        setPreviewState({
          tableSlug,
          entryStack: table ? [dataTablePreviewToLoopItem(table)] : [],
        })
      })
      .catch(() => {
        if (!cancelled) setPreviewState({ tableSlug, entryStack: [] })
      })
    return () => {
      cancelled = true
    }
  }, [tableSlug])

  // ── Compose the full context ─────────────────────────────────────────
  // The template entry stack is only valid for the currently-loaded
  // tableSlug; outside that, the stack stays empty so bindings against
  // currentEntry stay empty until the loop interceptor pushes a real
  // iteration on top.
  return useMemo<TemplateRenderDataContext | undefined>(() => {
    if (!page || !site) return undefined
    const entryStack: TemplateRenderDataContext['entryStack'] =
      tableSlug && previewState?.tableSlug === tableSlug ? previewState.entryStack : []
    const pageFrame = buildPageFrame(page)
    return {
      entryStack,
      page: pageFrame,
      site: buildSiteFrame(site),
      // Route frame mirrors what the published page will see. Editor
      // doesn't have the real request URL, so we derive from the page's
      // permalink — same shape, same fields.
      route: buildRouteFrame(pageFrame.permalink),
    }
  }, [page, site, tableSlug, previewState])
}
