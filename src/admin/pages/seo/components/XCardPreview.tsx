/**
 * XCardPreview — X (Twitter) card mock rendered from resolved values.
 * Layout follows the card type: `summary_large_image` stacks a wide image
 * above the text; `summary` puts a small square thumb beside it.
 */
import { cn } from '@ui/cn'
import type { ResolvedSeoMetadata } from '@core/seo'
import styles from './XCardPreview.module.css'

export function XCardPreview({ resolved }: { resolved: ResolvedSeoMetadata }) {
  const large = resolved.xCard === 'summary_large_image'
  return (
    <figure
      className={cn(styles.card, large ? styles.cardLarge : styles.cardSummary)}
      aria-label="X card preview"
    >
      {resolved.xImage ? (
        <img className={styles.image} src={resolved.xImage} alt={resolved.xImageAlt ?? ''} />
      ) : (
        <div className={styles.imagePlaceholder} aria-hidden="true">No image</div>
      )}
      <div className={styles.meta}>
        <span className={styles.title}>{resolved.xTitle}</span>
        {resolved.xDescription && <span className={styles.description}>{resolved.xDescription}</span>}
        {resolved.xSiteHandle && <span className={styles.handle}>{resolved.xSiteHandle}</span>}
      </div>
    </figure>
  )
}
