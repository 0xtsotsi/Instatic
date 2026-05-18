import { Type } from '@sinclair/typebox'
import type {
  DataTable,
  DataRow,
  DataUserReference,
  DataRowStatus,
  CreateDataTableInput,
  UpdateDataTableInput,
  CreateDataRowInput,
  SaveDataRowDraftInput,
  DataMeta,
} from '@core/data/schemas'
import { DataMetaSchema } from '@core/data/schemas'
import type { LoopItem } from '@core/loops/types'
import { parseValue } from '@core/utils/typeboxHelpers'
import { readEnvelope } from './httpJson'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

// ---------------------------------------------------------------------------
// Envelope schemas
//
// DataTable and DataRow are deep domain types. We validate the outer envelope
// (object with the expected key) and pass the inner entity through as
// `unknown` then cast at the call site — same envelope strategy used by
// cmsContent.ts and responseSchemas.ts. Catches "server returned wrong shape"
// without duplicating the entire data type tree here.
// ---------------------------------------------------------------------------

const TablesListEnvelope = Type.Object(
  { tables: Type.Optional(Type.Array(Type.Unknown())) },
  { additionalProperties: true },
)

const RowsListEnvelope = Type.Object(
  { rows: Type.Optional(Type.Array(Type.Unknown())) },
  { additionalProperties: true },
)

const AuthorsListEnvelope = Type.Object(
  { authors: Type.Optional(Type.Array(Type.Unknown())) },
  { additionalProperties: true },
)

const TableEnvelope = Type.Object(
  { table: Type.Optional(Type.Unknown()) },
  { additionalProperties: true },
)

const RowEnvelope = Type.Object(
  { row: Type.Optional(Type.Unknown()) },
  { additionalProperties: true },
)

// ---------------------------------------------------------------------------
// Data table CRUD
// ---------------------------------------------------------------------------

