/**
 * ListFieldCell — cell renderer for `listField` fields.
 *
 * STEP 1 PLACEHOLDER: full mini-grid editor + add/remove rows lands in step 2.
 * For now this just renders a read-only count so the data grid stays usable
 * for authors who already have list-field cells in their tables — the
 * discriminated-union exhaustiveness check in `CellEditorRenderer` requires
 * SOMETHING to render here, otherwise TypeScript fails the build.
 *
 * The shape mirrors `FieldSchemaCell`: a button-like affordance that exposes
 * the row count. Click-handlers / modal / per-row validation are deliberately
 * deferred to step 2.
 */
import type { ReactElement } from 'react'
import type { CellEditorProps } from '@admin/pages/data/types'
import type { DataField } from '@core/data/schemas'
import { readListFieldCell } from '@core/data/cells'
import styles from './cells.module.css'

type ListFieldField = Extract<DataField, { type: 'listField' }>

export type ListFieldCellProps = CellEditorProps<ListFieldField>

export function ListFieldCell({
  field,
  value,
  readOnly,
  ariaLabel,
}: ListFieldCellProps): ReactElement {
  const rows = readListFieldCell({ [field.id]: value }, field.id)
  const count = rows.length
  const label = count === 1 ? '1 row' : `${count} rows`

  return (
    <div
      className={styles.relationButton}
      data-readonly={readOnly ? 'true' : undefined}
      aria-label={ariaLabel}
    >
      <span className={styles.relationLabel}>{label}</span>
      <span className={styles.relationHint}>(editor in step 2)</span>
    </div>
  )
}
