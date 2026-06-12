/**
 * MetaLengthMeter — live character + approximate pixel-width meter for SEO
 * title/description fields, against Google's desktop truncation budgets
 * (~580px title / ~990px description). Zones: ok (≤85%), amber, over.
 * Inherited (placeholder) values render the meter muted — informative but
 * clearly not the user's own text.
 */
import { cn } from '@ui/cn'
import {
  approxPixelWidth,
  meterZone,
  TITLE_PIXEL_BUDGET,
  DESCRIPTION_PIXEL_BUDGET,
  TITLE_CHAR_GUIDE,
  DESCRIPTION_CHAR_GUIDE,
} from '@core/seo'
import type { CSSProperties } from 'react'
import styles from './MetaLengthMeter.module.css'

interface MetaLengthMeterProps {
  text: string
  budget: 'title' | 'description'
  /** False when the meter measures an inherited placeholder, not user text. */
  explicit: boolean
}

export function MetaLengthMeter({ text, budget, explicit }: MetaLengthMeterProps) {
  const pixelBudget = budget === 'title' ? TITLE_PIXEL_BUDGET : DESCRIPTION_PIXEL_BUDGET
  const charGuide = budget === 'title' ? TITLE_CHAR_GUIDE : DESCRIPTION_CHAR_GUIDE
  const width = approxPixelWidth(text)
  const zone = meterZone(width, pixelBudget)
  const fillPct = Math.min(100, Math.round((width / pixelBudget) * 100))

  return (
    <div
      className={cn(styles.meter, !explicit && styles.meterInherited)}
      role="status"
      aria-label={`${budget === 'title' ? 'Title' : 'Description'} length: ${text.length} characters, ${zone === 'over' ? 'over' : 'within'} the display budget`}
    >
      <span
        className={cn(styles.track)}
        style={{ '--seo-meter-fill': `${fillPct}%` } as CSSProperties}
      >
        <span className={cn(styles.fill, styles[`fill_${zone}`])} />
      </span>
      <span className={cn(styles.count, styles[`count_${zone}`])}>
        {text.length}/{charGuide}
      </span>
    </div>
  )
}
