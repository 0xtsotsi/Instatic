/**
 * useSeoWorkspace — the SEO workspace's shared data layer.
 *
 * Loads the full target index + site SEO settings once, exposes typed save
 * functions that update local state in place (no refetch on save), and
 * carries the context object the resolver helpers need.
 */
import { useEffect, useState } from 'react'
import { isAbortError } from '@core/http'
import { getErrorMessage } from '@core/utils/errorMessage'
import type { SeoMetadata, SiteSeoSettings } from '@core/seo'
import {
  fetchSeoTargets,
  saveSeoTarget,
  saveSiteSeo,
  type SeoTarget,
  type SeoTargetKind,
} from '../lib/seoApi'
import type { ResolveTargetSeoContext } from '../lib/resolveTargetSeo'

export interface SeoWorkspace {
  loading: boolean
  error: string | null
  siteName: string
  language: string | null
  publicOrigin: string | null
  siteSeo: SiteSeoSettings | null
  targets: SeoTarget[]
  /** Context bundle for `resolveTargetSeo` / health computation. */
  resolveContext: ResolveTargetSeoContext
  /** PUT one target's seo cell; updates local state on success. */
  saveTarget: (kind: SeoTargetKind, id: string, seo: SeoMetadata) => Promise<void>
  /** PUT site.settings.seo; updates local state on success. */
  saveSite: (seo: SiteSeoSettings) => Promise<void>
}

export function useSeoWorkspace(): SeoWorkspace {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [siteName, setSiteName] = useState('')
  const [language, setLanguage] = useState<string | null>(null)
  const [publicOrigin, setPublicOrigin] = useState<string | null>(null)
  const [siteSeo, setSiteSeo] = useState<SiteSeoSettings | null>(null)
  const [targets, setTargets] = useState<SeoTarget[]>([])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetchSeoTargets(controller.signal)
      .then((payload) => {
        setSiteName(payload.siteName)
        setLanguage(payload.language)
        setPublicOrigin(payload.publicOrigin)
        setSiteSeo(payload.siteSeo)
        setTargets(payload.targets)
        setError(null)
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return
        console.error('[seo-page] targets load failed:', err)
        setError(getErrorMessage(err, 'Could not load SEO targets'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  async function saveTarget(kind: SeoTargetKind, id: string, seo: SeoMetadata): Promise<void> {
    const updated = await saveSeoTarget(kind, id, seo)
    setTargets((current) => current.map((target) => (target.id === id ? updated : target)))
  }

  async function saveSite(seo: SiteSeoSettings): Promise<void> {
    const saved = await saveSiteSeo(seo)
    setSiteSeo(saved)
  }

  return {
    loading,
    error,
    siteName,
    language,
    publicOrigin,
    siteSeo,
    targets,
    resolveContext: { siteName, language, publicOrigin, siteSeo, targets },
    saveTarget,
    saveSite,
  }
}
