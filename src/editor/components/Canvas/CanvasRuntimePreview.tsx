import { useEffect, useMemo, useState } from 'react'
import type { Page } from '../../../core/page-tree/types'
import type { TemplateRenderDataContext } from '../../../core/templates/dynamicBindings'
import { useEditorStore } from '../../../core/editor-store/store'
import { buildCmsRuntimePreview } from '../../../core/persistence/cmsRuntime'
import {
  collectRuntimeScripts,
  normalizeSiteRuntimeConfig,
  type SiteRuntimeDiagnostic,
} from '../../../core/site-runtime'
import { materializeRuntimePreviewDocument } from './runtimePreviewDocument'
import styles from './BreakpointFrame.module.css'

interface CanvasRuntimePreviewProps {
  page: Page
  breakpointId: string
  active: boolean
  templateContext?: TemplateRenderDataContext
}

export function CanvasRuntimePreview({
  page,
  breakpointId,
  active,
  templateContext,
}: CanvasRuntimePreviewProps) {
  const site = useEditorStore((s) => s.site)
  const [srcDoc, setSrcDoc] = useState('')
  const [diagnostics, setDiagnostics] = useState<SiteRuntimeDiagnostic[]>([])
  const [status, setStatus] = useState<'idle' | 'building' | 'ready' | 'error'>('idle')

  const selectedScripts = useMemo(() => {
    if (!site) return []
    return collectRuntimeScripts({
      files: site.files,
      runtime: normalizeSiteRuntimeConfig(site.runtime),
      page,
      target: 'canvas',
    })
  }, [page, site])

  const enabled = active && selectedScripts.length > 0 && Boolean(site)

  useEffect(() => {
    if (!enabled || !site) {
      setSrcDoc('')
      setDiagnostics([])
      setStatus('idle')
      return
    }

    let cancelled = false
    let cleanup: (() => void) | null = null
    setStatus('building')

    const timeout = window.setTimeout(() => {
      buildCmsRuntimePreview({
        site,
        pageId: page.id,
        breakpointId,
        templateContext,
      })
        .then((result) => {
          if (cancelled) return
          const materialized = materializeRuntimePreviewDocument(result)
          cleanup = materialized.revoke
          setSrcDoc(materialized.html)
          setDiagnostics(result.diagnostics)
          setStatus(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'error' : 'ready')
        })
        .catch((error) => {
          if (cancelled) return
          setSrcDoc('')
          setDiagnostics([{
            code: 'runtime-preview-client-error',
            severity: 'error',
            message: error instanceof Error ? error.message : 'Runtime preview failed',
          }])
          setStatus('error')
        })
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      cleanup?.()
    }
  }, [breakpointId, enabled, page.id, site, templateContext])

  if (!enabled) return null

  return (
    <>
      {srcDoc && (
        <iframe
          title={`Runtime preview: ${page.title}`}
          data-testid="canvas-runtime-preview"
          className={styles.runtimePreviewFrame}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
        />
      )}
      {status !== 'ready' && (
        <div
          className={styles.runtimePreviewStatus}
          data-status={status}
          aria-live="polite"
        >
          {status === 'building'
            ? 'Runtime'
            : diagnostics[0]?.packageName ?? diagnostics[0]?.message ?? 'Runtime'}
        </div>
      )}
    </>
  )
}
