/**
 * RobotsTab — generated robots.txt controls + live preview.
 *
 * Two-column workbench. Left settings column:
 *   - Crawling card: indexing + AI-crawler toggles + a system-paths default.
 *   - Custom rules card: per-user-agent Allow/Disallow groups.
 *   - Advanced card: raw `extraDirectives` appended verbatim (escape hatch).
 * Right column: the byte-identical CodeMirror preview (same `generateRobotsTxt`
 * the endpoint serves), a lint panel, and a "test a URL" checker.
 *
 * Saving writes `site.settings.seo.robots`; output goes live on publish.
 */
import { useState } from 'react'
import { Input, Textarea } from '@ui/components/Input'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import { getErrorMessage } from '@core/utils/errorMessage'
import { publishCmsDraft } from '@core/persistence'
import { hasCapability } from '@admin/access'
import { useCurrentAdminUser } from '@admin/sessionContext'
import { StepUpCancelledMessage, useStepUp } from '@admin/shared/StepUp'
import {
  generateRobotsTxt,
  lintRobotsTxt,
  matchRobots,
  AI_TRAINING_CRAWLERS,
  AI_ANSWER_CRAWLERS,
  type SeoRobotsSettings,
  type SeoRobotsRule,
} from '@core/seo'
import { SeoCodeViewer } from '../components/SeoCodeViewer'
import { SeoSwitchRow } from '../components/SeoFormRow'
import type { SeoWorkspace } from '../hooks/useSeoWorkspace'
import type { SeoSaveBridge } from '../hooks/useSeoSaveBridge'
import { useSeoSaveSurface } from '../hooks/useSeoSaveBridge'
import styles from './SettingsTabs.module.css'

interface RobotsTabProps {
  workspace: SeoWorkspace
  canManage: boolean
  bridge: SeoSaveBridge
}

/**
 * Rules are edited as raw multi-line text (one path per line) so typing a
 * newline never gets stripped mid-edit; they compile to `string[]` only when
 * building the settings object.
 */
interface RuleDraft {
  userAgent: string
  allowText: string
  disallowText: string
}

type SaveState = 'idle' | 'saving' | 'saved' | 'publishing' | 'published' | 'error'

function parseLines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
}

function rulesToDrafts(rules: SeoRobotsRule[] | undefined): RuleDraft[] {
  return (rules ?? []).map((rule) => ({
    userAgent: rule.userAgent,
    allowText: (rule.allow ?? []).join('\n'),
    disallowText: (rule.disallow ?? []).join('\n'),
  }))
}

/** Toggles draft + rule drafts → the persisted/previewed settings object. */
function compileRobots(toggles: SeoRobotsSettings, rules: RuleDraft[]): SeoRobotsSettings {
  const compiled: SeoRobotsRule[] = rules
    .map((rule) => {
      const out: SeoRobotsRule = { userAgent: rule.userAgent.trim() }
      const allow = parseLines(rule.allowText)
      const disallow = parseLines(rule.disallowText)
      if (allow.length > 0) out.allow = allow
      if (disallow.length > 0) out.disallow = disallow
      return out
    })
    .filter((rule) => rule.userAgent !== '')

  const next: SeoRobotsSettings = { ...toggles }
  const extra = (toggles.extraDirectives ?? '').trim()
  if (extra === '') delete next.extraDirectives
  else next.extraDirectives = extra
  if (compiled.length > 0) next.rules = compiled
  else delete next.rules
  return next
}

/** Canonical signature for dirty comparison — fills defaults, fixes key order. */
function robotsSignature(settings: SeoRobotsSettings): string {
  return JSON.stringify({
    indexingEnabled: settings.indexingEnabled ?? true,
    allowAiTrainingCrawlers: settings.allowAiTrainingCrawlers ?? true,
    allowAiAnswerCrawlers: settings.allowAiAnswerCrawlers ?? true,
    disallowSystemPaths: settings.disallowSystemPaths ?? true,
    extraDirectives: (settings.extraDirectives ?? '').trim(),
    rules: (settings.rules ?? []).map((rule) => ({
      userAgent: rule.userAgent,
      allow: rule.allow ?? [],
      disallow: rule.disallow ?? [],
    })),
  })
}

