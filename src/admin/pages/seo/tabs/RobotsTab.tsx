/**
 * RobotsTab — generated robots.txt controls + live preview.
 *
 * Three switches (indexing, AI training crawlers, AI answer crawlers) over
 * a byte-identical preview of the served file — the preview calls the same
 * `generateRobotsTxt` the server endpoint uses. Saving writes
 * `site.settings.seo.robots`; output goes live with the publish lifecycle.
 */
import { useState } from 'react'
import { Switch } from '@ui/components/Switch'
import { Code } from '@ui/components/Code'
import { getErrorMessage } from '@core/utils/errorMessage'
import {
  generateRobotsTxt,
  AI_TRAINING_CRAWLERS,
  AI_ANSWER_CRAWLERS,
  type SeoRobotsSettings,
} from '@core/seo'
import { SaveControls } from '../components/SeoPreviewEditor'
import type { SeoWorkspace } from '../hooks/useSeoWorkspace'
import styles from './SettingsTabs.module.css'

interface RobotsTabProps {
  workspace: SeoWorkspace
  canManage: boolean
}

export function RobotsTab({ workspace, canManage }: RobotsTabProps) {
  const stored = workspace.siteSeo?.robots ?? {}
  const [draft, setDraft] = useState<SeoRobotsSettings>(stored)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const isDirty = JSON.stringify(draft) !== JSON.stringify(stored)

  const preview = generateRobotsTxt({
    robots: draft,
    sitemapEnabled: workspace.siteSeo?.sitemap?.enabled !== false,
    origin: workspace.publicOrigin ?? undefined,
  })

  function setFlag(flag: keyof SeoRobotsSettings, value: boolean): void {
    setDraft((current) => ({ ...current, [flag]: value }))
    if (saveState !== 'idle') setSaveState('idle')
  }

  async function handleSave(): Promise<void> {
    setSaveState('saving')
    setSaveError(null)
    try {
      await workspace.saveSite({ ...(workspace.siteSeo ?? {}), robots: draft })
      setSaveState('saved')
    } catch (err) {
      console.error('[seo-page] robots save failed:', err)
      setSaveState('error')
      setSaveError(getErrorMessage(err, 'Could not save robots settings'))
    }
  }

  return (
    <section className={styles.tab} aria-label="Robots.txt settings">
      <header className={styles.header}>
        <div>
          <h2 className={styles.heading}>Robots.txt</h2>
          <p className={styles.subheading}>
            Generated automatically and served at <code>/robots.txt</code>. Changes go live on the next publish.
          </p>
        </div>
        <SaveControls dirty={isDirty} state={saveState} canManage={canManage} onSave={() => void handleSave()} />
      </header>
      {saveError && <p className={styles.error} role="alert">{saveError}</p>}
      {!workspace.publicOrigin && (
        <p className={styles.notice} role="status">
          No public origin configured — set the <code>PUBLIC_ORIGINS</code> environment
          variable so the sitemap link (and canonical URLs) use your real domain.
        </p>
      )}

      <div className={styles.controls}>
        <SettingSwitch
          label="Allow search engine indexing"
          description="Turning this off serves a global Disallow — the whole site disappears from search."
          checked={draft.indexingEnabled !== false}
          disabled={!canManage}
          onChange={(value) => setFlag('indexingEnabled', value)}
          testId="seo-robots-indexing"
        />
        <SettingSwitch
          label="Allow AI training crawlers"
          description={`Bots that ingest content for model training: ${AI_TRAINING_CRAWLERS.join(', ')}.`}
          checked={draft.allowAiTrainingCrawlers !== false}
          disabled={!canManage || draft.indexingEnabled === false}
          onChange={(value) => setFlag('allowAiTrainingCrawlers', value)}
          testId="seo-robots-ai-training"
        />
        <SettingSwitch
          label="Allow AI search & answer crawlers"
          description={`Bots that fetch content to ground live AI answers: ${AI_ANSWER_CRAWLERS.join(', ')}. Blocking these removes the site from AI search results.`}
          checked={draft.allowAiAnswerCrawlers !== false}
          disabled={!canManage || draft.indexingEnabled === false}
          onChange={(value) => setFlag('allowAiAnswerCrawlers', value)}
          testId="seo-robots-ai-answer"
        />
      </div>

      <h3 className={styles.previewHeading}>Preview</h3>
      <div data-testid="seo-robots-preview">
        <Code className={styles.preview}>{preview}</Code>
      </div>
    </section>
  )
}

export function SettingSwitch({
  label,
  description,
  checked,
  disabled,
  onChange,
  testId,
}: {
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
  testId: string
}) {
  return (
    <div className={styles.switchRow}>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={label}
        data-testid={testId}
      />
      <div className={styles.switchText}>
        <span className={styles.switchLabel}>{label}</span>
        <span className={styles.switchDescription}>{description}</span>
      </div>
    </div>
  )
}
