/**
 * SearchSnippetPreview — Google-style result snippet rendered from the
 * RESOLVED metadata, so what the user sees is what the publisher emits.
 * Pure display; editing happens in the controlled inputs below it.
 */
import type { ResolvedSeoMetadata } from '@core/seo'
import styles from './SearchSnippetPreview.module.css'

export function SearchSnippetPreview({ resolved }: { resolved: ResolvedSeoMetadata }) {
  return (
    <figure className={styles.snippet} aria-label="Search result preview">
      <span className={styles.url}>
        {resolved.canonicalUrl ?? 'example.com — set PUBLIC_ORIGINS for absolute URLs'}
      </span>
      <span className={styles.title}>{resolved.title}</span>
      <span className={styles.description}>
        {resolved.description ?? 'Search engines will generate a description from page content.'}
      </span>
      {resolved.noindex && (
        <span className={styles.noindexBadge} role="status">noindex — hidden from search</span>
      )}
    </figure>
  )
}
