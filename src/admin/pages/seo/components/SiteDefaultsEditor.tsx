/**
 * SiteDefaultsEditor — the pinned "Site defaults" target's editing surface.
 *
 * Edits `site.settings.seo`: the title pattern (shared `{source.field}`
 * token syntax), site description, default social image + alt, default X
 * card type, X site handle, and the Organization fields that feed the
 * site-wide JSON-LD. Robots/sitemap settings live on the same object but
 * are edited in their own tabs.
 */
import { useEffect, useId, useState } from 'react'
import { Input, Textarea } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { getErrorMessage } from '@core/utils/errorMessage'
import type { SiteSeoSettings } from '@core/seo'
import type { SeoWorkspace } from '../hooks/useSeoWorkspace'
import { SeoImageField } from './SeoImageField'
import { SaveControls } from './SeoPreviewEditor'
import styles from './SeoPreviewEditor.module.css'

type SiteStringField =
  | 'titlePattern'
  | 'description'
  | 'defaultOgImage'
  | 'defaultOgImageAlt'
  | 'xSiteHandle'

function normalizeSiteSeo(draft: SiteSeoSettings): SiteSeoSettings {
  const next: SiteSeoSettings = {}
  const stringFields: SiteStringField[] = ['titlePattern', 'description', 'defaultOgImage', 'defaultOgImageAlt', 'xSiteHandle']
  for (const key of stringFields) {
    const value = draft[key]
    if (typeof value === 'string' && value.trim() !== '') next[key] = value.trim()
  }
  if (draft.defaultXCard !== undefined) next.defaultXCard = draft.defaultXCard
  const orgName = draft.organization?.name?.trim() ?? ''
  const orgLogo = draft.organization?.logoUrl?.trim() ?? ''
  if (orgName !== '' || orgLogo !== '') {
    next.organization = {
      ...(orgName !== '' ? { name: orgName } : {}),
      ...(orgLogo !== '' ? { logoUrl: orgLogo } : {}),
    }
  }
  if (draft.robots !== undefined) next.robots = draft.robots
  if (draft.sitemap !== undefined) next.sitemap = draft.sitemap
  return next
}

function sameSiteSeo(a: SiteSeoSettings, b: SiteSeoSettings): boolean {
  return JSON.stringify(normalizeSiteSeo(a)) === JSON.stringify(normalizeSiteSeo(b))
}

interface SiteDefaultsEditorProps {
  workspace: SeoWorkspace
  canManage: boolean
  onDirtyChange: (dirty: boolean) => void
}