export function RobotsTab({ workspace, canManage, bridge }: RobotsTabProps) {
  const stored = workspace.siteSeo?.robots ?? {}
  // Toggles + extra directives live in `draft`; rule path-lists live in
  // `rules` as raw text (see RuleDraft).
  const [draft, setDraft] = useState<SeoRobotsSettings>(() => {
    const { rules: _rules, ...rest } = stored
    return rest
  })
  const [rules, setRules] = useState<RuleDraft[]>(() => rulesToDrafts(stored.rules))
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const currentUser = useCurrentAdminUser()
  const { runStepUp } = useStepUp()
  const canPublish = !currentUser || hasCapability(currentUser, 'pages.publish')

  const effective = compileRobots(draft, rules)
  const indexingOff = draft.indexingEnabled === false
  const isDirty = robotsSignature(effective) !== robotsSignature(stored)

  const preview = generateRobotsTxt({
    robots: effective,
    sitemapEnabled: workspace.siteSeo?.sitemap?.enabled !== false,
    origin: workspace.publicOrigin ?? undefined,
  })
  const lint = lintRobotsTxt(preview)

  function touch(): void {
    if (saveState !== 'idle') setSaveState('idle')
  }
  function setFlag(flag: keyof SeoRobotsSettings, value: boolean): void {
    setDraft((current) => ({ ...current, [flag]: value }))
    touch()
  }
  function addRule(): void {
    setRules((current) => [...current, { userAgent: '', allowText: '', disallowText: '' }])
    touch()
  }
  function updateRule(index: number, patch: Partial<RuleDraft>): void {
    setRules((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)))
    touch()
  }
  function removeRule(index: number): void {
    setRules((current) => current.filter((_, i) => i !== index))
    touch()
  }

  async function handleSave(): Promise<boolean> {
    setSaveState('saving')
    setSaveError(null)
    try {
      await workspace.saveSite({ ...(workspace.siteSeo ?? {}), robots: effective })
      setSaveState('saved')
      return true
    } catch (err) {
      console.error('[seo-page] robots save failed:', err)
      setSaveState('error')
      setSaveError(getErrorMessage(err, 'Could not save robots settings'))
      return false
    }
  }

  async function handlePublish(): Promise<void> {
    if (isDirty && !(await handleSave())) return
    setSaveState('publishing')
    try {
      // Full site publish — step-up gated, same as the Site toolbar.
      await runStepUp(() => publishCmsDraft())
      setSaveState('published')
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) {
        setSaveState('saved')
        return
      }
      console.error('[seo-page] publish failed:', err)
      setSaveState('error')
      setSaveError(getErrorMessage(err, 'Could not publish'))
    }
  }

  useSeoSaveSurface(
    bridge,
    {
      dirty: isDirty,
      state: saveState,
      canSave: canManage,
      canPublish,
      publishScope: 'site',
      liveUrl: workspace.publicOrigin ? `${workspace.publicOrigin}/robots.txt` : null,
    },
    { save: () => void handleSave(), publish: () => void handlePublish() },
  )

  return (
    <section className={styles.tab} aria-label="Robots.txt settings">
      <div className={styles.workbench}>
        <div className={styles.settingsColumn}>
          {saveError && <p className={styles.error} role="alert">{saveError}</p>}
          {!workspace.publicOrigin && (
            <p className={styles.notice} role="status">
              No public origin configured — set the <code>PUBLIC_ORIGINS</code> environment
              variable so the sitemap link (and canonical URLs) use your real domain.
            </p>
          )}

          <div className={styles.card}>
            <header className={styles.cardHeader}>
              <h2 className={styles.heading}>Robots.txt</h2>
              <p className={styles.subheading}>
                Generated automatically and served at <code>/robots.txt</code>. Changes go live on the next publish.
              </p>
            </header>

            <SeoSwitchRow
              id="seo-robots-indexing-switch"
              label="Search indexing"
              hint="Turning this off serves a global Disallow — the whole site disappears from search."
              checked={!indexingOff}
              disabled={!canManage}
              onCheckedChange={(value) => setFlag('indexingEnabled', value)}
              data-testid="seo-robots-indexing"
            />
            <SeoSwitchRow
              id="seo-robots-system-paths-switch"
              label="Block system paths"
              hint="Adds default Disallow rules for /admin and internal /_instatic/ routes."
              checked={draft.disallowSystemPaths !== false}
              disabled={!canManage || indexingOff}
              onCheckedChange={(value) => setFlag('disallowSystemPaths', value)}
              data-testid="seo-robots-system-paths"
            />
            <SeoSwitchRow
              id="seo-robots-ai-training-switch"
              label="AI training crawlers"
              hint={`Bots that ingest content for model training: ${AI_TRAINING_CRAWLERS.join(', ')}.`}
              checked={draft.allowAiTrainingCrawlers !== false}
              disabled={!canManage || indexingOff}
              onCheckedChange={(value) => setFlag('allowAiTrainingCrawlers', value)}
              data-testid="seo-robots-ai-training"
            />
            <SeoSwitchRow
              id="seo-robots-ai-answer-switch"
              label="AI answer crawlers"
              hint={`Bots that fetch content to ground live AI answers: ${AI_ANSWER_CRAWLERS.join(', ')}. Blocking these removes the site from AI search results.`}
              checked={draft.allowAiAnswerCrawlers !== false}
              disabled={!canManage || indexingOff}
              onCheckedChange={(value) => setFlag('allowAiAnswerCrawlers', value)}
              data-testid="seo-robots-ai-answer"
            />
          </div>

          <div className={styles.card}>
            <header className={styles.cardHeader}>
              <h2 className={styles.heading}>Custom rules</h2>
              <p className={styles.subheading}>
                Per-crawler Allow / Disallow paths — one path per line. Groups for the same
                user-agent merge with the built-in ones above.
              </p>
            </header>

            {rules.map((rule, index) => (
              <div key={index} className={styles.ruleCard}>
                <div className={styles.ruleHead}>
                  <Input
                    type="text"
                    value={rule.userAgent}
                    placeholder="User-agent — e.g. Googlebot or *"
                    disabled={!canManage}
                    aria-label={`Rule ${index + 1} user-agent`}
                    onChange={(e) => updateRule(index, { userAgent: e.target.value })}
                    data-testid={`seo-robots-rule-ua-${index}`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!canManage}
                    onClick={() => removeRule(index)}
                    aria-label={`Remove rule ${index + 1}`}
                    data-testid={`seo-robots-rule-remove-${index}`}
                  >
                    Remove
                  </Button>
                </div>
                <div className={styles.ruleGrid}>
                  <label className={styles.ruleField}>
                    <span className={styles.ruleLabel}>Disallow</span>
                    <Textarea
                      rows={2}
                      value={rule.disallowText}
                      placeholder={'/private\n/search'}
                      disabled={!canManage}
                      aria-label={`Rule ${index + 1} disallow paths`}
                      onChange={(e) => updateRule(index, { disallowText: e.target.value })}
                    />
                  </label>
                  <label className={styles.ruleField}>
                    <span className={styles.ruleLabel}>Allow</span>
                    <Textarea
                      rows={2}
                      value={rule.allowText}
                      placeholder={'/public'}
                      disabled={!canManage}
                      aria-label={`Rule ${index + 1} allow paths`}
                      onChange={(e) => updateRule(index, { allowText: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            ))}

            <Button
              variant="secondary"
              size="sm"
              disabled={!canManage}
              onClick={addRule}
              data-testid="seo-robots-add-rule"
            >
              Add rule
            </Button>
          </div>

          <div className={styles.card}>
            <header className={styles.cardHeader}>
              <h2 className={styles.heading}>Advanced</h2>
              <p className={styles.subheading}>
                Extra directives appended verbatim — for one-offs like <code>Clean-param</code> or
                <code> Host</code>. Linted, never dropped.
              </p>
            </header>
            <Textarea
              rows={4}
              value={draft.extraDirectives ?? ''}
              placeholder={'Clean-param: ref /\nHost: example.com'}
              disabled={!canManage}
              aria-label="Extra robots.txt directives"
              onChange={(e) => {
                setDraft((current) => ({ ...current, extraDirectives: e.target.value }))
                touch()
              }}
              data-testid="seo-robots-extra"
            />
          </div>
        </div>

        <aside className={styles.previewColumn} aria-label="robots.txt preview">
          <h3 className={styles.previewHeading}>Preview</h3>
          <SeoCodeViewer docKey="robots-preview" value={preview} language="text" data-testid="seo-robots-preview" />

          {lint.length > 0 && (
            <ul className={styles.lintList} aria-label="robots.txt warnings">
              {lint.map((finding, i) => (
                <li key={i} className={cn(styles.lintItem, styles[`lint_${finding.level}`])}>
                  <span className={styles.lintLine}>Line {finding.line}</span>
                  {finding.message}
                </li>
              ))}
            </ul>
          )}

          <RobotsUrlTester robotsText={preview} />
        </aside>
      </div>
    </section>
  )
}

/** Live "is this URL crawlable?" checker against the previewed file. */
function RobotsUrlTester({ robotsText }: { robotsText: string }) {
  const [userAgent, setUserAgent] = useState('Googlebot')
  const [path, setPath] = useState('/')
  const result = matchRobots(robotsText, userAgent.trim() || '*', path.trim() || '/')

  return (
    <div className={styles.tester}>
      <h3 className={styles.previewHeading}>Test a URL</h3>
      <div className={styles.testerRow}>
        <Input
          type="text"
          value={userAgent}
          placeholder="User-agent"
          aria-label="Test user-agent"
          onChange={(e) => setUserAgent(e.target.value)}
          data-testid="seo-robots-test-ua"
        />
        <Input
          type="text"
          value={path}
          placeholder="/path/to/page"
          aria-label="Test path"
          onChange={(e) => setPath(e.target.value)}
          data-testid="seo-robots-test-path"
        />
      </div>
      <p
        className={cn(styles.testerResult, result.allowed ? styles.testerAllowed : styles.testerBlocked)}
        role="status"
        data-testid="seo-robots-test-result"
      >
        <strong>{result.allowed ? 'Allowed' : 'Blocked'}</strong>
        {result.rule ? ` · matched ${result.rule}` : ' · no matching rule'}
      </p>
    </div>
  )
}
