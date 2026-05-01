import { nanoid } from 'nanoid'
import type { Project } from '../../src/core/page-tree/types'
import type { DbClient } from './db'
import { loadDraftProject } from './projectRepository'

export interface PublishedPageSnapshot {
  cmsSnapshotVersion: 1
  pageId: string
  project: Project
}

export interface PublishResult {
  publishedPages: number
}

function createSnapshot(project: Project, pageId: string): PublishedPageSnapshot {
  return {
    cmsSnapshotVersion: 1,
    pageId,
    project: structuredClone(project),
  }
}

export async function publishDraftProject(
  db: DbClient,
  adminUserId: string,
): Promise<PublishResult> {
  await db.query('begin')
  try {
    const project = await loadDraftProject(db)
    if (!project) throw new Error('Draft project not found')

    for (const page of project.pages) {
      const versionResult = await db.query<{ next_version: number }>(
        `select coalesce(max(version), 0)::int + 1 as next_version
         from page_versions
         where page_id = $1`,
        [page.id],
      )
      const version = Number(versionResult.rows[0]?.next_version ?? 1)
      const versionId = nanoid()

      await db.query(
        `insert into page_versions (id, page_id, version, snapshot_json, published_by)
         values ($1, $2, $3, $4, $5)`,
        [versionId, page.id, version, createSnapshot(project, page.id), adminUserId],
      )
      await db.query(
        `update pages
         set active_version_id = $1,
             status = 'published',
             updated_at = now()
         where id = $2`,
        [versionId, page.id],
      )
    }

    await db.query('commit')
    return { publishedPages: project.pages.length }
  } catch (err) {
    await db.query('rollback')
    throw err
  }
}

export async function getPublishedPageBySlug(
  db: DbClient,
  slug: string,
): Promise<PublishedPageSnapshot | null> {
  const result = await db.query<{ snapshot_json: PublishedPageSnapshot }>(
    `select page_versions.snapshot_json
     from pages
     join page_versions on page_versions.id = pages.active_version_id
     where pages.slug = $1
       and pages.status = 'published'
     limit 1`,
    [slug],
  )
  return result.rows[0]?.snapshot_json ?? null
}