export async function listCmsDataTables(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataTable[]> {
  const res = await fetchImpl(`${basePath}/data/tables`, {
    method: 'GET',
    credentials: 'include',
  })
  const body = await readEnvelope(res, TablesListEnvelope, `CMS data tables failed with ${res.status}`)
  return (body.tables ?? []) as DataTable[]
}

export async function getCmsDataTable(
  tableId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataTable | null> {
  const res = await fetchImpl(`${basePath}/data/tables/${encodeURIComponent(tableId)}`, {
    method: 'GET',
    credentials: 'include',
  })
  if (res.status === 404) return null
  const body = await readEnvelope(res, TableEnvelope, `CMS data table fetch failed with ${res.status}`)
  return (body.table ?? null) as DataTable | null
}

export async function getCmsDataTableBySlug(
  slug: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataTable | null> {
  const tables = await listCmsDataTables(fetchImpl, basePath)
  return tables.find((t) => t.slug === slug) ?? null
}

export async function createCmsDataTable(
  input: CreateDataTableInput,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataTable> {
  const res = await fetchImpl(`${basePath}/data/tables`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readEnvelope(res, TableEnvelope, `CMS data table create failed with ${res.status}`)
  if (!body.table) throw new Error('CMS data table create response was missing table')
  return body.table as DataTable
}

export async function updateCmsDataTable(
  tableId: string,
  input: UpdateDataTableInput,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataTable> {
  const res = await fetchImpl(`${basePath}/data/tables/${encodeURIComponent(tableId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readEnvelope(res, TableEnvelope, `CMS data table update failed with ${res.status}`)
  if (!body.table) throw new Error('CMS data table update response was missing table')
  return body.table as DataTable
}

export async function deleteCmsDataTable(
  tableId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataTable> {
  const res = await fetchImpl(`${basePath}/data/tables/${encodeURIComponent(tableId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  const body = await readEnvelope(res, TableEnvelope, `CMS data table delete failed with ${res.status}`)
  if (!body.table) throw new Error('CMS data table delete response was missing table')
  return body.table as DataTable
}

// ---------------------------------------------------------------------------
// Data row CRUD
// ---------------------------------------------------------------------------

export async function listCmsDataRows(
  tableId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataRow[]> {
  const res = await fetchImpl(
    `${basePath}/data/tables/${encodeURIComponent(tableId)}/rows`,
    { method: 'GET', credentials: 'include' },
  )
  const body = await readEnvelope(res, RowsListEnvelope, `CMS data rows failed with ${res.status}`)
  return (body.rows ?? []) as DataRow[]
}

export async function createCmsDataRow(
  tableId: string,
  input: CreateDataRowInput,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataRow> {
  const res = await fetchImpl(
    `${basePath}/data/tables/${encodeURIComponent(tableId)}/rows`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  const body = await readEnvelope(res, RowEnvelope, `CMS data row create failed with ${res.status}`)
  if (!body.row) throw new Error('CMS data row create response was missing row')
  return body.row as DataRow
}

export async function saveCmsDataRowDraft(
  rowId: string,
  input: SaveDataRowDraftInput,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataRow> {
  const res = await fetchImpl(`${basePath}/data/rows/${encodeURIComponent(rowId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readEnvelope(res, RowEnvelope, `CMS data row save failed with ${res.status}`)
  if (!body.row) throw new Error('CMS data row save response was missing row')
  return body.row as DataRow
}

export async function deleteCmsDataRow(
  rowId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataRow> {
  const res = await fetchImpl(`${basePath}/data/rows/${encodeURIComponent(rowId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  const body = await readEnvelope(res, RowEnvelope, `CMS data row delete failed with ${res.status}`)
  if (!body.row) throw new Error('CMS data row delete response was missing row')
  return body.row as DataRow
}

export async function publishCmsDataRow(
  rowId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataRow> {
  const res = await fetchImpl(`${basePath}/data/rows/${encodeURIComponent(rowId)}/publish`, {
    method: 'POST',
    credentials: 'include',
  })
  const body = await readEnvelope(res, RowEnvelope, `CMS data row publish failed with ${res.status}`)
  if (!body.row) throw new Error('CMS data row publish response was missing row')
  return body.row as DataRow
}

export async function updateCmsDataRowStatus(
  rowId: string,
  status: Exclude<DataRowStatus, 'published'>,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataRow> {
  const res = await fetchImpl(`${basePath}/data/rows/${encodeURIComponent(rowId)}/status`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  const body = await readEnvelope(res, RowEnvelope, `CMS data row status update failed with ${res.status}`)
  if (!body.row) throw new Error('CMS data row status response was missing row')
  return body.row as DataRow
}

export async function updateCmsDataRowAuthor(
  rowId: string,
  authorUserId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataRow> {
  const res = await fetchImpl(`${basePath}/data/rows/${encodeURIComponent(rowId)}/author`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ authorUserId }),
  })
  const body = await readEnvelope(res, RowEnvelope, `CMS data row author update failed with ${res.status}`)
  if (!body.row) throw new Error('CMS data row author response was missing row')
  return body.row as DataRow
}

export async function updateCmsDataRowTable(
  rowId: string,
  tableId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataRow> {
  const res = await fetchImpl(`${basePath}/data/rows/${encodeURIComponent(rowId)}/table`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId }),
  })
  const body = await readEnvelope(res, RowEnvelope, `CMS data row table update failed with ${res.status}`)
  if (!body.row) throw new Error('CMS data row table response was missing row')
  return body.row as DataRow
}

// ---------------------------------------------------------------------------
// Loop preview — real published rows projected as LoopItems
//
// Used by the editor canvas `useLoopPreviewItems` hook for `data.rows`
// loops so the preview matches what the publisher will emit. Falls back
// to synthetic placeholder items only when the table has no published rows.
// ---------------------------------------------------------------------------

const LoopPreviewEnvelope = Type.Object(
  {
    items: Type.Optional(Type.Array(Type.Unknown())),
    totalItems: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
)

export interface DataLoopPreviewOptions {
  orderBy?: string
  direction?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface DataLoopPreviewResult {
  items: LoopItem[]
  totalItems: number
}

export async function previewCmsDataLoopItems(
  tableId: string,
  options: DataLoopPreviewOptions = {},
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataLoopPreviewResult> {
  const params = new URLSearchParams()
  if (options.orderBy) params.set('orderBy', options.orderBy)
  if (options.direction) params.set('direction', options.direction)
  if (typeof options.limit === 'number') params.set('limit', String(options.limit))
  if (typeof options.offset === 'number') params.set('offset', String(options.offset))
  const query = params.toString()
  const suffix = query ? `?${query}` : ''
  const res = await fetchImpl(
    `${basePath}/data/tables/${encodeURIComponent(tableId)}/loop-preview${suffix}`,
    { method: 'GET', credentials: 'include' },
  )
  const body = await readEnvelope(
    res,
    LoopPreviewEnvelope,
    `CMS data loop preview failed with ${res.status}`,
  )
  return {
    items: (body.items ?? []) as LoopItem[],
    totalItems: body.totalItems ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Authors
// ---------------------------------------------------------------------------

export async function listCmsDataAuthors(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/admin/api/cms',
): Promise<DataUserReference[]> {
  const res = await fetchImpl(`${basePath}/data/authors`, {
    method: 'GET',
    credentials: 'include',
  })
  const body = await readEnvelope(res, AuthorsListEnvelope, `CMS data authors failed with ${res.status}`)
  return (body.authors ?? []) as DataUserReference[]
}

// ---------------------------------------------------------------------------
// Data meta
// ---------------------------------------------------------------------------

// Outer envelope — we only check for the key presence here; the inner `meta`
// value is fully validated against DataMetaSchema after the envelope check.
const DataMetaEnvelope = Type.Object(
  { meta: Type.Optional(Type.Unknown()) },
  { additionalProperties: true },
)

export async function getDataMeta(
  options?: { fetchImpl?: FetchLike; basePath?: string },
): Promise<DataMeta> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const basePath = options?.basePath ?? '/admin/api/cms'
  const res = await fetchImpl(`${basePath}/data/_meta`, { credentials: 'include' })
  const body = await readEnvelope(res, DataMetaEnvelope, `CMS data meta failed with ${res.status}`)
  return parseValue(DataMetaSchema, body.meta)
}
