/**
 * Single-row write mutations for data rows.
 *
 *   createDataRow        — insert a new draft
 *   saveDataRowDraft     — overwrite the draft cells and slug
 *   softDeleteDataRow    — set deleted_at
 *   updateDataRowTable   — move a row to another table (rejects on slug conflict)
 *   updateDataRowStatus  — flip between draft / unpublished
 *   updateDataRowAuthor  — reassign the author user id
 *
 * Mutations (other than soft-delete) always RETURN id only, then re-read the
 * hydrated row through `getDataRow` so callers receive consistently populated
 * user references. Soft-delete is the exception: a soft-deleted row is filtered
 * out by `getDataRow`'s `deleted_at is null` clause, so the row is mapped
 * directly from RETURNING (without user references — the delete handler only
 * consumes id / tableId / slug for audit logging).
 */
import { nanoid } from 'nanoid'
import type { DbClient } from '../../../db/client'
import type { DataRow } from '@core/data/schemas'
import { bumpPublishVersion, withPublishLock } from '../../../publish/renderCache'
import { mapRow, type DataRowRow, type CreateDataRowInput, type SaveDataRowDraftInput } from './mapper'
import { getDataRow } from './read'

export type UpdateDataRowTableResult =
  | { ok: true; row: DataRow }
  | { ok: false; reason: 'row_not_found' | 'table_not_found' | 'slug_conflict' }

export async function createDataRow(
  db: DbClient,
  input: CreateDataRowInput,
  actorUserId: string | null = null,
  pluginActorId: string | null = null,
): Promise<DataRow> {
  const { rows } = await db<{ id: string }>`
    insert into data_rows (
      id,
      table_id,
      cells_json,
      slug,
      status,
      author_user_id,
      created_by_user_id,
      updated_by_user_id,
      plugin_actor_id
    )
    values (
      ${input.id ?? nanoid()},
      ${input.tableId},
      ${input.cells},
      ${input.slug},
      ${'draft'},
      ${actorUserId},
      ${actorUserId},
      ${actorUserId},
      ${pluginActorId}
    )
    returning id
  `
  const created = await getDataRow(db, rows[0].id)
  if (!created) throw new Error('data row was created but could not be re-read')
  return created
}

export async function saveDataRowDraft(
  db: DbClient,
  rowId: string,
  input: SaveDataRowDraftInput,
  actorUserId: string | null = null,
  pluginActorId: string | null = null,
): Promise<DataRow | null> {
  const { rows } = await db<{ id: string }>`
    update data_rows
    set cells_json = ${input.cells},
        slug = ${input.slug},
        updated_by_user_id = ${actorUserId},
        plugin_actor_id = ${pluginActorId},
        updated_at = current_timestamp
    where id = ${rowId}
      and deleted_at is null
    returning id
  `
  return rows[0] ? getDataRow(db, rows[0].id) : null
}

/**
 * Soft-delete is the one mutation that returns the row directly from
 * RETURNING rather than re-reading via `getDataRow`: the row now has
 * `deleted_at` set, so `getDataRow`'s `deleted_at is null` filter would mask
 * it. The handler only consumes id / tableId / slug for audit logging, so the
 * absence of hydrated user references on the returned shape is acceptable.
 */
export async function softDeleteDataRow(
  db: DbClient,
  rowId: string,
  actorUserId: string | null = null,
): Promise<DataRow | null> {
  const { rows } = await db<DataRowRow>`
    update data_rows
    set deleted_at = current_timestamp,
        updated_by_user_id = ${actorUserId},
        updated_at = current_timestamp
    where id = ${rowId}
      and deleted_at is null
    returning id, table_id, cells_json, slug, status,
              author_user_id, created_by_user_id,
              updated_by_user_id, published_by_user_id,
              created_at, updated_at, published_at, deleted_at
  `
  return rows[0] ? mapRow(rows[0]) : null
}

/**
 * Move a row to another table. Refuses if the target table is missing or
 * already has a non-deleted row with the same (non-empty) slug. Returns a
 * discriminated union so handlers can map each failure mode to the right HTTP
 * status.
 */
export async function updateDataRowTable(
  db: DbClient,
  rowId: string,
  tableId: string,
  actorUserId: string | null = null,
): Promise<UpdateDataRowTableResult> {
  const row = await getDataRow(db, rowId)
  if (!row) return { ok: false, reason: 'row_not_found' }
  if (row.tableId === tableId) return { ok: true, row }

  const { rows: tableRows } = await db<{ id: string }>`
    select id from data_tables
    where id = ${tableId}
      and deleted_at is null
    limit 1
  `
  if (!tableRows[0]) return { ok: false, reason: 'table_not_found' }

  // Only check for slug conflicts when the row has a non-empty slug.
  if (row.slug) {
    const { rows: conflictRows } = await db<{ id: string }>`
      select id from data_rows
      where table_id = ${tableId}
        and slug = ${row.slug}
        and id <> ${rowId}
        and deleted_at is null
      limit 1
    `
    if (conflictRows[0]) return { ok: false, reason: 'slug_conflict' }
  }

  const { rows } = await db<{ id: string }>`
    update data_rows
    set table_id = ${tableId},
        updated_by_user_id = ${actorUserId},
        updated_at = current_timestamp
    where id = ${rowId}
      and deleted_at is null
    returning id
  `
  if (!rows[0]) return { ok: false, reason: 'row_not_found' }
  const updated = await getDataRow(db, rows[0].id)
  if (!updated) return { ok: false, reason: 'row_not_found' }
  return { ok: true, row: updated }
}

/**
 * Flip a row between `draft` and `unpublished` (the only states reachable
 * from this endpoint — `published` goes through the dedicated publish flow).
 * Always clears `published_at` / `published_by_user_id` since neither remains
 * meaningful in the new state.
 */
export async function updateDataRowStatus(
  db: DbClient,
  rowId: string,
  status: 'draft' | 'unpublished',
  actorUserId: string | null = null,
): Promise<DataRow | null> {
  const { rows } = await db<{ id: string }>`
    update data_rows
    set status = ${status},
        published_at = null,
        published_by_user_id = null,
        updated_by_user_id = ${actorUserId},
        updated_at = current_timestamp
    where id = ${rowId}
      and deleted_at is null
    returning id
  `
  if (!rows[0]) return null
  // Invalidate the render cache. Serialize the bump with publishes so it can't
  // strand a concurrent publish's baked shells (ISS-038).
  await withPublishLock(async () => { bumpPublishVersion() })
  return getDataRow(db, rows[0].id)
}

export async function updateDataRowAuthor(
  db: DbClient,
  rowId: string,
  authorUserId: string,
  actorUserId: string | null = null,
): Promise<DataRow | null> {
  const { rows } = await db<{ id: string }>`
    update data_rows
    set author_user_id = ${authorUserId},
        updated_by_user_id = ${actorUserId},
        updated_at = current_timestamp
    where id = ${rowId}
      and deleted_at is null
    returning id
  `
  return rows[0] ? getDataRow(db, rows[0].id) : null
}
