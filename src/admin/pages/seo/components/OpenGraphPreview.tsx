/**
 * OpenGraphPreview — link-card mock (Facebook/LinkedIn-style) rendered from
 * resolved values: image area, site name, OG title + description.
 */
import type { ResolvedSeoMetadata } from '@core/seo'
import styles from './OpenGraphPreview.module.css'

export function OpenGraphPreview({ resolved, siteName }: { resolved: ResolvedSeoMetadata; siteName: string }) {
  return (
    <figure className={styles.card} aria-label="Open Graph preview">
      {resolved.ogImage ? (
        <img className={styles.image} src={resolved.ogImage} alt={resolved.ogImageAlt ?? ''} />
      ) : (
        <div className={styles.imagePlaceholder} aria-hidden="true">No social image</div>
      )}
      <div className={styles.meta}>
        <span className={styles.site}>{siteName}</span>
        <span className={styles.title}>{resolved.ogTitle}</span>
        {resolved.ogDescription && <span className={styles.description}>{resolved.ogDescription}</span>}
      </div>
    </figure>
  )
}
