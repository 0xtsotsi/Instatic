/**
 * SeoPreviewEditor — the Meta tab's left column for page / template / post
 * targets.
 *
 * Platform switcher (Search / Open Graph / X / Schema) over an editable
 * snippet: controlled Input/Textarea primitives styled as the platform
 * preview, never raw contentEditable. Every empty field shows its RESOLVED
 * fallback as placeholder text (the shared `@core/seo` resolver), so the
 * user always sees exactly what will be emitted. Title/description carry
 * live pixel meters. Save is quiet and local.
 */
import { useId, useState } from 'react'
import { Button } from '@ui/components/Button'
import { Input, Textarea } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { Switch } from '@ui/components/Switch'
import { SegmentedControl } from '@ui/components/SegmentedControl'
import { getErrorMessage } from '@core/utils/errorMessage'
import { isSafeCanonicalUrl } from '@core/seo'
import type { SeoTarget } from '../lib/seoApi'
import { resolveTargetSeo, templateForPost } from '../lib/resolveTargetSeo'
import type { SeoWorkspace } from '../hooks/useSeoWorkspace'
import { useSeoDraft, normalizeSeoDraft, type SeoDraftField } from '../hooks/useSeoDraft'
import { SearchSnippetPreview } from './SearchSnippetPreview'
import { OpenGraphPreview } from './OpenGraphPreview'
import { XCardPreview } from './XCardPreview'
import { SchemaPreview } from './SchemaPreview'
import { MetaLengthMeter } from './MetaLengthMeter'
import { SeoImageField } from './SeoImageField'
import { AiSuggestionSparkle } from './AiSuggestionBubbles'
import styles from './SeoPreviewEditor.module.css'

type Platform = 'search' | 'og' | 'x' | 'schema'

const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: 'search', label: 'Search' },
  { value: 'og', label: 'Open Graph' },
  { value: 'x', label: 'X' },
  { value: 'schema', label: 'Schema' },
]

interface SeoPreviewEditorProps {
  target: SeoTarget
  workspace: SeoWorkspace
  canManage: boolean
  onDirtyChange: (dirty: boolean) => void
}

