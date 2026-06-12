/**
 * SeoTargetIndex — the Meta tab's right column: navigation + audit context.
 *
 * Search bar, kind filters (All / Pages / Posts / Templates / Issues), an
 * issues summary chip row, the pinned Site defaults row, and dense target
 * rows with per-field health dots. Keyboard: ↑/↓ move the selection,
 * Enter activates, `/` focuses search.
 */
import { useRef, useState, type KeyboardEvent } from 'react'
import { SearchBar } from '@ui/components/SearchBar'
import { SegmentedControl } from '@ui/components/SegmentedControl'
import { Button } from '@ui/components/Button'
import { computeSeoHealth, type SeoHealth } from '@core/seo'
import { cn } from '@ui/cn'
import type { SeoTarget } from '../lib/seoApi'
import { resolveTargetSeo } from '../lib/resolveTargetSeo'
import type { SeoWorkspace } from '../hooks/useSeoWorkspace'
import styles from './SeoTargetIndex.module.css'

type Filter = 'all' | 'pages' | 'posts' | 'templates' | 'issues'

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pages', label: 'Pages' },
  { value: 'posts', label: 'Posts' },
  { value: 'templates', label: 'Templates' },
  { value: 'issues', label: 'Issues' },
]

interface IndexedTarget {
  target: SeoTarget
  health: SeoHealth
}

interface SeoTargetIndexProps {
  workspace: SeoWorkspace
  selectedId: string
  siteDefaultsId: string
  onSelect: (id: string) => void
}

export function SeoTargetIndex({ workspace, selectedId, siteDefaultsId, onSelect }: SeoTargetIndexProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const indexed: IndexedTarget[] = workspace.targets.map((target) => ({
    target,
    health: computeSeoHealth(
      target.seo ?? undefined,
      resolveTargetSeo(target, undefined, workspace.resolveContext),
    ),
  }))

  const missingTitles = indexed.filter((item) => item.health.title !== 'ok').length
  const missingDescriptions = indexed.filter((item) => item.health.description !== 'ok').length
  const noindexed = indexed.filter((item) => !item.health.indexable).length

  const normalizedQuery = query.trim().toLowerCase()
  const visible = indexed.filter(({ target, health }) => {
    if (filter === 'pages' && target.kind !== 'page') return false
    if (filter === 'posts' && target.kind !== 'post') return false
    if (filter === 'templates' && target.kind !== 'template') return false
    if (filter === 'issues' && health.issueCount === 0) return false
    if (normalizedQuery === '') return true
    return (
      target.title.toLowerCase().includes(normalizedQuery) ||
      (target.route ?? '').toLowerCase().includes(normalizedQuery)
    )
  })

  // Keyboard order: pinned site row first, then the visible targets.
  const order: string[] = [siteDefaultsId, ...visible.map(({ target }) => target.id)]

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === '/') {
      event.preventDefault()
      searchRef.current?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const currentIndex = order.indexOf(selectedId)
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(order.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1)
    const next = order[nextIndex]
    if (next !== undefined && next !== selectedId) onSelect(next)
  }

  return (
    <section className={styles.index} aria-label="SEO targets">
      <SearchBar
        ref={searchRef}
        value={query}
        onValueChange={setQuery}
        placeholder="Search targets…"
        aria-label="Search SEO targets"
        data-testid="seo-target-search"
      />

      <SegmentedControl
        value={filter}
        options={FILTER_OPTIONS}
        onChange={setFilter}
        size="xs"
        aria-label="Filter targets"
        data-testid="seo-target-filter"
      />

      {(missingTitles > 0 || missingDescriptions > 0 || noindexed > 0) && (
        <div className={styles.summaryRow} role="status">
          {missingTitles > 0 && (
            <span className={styles.summaryChip}>{missingTitles} title {missingTitles === 1 ? 'issue' : 'issues'}</span>
          )}
          {missingDescriptions > 0 && (
            <span className={styles.summaryChip}>{missingDescriptions} description {missingDescriptions === 1 ? 'issue' : 'issues'}</span>
          )}
          {noindexed > 0 && (
            <span className={styles.summaryChip}>{noindexed} noindexed</span>
          )}
        </div>
      )}

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keyboard list navigation; rows themselves are buttons */}
      <div
        ref={listRef}
        className={styles.list}
        role="listbox"
        aria-label="SEO target list"
        tabIndex={0}
        onKeyDown={handleListKeyDown}
      >
        <TargetRow
          pinned
          label="Site defaults"
          sublabel="Fallbacks for every target"
          selected={selectedId === siteDefaultsId}
          onSelect={() => onSelect(siteDefaultsId)}
          testId="seo-target-site-defaults"
        />
        {visible.map(({ target, health }) => (
          <TargetRow
            key={target.id}
            label={target.title}
            sublabel={target.route ?? (target.kind === 'template' ? 'Entry template' : '—')}
            kind={target.kind}
            tableLabel={target.tableLabel}
            health={health}
            selected={selectedId === target.id}
            onSelect={() => onSelect(target.id)}
            testId={`seo-target-${target.id}`}
          />
        ))}
        {visible.length === 0 && (
          <p className={styles.empty} role="status">No targets match the current filter.</p>
        )}
      </div>
    </section>
  )
}

function TargetRow({
  label,
  sublabel,
  kind,
  tableLabel,
  health,
  selected,
  pinned = false,
  onSelect,
  testId,
}: {
  label: string
  sublabel: string
  kind?: SeoTarget['kind']
  tableLabel?: string
  health?: SeoHealth
  selected: boolean
  pinned?: boolean
  onSelect: () => void
  testId: string
}) {
  const kindLabel = kind === 'post' ? (tableLabel ?? 'Post') : kind === 'template' ? 'Template' : kind === 'page' ? 'Page' : 'Site'
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(styles.row, selected && styles.rowSelected, pinned && styles.rowPinned)}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      data-testid={testId}
    >
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{label}</span>
        <span className={styles.rowSub}>{sublabel}</span>
      </span>
      <span className={styles.rowMeta}>
        <span className={styles.rowKind}>{kindLabel}</span>
        {health && <HealthDots health={health} />}
      </span>
    </Button>
  )
}

/**
 * Compact health indicators: title, description, image, indexing — green
 * when ok, amber for soft issues, red for missing/noindex. Each dot carries
 * a title tooltip naming the field + state for hover discovery.
 */
function HealthDots({ health }: { health: SeoHealth }) {
  return (
    <span className={styles.dots} aria-label={healthSummary(health)}>
      <Dot state={health.title === 'ok' ? 'ok' : health.title === 'long' ? 'warn' : 'bad'} label={`Title: ${health.title}`} />
      <Dot state={health.description === 'ok' ? 'ok' : health.description === 'long' ? 'warn' : 'bad'} label={`Description: ${health.description}`} />
      <Dot state={health.image === 'ok' ? 'ok' : health.image === 'missingAlt' ? 'warn' : 'bad'} label={`Social image: ${health.image}`} />
      <Dot state={health.indexable ? 'ok' : 'bad'} label={health.indexable ? 'Indexable' : 'Noindex'} />
    </span>
  )
}

function healthSummary(health: SeoHealth): string {
  return health.issueCount === 0
    ? 'No SEO issues'
    : `${health.issueCount} SEO ${health.issueCount === 1 ? 'issue' : 'issues'}`
}

function Dot({ state, label }: { state: 'ok' | 'warn' | 'bad'; label: string }) {
  return <span className={cn(styles.dot, styles[`dot_${state}`])} title={label} />
}
