/**
 * SchemaPreview — read-only, pretty-printed JSON-LD exactly as the publisher
 * will emit it for the selected target (same `buildJsonLdEntities` call).
 * Makes the AEO output inspectable instead of invisible.
 */
import { buildJsonLdEntities, type ResolvedSeoMetadata } from '@core/seo'
import { Code } from '@ui/components/Code'
import type { SeoTarget } from '../lib/seoApi'
import type { SeoWorkspace } from '../hooks/useSeoWorkspace'
import styles from './SchemaPreview.module.css'

export function SchemaPreview({
  target,
  resolved,
  workspace,
}: {
  target: SeoTarget
  resolved: ResolvedSeoMetadata
  workspace: SeoWorkspace
}) {
  const entities = buildJsonLdEntities(resolved, {
    kind: target.kind === 'post' ? 'row' : 'page',
    routePath: target.route ?? '/',
    origin: workspace.publicOrigin ?? undefined,
    siteName: workspace.siteName,
    organization: workspace.siteSeo?.organization,
  })

  if (entities.length === 0) {
    return (
      <p className={styles.empty} role="status">
        {resolved.noindex
          ? 'Noindex targets emit no structured data.'
          : workspace.publicOrigin
            ? 'No structured data applies to this target.'
            : 'Structured data with absolute URLs is emitted once PUBLIC_ORIGINS is configured.'}
      </p>
    )
  }

  return (
    <div className={styles.schema} aria-label="JSON-LD structured data preview">
      {entities.map((entity, index) => (
        <Code key={index}>{JSON.stringify(entity, null, 2)}</Code>
      ))}
    </div>
  )
}
