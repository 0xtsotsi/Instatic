/**
 * Visitor canvas annotations — persistence types for `node_annotations`.
 *
 * One row per public-side comment pinned to a specific node on a specific
 * page (matched by `node_id` against the published page's `nodes` map).
 * Replies reuse `parent_id` to thread.
 *
 * Lives outside `data_rows` because annotations are site-scoped system
 * state with no schema flexibility — a dedicated table avoids polluting
 * the user's `data_tables` list and keeps the spam-dedup `email_hash`
 * index narrow. See `server/db/migrations-pg.ts:021_node_annotations`
 * (and the SQLite mirror) for the column shape and the indexes
 * (`node_annotations_page_idx` / `node_annotations_thread_idx`).
 *
 * `publish_version` is stamped on every insert so the editor can restore
 * annotations against a historical page version without confusing them
 * with current ones (mirrors the per-version pattern used by
 * `server/forms/handler.ts:findPublishedFormSnapshot`).
 *
 * Status is constrained server-side to `'open' | 'resolved'` by the
 * `node_annotations_status_check` CHECK constraint — the same vocabulary
 * the admin resolve handler enforces at the wire boundary.
 *
 * Email is stored only as `author_email_hash` (sha256 of the
 * lowercased address, hex-encoded) so this repository never receives or
 * returns plaintext PII. The hashing lives in
 * `server/annotations/handler.ts`; this file is the schema contract.
 */
import { isoDate, isoDateOrNull } from '@core/utils/isoDate'

/**
 * Wire vocabulary for `node_annotations.status`. Matches the
 * `node_annotations_status_check` CHECK constraint at the DB layer so a
 * domain type cannot drift from the schema.
 */
export type NodeAnnotationStatus = 'open' | 'resolved'

/**
 * Canonical annotation row as a domain object. Timestamps are ISO 8601
 * strings (the project-wide convention — see `@core/utils/isoDate`) and
 * `publishVersion` is a plain number to match how `postgres.js`
 * surfaces PG `bigint` for sequence-shaped counters (consistent with
 * `data_rows.seq` in `server/repositories/syncSequence.ts`).
 */
export interface NodeAnnotation {
  id: string
  siteId: string
  pageId: string
  nodeId: string
  publishVersion: number
  parentId: string | null
  authorName: string
  authorEmailHash: string
  body: string
  status: NodeAnnotationStatus
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

/**
 * Raw row shape returned by `postgres.js` / `bun:sqlite`. Snake_case to
 * match the SELECT projection. Timestamps may be either `Date` (PG
 * `timestamptz` → JS `Date`) or ISO strings (SQLite `text`); the mapper
 * normalises them via `isoDate` / `isoDateOrNull`.
 */
export interface NodeAnnotationRow {
  id: string
  site_id: string
  page_id: string
  node_id: string
  publish_version: number
  parent_id: string | null
  author_name: string
  author_email_hash: string
  body: string
  status: NodeAnnotationStatus
  created_at: Date | string
  updated_at: Date | string
  resolved_at: Date | string | null
}

/**
 * Row → domain mapper. Keeps the column-name → field-name translation
 * in one place so every reader (admin list endpoint, audit export,
 * future webhook) returns the same shape.
 */
export function mapAnnotationRow(row: NodeAnnotationRow): NodeAnnotation {
  return {
    id: row.id,
    siteId: row.site_id,
    pageId: row.page_id,
    nodeId: row.node_id,
    publishVersion: row.publish_version,
    parentId: row.parent_id,
    authorName: row.author_name,
    authorEmailHash: row.author_email_hash,
    body: row.body,
    status: row.status,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    resolvedAt: isoDateOrNull(row.resolved_at),
  }
}