export function SiteDefaultsEditor({ workspace, canManage, onDirtyChange }: SiteDefaultsEditorProps) {
  const stored = workspace.siteSeo ?? {}
  const [draft, setDraft] = useState<SiteSeoSettings>(stored)
  const [baseline, setBaseline] = useState<SiteSeoSettings>(stored)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const idBase = useId()

  const isDirty = !sameSiteSeo(draft, baseline)

  // Exception #1 (React Compiler rules): parent dirty-guard consumes this
  // through an effect so it tracks every dirtiness flip.
  useEffect(() => {
    onDirtyChange(isDirty)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- notify only when dirtiness flips
  }, [isDirty])

  function setField(field: SiteStringField, value: string): void {
    setDraft((current) => {
      const next = { ...current }
      if (value === '') delete next[field]
      else next[field] = value
      return next
    })
    if (saveState !== 'idle') setSaveState('idle')
  }

  function setOrgField(field: 'name' | 'logoUrl', value: string): void {
    setDraft((current) => {
      const organization = { ...current.organization }
      if (value === '') delete organization[field]
      else organization[field] = value
      const next = { ...current }
      if (Object.keys(organization).length === 0) delete next.organization
      else next.organization = organization
      return next
    })
    if (saveState !== 'idle') setSaveState('idle')
  }

  async function handleSave(): Promise<void> {
    setSaveState('saving')
    setSaveError(null)
    try {
      const normalized = normalizeSiteSeo(draft)
      await workspace.saveSite(normalized)
      setBaseline(normalized)
      setDraft(normalized)
      setSaveState('saved')
    } catch (err) {
      console.error('[seo-page] site defaults save failed:', err)
      setSaveState('error')
      setSaveError(getErrorMessage(err, 'Could not save site SEO defaults'))
    }
  }

  return (
    <section className={styles.editor} aria-label="Site SEO defaults">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h2 className={styles.headerTitle}>Site defaults</h2>
          <span className={styles.headerRoute}>Fallbacks for every page and post</span>
        </div>
        <SaveControls dirty={isDirty} state={saveState} canManage={canManage} onSave={() => void handleSave()} />
      </header>
      {saveError && <p className={styles.error} role="alert">{saveError}</p>}
      {!canManage && (
        <p className={styles.readOnlyNote} role="status">
          Read-only — your role does not include Manage SEO.
        </p>
      )}
      {!workspace.siteSeo && !isDirty && (
        <p className={styles.templateNote} role="status">
          No site defaults yet — set a title pattern and description so every
          target has sensible metadata out of the box.
        </p>
      )}

      <div className={styles.platformBody}>
        <div className={styles.field}>
          <label htmlFor={`${idBase}-pattern`} className={styles.fieldLabel}>Title pattern</label>
          <Input
            id={`${idBase}-pattern`}
            type="text"
            value={draft.titlePattern ?? ''}
            placeholder="{page.title} — {site.name}"
            disabled={!canManage}
            onChange={(e) => setField('titlePattern', e.target.value)}
          />
          <p className={styles.fieldHint}>
            Tokens: <code>{'{page.title}'}</code>, <code>{'{site.name}'}</code>, <code>{'{currentEntry.title}'}</code>.
            Targets with an explicit SEO title skip the pattern.
          </p>
        </div>

        <div className={styles.field}>
          <label htmlFor={`${idBase}-description`} className={styles.fieldLabel}>Site description</label>
          <Textarea
            id={`${idBase}-description`}
            rows={3}
            value={draft.description ?? ''}
            placeholder="Used when a page or post has no description of its own."
            disabled={!canManage}
            onChange={(e) => setField('description', e.target.value)}
          />
        </div>

        <SeoImageField
          label="Default social image"
          value={draft.defaultOgImage ?? ''}
          inheritedValue={null}
          disabled={!canManage}
          onChange={(next) => setField('defaultOgImage', next)}
        />

        <div className={styles.field}>
          <label htmlFor={`${idBase}-ogalt`} className={styles.fieldLabel}>Default image alt text</label>
          <Input
            id={`${idBase}-ogalt`}
            type="text"
            value={draft.defaultOgImageAlt ?? ''}
            disabled={!canManage}
            onChange={(e) => setField('defaultOgImageAlt', e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor={`${idBase}-xcard`} className={styles.fieldLabel}>Default X card</label>
          <Select
            id={`${idBase}-xcard`}
            value={draft.defaultXCard ?? ''}
            disabled={!canManage}
            onChange={(e) => {
              const value = e.target.value
              setDraft((current) => {
                const next = { ...current }
                if (value === '') delete next.defaultXCard
                else next.defaultXCard = value as 'summary' | 'summary_large_image'
                return next
              })
              if (saveState !== 'idle') setSaveState('idle')
            }}
          >
            <option value="">Auto (large when an image is set)</option>
            <option value="summary">summary</option>
            <option value="summary_large_image">summary_large_image</option>
          </Select>
        </div>

        <div className={styles.field}>
          <label htmlFor={`${idBase}-xhandle`} className={styles.fieldLabel}>X site handle</label>
          <Input
            id={`${idBase}-xhandle`}
            type="text"
            value={draft.xSiteHandle ?? ''}
            placeholder="@yoursite"
            disabled={!canManage}
            onChange={(e) => setField('xSiteHandle', e.target.value)}
          />
        </div>

        <h3 className={styles.sectionHeading}>Organization (structured data)</h3>
        <p className={styles.fieldHint}>
          Emitted as schema.org <code>Organization</code> JSON-LD on the homepage —
          how answer engines identify who runs this site.
        </p>

        <div className={styles.field}>
          <label htmlFor={`${idBase}-orgname`} className={styles.fieldLabel}>Organization name</label>
          <Input
            id={`${idBase}-orgname`}
            type="text"
            value={draft.organization?.name ?? ''}
            disabled={!canManage}
            onChange={(e) => setOrgField('name', e.target.value)}
          />
        </div>

        <SeoImageField
          label="Organization logo"
          value={draft.organization?.logoUrl ?? ''}
          inheritedValue={null}
          disabled={!canManage}
          onChange={(next) => setOrgField('logoUrl', next)}
        />
      </div>
    </section>
  )
}
