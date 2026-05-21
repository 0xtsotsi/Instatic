/**
 * DropdownSwitcher — shared 3-state segmented + dropdown chip used by the
 * Layout and Position sections.
 *
 * Three visual states keyed off the current CSS value:
 *
 *   1. unset — `[ A | B | ▼ ]` segmented row, no segment pressed.
 *   2. primary value — same row, the matching segment pressed. Hovering the
 *      pressed segment reveals a close-icon overlay; clicking it clears the
 *      property (`onClear()`).
 *   3. other value — segmented row replaced by a full-width chip showing
 *      `kicker · value` with a square close button. Clicking the chip body
 *      reopens the dropdown so users can pick a different value.
 *
 * The trailing chevron always opens a ContextMenu listing every value in
 * `allOptions` so power users can reach values not promoted to the primary
 * segments. Identification (test id, data attribute, aria labels, kicker
 * text) is driven by `property`, so the same shell works for `display`,
 * `position`, and any future CSS property that fits this three-state mold.
 */

import { useRef, useState, type ReactNode } from 'react'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem } from '@ui/components/ContextMenu'
import { SegmentedControl } from '@ui/components/SegmentedControl'
import { ChevronDownIcon } from 'pixel-art-icons/icons/chevron-down'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import styles from './LayoutSection.module.css'

interface PrimarySegment {
  value: string
  label?: ReactNode
  icon?: ReactNode
  ariaLabel?: string
  tooltip?: ReactNode
}

interface DropdownSwitcherProps {
  /** Lowercase CSS property name. Drives kicker text, aria labels, test id. */
  property: string
  /** Current CSS value (undefined renders the unset segmented control). */
  value: string | undefined
  /** Segments promoted to the primary segmented row. */
  primarySegments: ReadonlyArray<PrimarySegment>
  /** Full value list shown in the chevron dropdown. */
  allOptions: ReadonlyArray<string>
  onChange: (value: string) => void
  onClear: () => void
}

export function DropdownSwitcher({
  property,
  value,
  primarySegments,
  allOptions,
  onChange,
  onClear,
}: DropdownSwitcherProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const capitalized = capitalize(property)
  const testId = `css-${property}-switcher`
  const dataValueAttr = `data-${property}-value`

  const isPrimary = value != null && primarySegments.some((seg) => seg.value === value)
  const isOtherValue = value != null && value !== '' && !isPrimary

  const menu = menuOpen ? (
    <ContextMenu
      anchorRef={triggerRef}
      triggerRef={triggerRef}
      align="end"
      side="bottom"
      offset={6}
      ariaLabel={`${capitalized} values`}
      onClose={() => setMenuOpen(false)}
    >
      {allOptions.map((opt) => (
        <ContextMenuItem
          key={opt}
          role="menuitemradio"
          aria-checked={value === opt}
          active={value === opt}
          onClick={() => {
            onChange(opt)
            setMenuOpen(false)
          }}
        >
          {opt}
        </ContextMenuItem>
      ))}
    </ContextMenu>
  ) : null

  // ── Other-value state — full-width chip + close button ───────────────────
  if (isOtherValue) {
    return (
      <div
        className={styles.displayRow}
        data-testid={testId}
        {...{ [dataValueAttr]: value ?? '' }}
      >
        <div className={styles.displayChipGroup}>
          <Button
            ref={triggerRef}
            variant="secondary"
            size="sm"
            fullWidth
            align="start"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`${capitalized}: ${value}`}
            tooltip={`Change ${property} value`}
            className={styles.displayChip}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className={styles.displayChipKicker}>{property}</span>
            <span className={styles.displayChipValue}>{value}</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            iconOnly
            aria-label={`Clear ${property} (${value})`}
            tooltip={`Clear ${property}`}
            className={styles.displayChipClear}
            onClick={onClear}
          >
            <CloseIcon size={14} color="currentColor" />
          </Button>
        </div>
        {menu}
      </div>
    )
  }

  // ── Unset / primary value — segmented control ────────────────────────────
  return (
    <div
      className={styles.displayRow}
      data-testid={testId}
      {...{ [dataValueAttr]: value ?? '' }}
    >
      <SegmentedControl
        fullWidth
        aria-label={capitalized}
        value={isPrimary ? value : undefined}
        onChange={onChange}
        onClear={onClear}
        options={primarySegments.map((seg) => ({
          value: seg.value,
          label: seg.label,
          icon: seg.icon,
          ariaLabel: seg.ariaLabel,
          tooltip: seg.tooltip,
        }))}
        trailing={({ trailingClassName }) => (
          <Button
            ref={triggerRef}
            variant="secondary"
            size="sm"
            iconOnly
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`More ${property} values`}
            tooltip={`More ${property} values`}
            className={trailingClassName}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <ChevronDownIcon size={14} color="currentColor" />
          </Button>
        )}
      />
      {menu}
    </div>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