export function SeoPreviewEditor({ target, workspace, canManage, onDirtyChange }: SeoPreviewEditorProps) {
  const [platform, setPlatform] = useState<Platform>('search')
  const draft = useSeoDraft(target.seo, onDirtyChange)
  const fieldIdBase = useId()

  const resolved = resolveTargetSeo(target, draft.draft, workspace.resolveContext)
  const template = templateForPost(target, workspace.targets)
  const canonicalValue = draft.draft.canonicalUrl ?? ''
  const canonicalInvalid = canonicalValue !== '' && !isSafeCanonicalUrl(canonicalValue)

  async function handleSave(): Promise<void> {
    if (canonicalInvalid) {
      draft.markError('Canonical URL must be an absolute http(s) URL')
      return
    }
    draft.markSaving()
    try {
      const normalized = normalizeSeoDraft(draft.draft)
      await workspace.saveTarget(target.kind, target.id, normalized)
      draft.markSaved(normalized)
    } catch (err) {
      console.error('[seo-page] save failed:', err)
      draft.markError(getErrorMessage(err, 'Could not save SEO metadata'))
    }
  }

  const xCustomized =
    draft.draft.xTitle !== undefined ||
    draft.draft.xDescription !== undefined ||
    draft.draft.xImage !== undefined ||
    draft.draft.xImageAlt !== undefined ||
    draft.draft.xCard !== undefined
  const [xExpanded, setXExpanded] = useState(false)
  const showXFields = xCustomized || xExpanded

  function field(field: SeoDraftField, label: string, opts?: {
    textarea?: boolean
    meterBudget?: 'title' | 'description'
    invalid?: boolean
    sparkle?: boolean
  }) {
    const id = `${fieldIdBase}-${field}`
    const value = draft.draft[field] ?? ''
    const placeholder = resolvedPlaceholder(field)
    const common = {
      id,
      value,
      placeholder,
      disabled: !canManage,
      'aria-invalid': opts?.invalid || undefined,
    }
    return (
      <div className={styles.field}>
        <div className={styles.fieldLabelRow}>
          <label htmlFor={id} className={styles.fieldLabel}>{label}</label>
          {opts?.sparkle && (
            <AiSuggestionSparkle
              target={target}
              field={field}
              canManage={canManage}
              onPick={(suggestion) => draft.setField(field, suggestion)}
            />
          )}
        </div>
        {opts?.textarea ? (
          <Textarea
            {...common}
            rows={3}
            onChange={(e) => draft.setField(field, e.target.value)}
          />
        ) : (
          <Input
            {...common}
            type="text"
            onChange={(e) => draft.setField(field, e.target.value)}
          />
        )}
        {opts?.meterBudget && (
          <MetaLengthMeter text={value || placeholder || ''} budget={opts.meterBudget} explicit={value !== ''} />
        )}
      </div>
    )
  }

  function resolvedPlaceholder(field: SeoDraftField): string {
    switch (field) {
      case 'title': return resolved.title
      case 'description': return resolved.description ?? 'No description — add one or set a site default'
      case 'canonicalUrl': return resolved.canonicalUrl ?? 'Derived from the public origin'
      case 'ogTitle': return resolved.ogTitle
      case 'ogDescription': return resolved.ogDescription ?? ''
      case 'ogImage': return resolved.ogImage ?? ''
      case 'ogImageAlt': return resolved.ogImageAlt ?? ''
      case 'xTitle': return resolved.xTitle
      case 'xDescription': return resolved.xDescription ?? ''
      case 'xImage': return resolved.xImage ?? ''
      case 'xImageAlt': return resolved.xImageAlt ?? ''
    }
  }

  return (
    <section className={styles.editor} aria-label={`SEO for ${target.title}`}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h2 className={styles.headerTitle}>{target.title}</h2>
          <span className={styles.headerRoute}>
            {target.route ?? (target.kind === 'template' ? `Entry template${target.tableSlug ? ` · ${target.tableSlug}` : ''}` : '')}
          </span>
        </div>
        <SaveControls
          dirty={draft.isDirty}
          state={draft.saveState}
          canManage={canManage}
          onSave={() => void handleSave()}
        />
      </header>
      {draft.saveError && <p className={styles.error} role="alert">{draft.saveError}</p>}
      {!canManage && (
        <p className={styles.readOnlyNote} role="status">
          Read-only — your role does not include Manage SEO.
        </p>
      )}
      {target.kind === 'template' && (
        <p className={styles.templateNote} role="status">
          Template defaults — title and description act as patterns
          (<code>{'{currentEntry.title}'}</code>, <code>{'{site.name}'}</code>) for every matching post.
        </p>
      )}

      <SegmentedControl
        value={platform}
        options={PLATFORM_OPTIONS}
        onChange={setPlatform}
        size="sm"
        aria-label="Preview platform"
        data-testid="seo-platform-switcher"
      />

      {platform === 'search' && (
        <div className={styles.platformBody}>
          <SearchSnippetPreview resolved={resolved} />
          {field('title', 'Title', { meterBudget: 'title', sparkle: true })}
          {field('description', 'Description', { textarea: true, meterBudget: 'description', sparkle: true })}
          {field('canonicalUrl', 'Canonical URL', { invalid: canonicalInvalid })}
          {canonicalInvalid && (
            <p className={styles.error} role="alert">Canonical URL must be an absolute http(s) URL.</p>
          )}
          <div className={styles.switchRow}>
            <Switch
              checked={draft.draft.noindex === true}
              onCheckedChange={draft.setNoindex}
              disabled={!canManage}
              aria-label="Exclude from search engines (noindex)"
              switchSize="sm"
            />
            <span className={styles.switchLabel}>
              Exclude from search engines (<code>noindex</code>)
            </span>
          </div>
        </div>
      )}

      {platform === 'og' && (
        <div className={styles.platformBody}>
          <OpenGraphPreview resolved={resolved} siteName={workspace.siteName} />
          {field('ogTitle', 'OG title', { sparkle: true })}
          {field('ogDescription', 'OG description', { textarea: true, sparkle: true })}
          <SeoImageField
            label="OG image"
            value={draft.draft.ogImage ?? ''}
            inheritedValue={resolved.ogImage ?? null}
            disabled={!canManage}
            onChange={(next) => draft.setField('ogImage', next)}
          />
          {field('ogImageAlt', 'OG image alt')}
          <div className={styles.field}>
            <label htmlFor={`${fieldIdBase}-ogType`} className={styles.fieldLabel}>OG type</label>
            <Select
              id={`${fieldIdBase}-ogType`}
              value={draft.draft.ogType ?? ''}
              disabled={!canManage}
              onChange={(e) => draft.setOgType(e.target.value === '' ? undefined : (e.target.value as 'website' | 'article'))}
            >
              <option value="">Auto ({resolved.ogType})</option>
              <option value="website">website</option>
              <option value="article">article</option>
            </Select>
          </div>
        </div>
      )}

      {platform === 'x' && (
        <div className={styles.platformBody}>
          <XCardPreview resolved={resolved} />
          {!showXFields ? (
            <div className={styles.customizeRow}>
              <p className={styles.customizeHint}>
                X uses the Open Graph values until customized.
              </p>
              <Button variant="secondary" size="sm" disabled={!canManage} onClick={() => setXExpanded(true)} data-testid="seo-customize-x">
                Customize X preview
              </Button>
            </div>
          ) : (
            <>
              {field('xTitle', 'X title', { sparkle: true })}
              {field('xDescription', 'X description', { textarea: true, sparkle: true })}
              <SeoImageField
                label="X image"
                value={draft.draft.xImage ?? ''}
                inheritedValue={resolved.xImage ?? null}
                disabled={!canManage}
                onChange={(next) => draft.setField('xImage', next)}
              />
              {field('xImageAlt', 'X image alt')}
              <div className={styles.field}>
                <label htmlFor={`${fieldIdBase}-xCard`} className={styles.fieldLabel}>Card type</label>
                <Select
                  id={`${fieldIdBase}-xCard`}
                  value={draft.draft.xCard ?? ''}
                  disabled={!canManage}
                  onChange={(e) => draft.setXCard(e.target.value === '' ? undefined : (e.target.value as 'summary' | 'summary_large_image'))}
                >
                  <option value="">Auto ({resolved.xCard})</option>
                  <option value="summary">summary</option>
                  <option value="summary_large_image">summary_large_image</option>
                </Select>
              </div>
            </>
          )}
        </div>
      )}

      {platform === 'schema' && (
        <div className={styles.platformBody}>
          <SchemaPreview target={target} resolved={resolved} workspace={workspace} />
          {template && (
            <p className={styles.templateNote} role="status">
              Patterns inherit from the “{template.title}” entry template.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/** Quiet save affordance: Save button + tiny inline state text. */
export function SaveControls({
  dirty,
  state,
  canManage,
  onSave,
}: {
  dirty: boolean
  state: 'idle' | 'saving' | 'saved' | 'error'
  canManage: boolean
  onSave: () => void
}) {
  const statusText =
    state === 'saving' ? 'Saving…'
    : state === 'saved' && !dirty ? 'Saved'
    : dirty ? 'Unsaved changes' : ''
  return (
    <div className={styles.saveControls}>
      {statusText && (
        <span className={styles.saveStatus} role="status">{statusText}</span>
      )}
      <Button
        variant="primary"
        size="sm"
        disabled={!canManage || !dirty || state === 'saving'}
        tooltip={!canManage ? 'Your role does not include Manage SEO' : undefined}
        onClick={onSave}
        data-testid="seo-save"
      >
        Save
      </Button>
    </div>
  )
}
