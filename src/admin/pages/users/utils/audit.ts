/**
 * Audit-event labelling helpers.
 *
 * The CMS persists audit events with raw IDs (`actorUserId`, `targetId`) and
 * a small `metadata` bag. The Users → Audit tab needs to enrich these with
 * the *current* display name of the related user/role, falling back to the
 * snapshot label captured at write time when the related row no longer
 * exists. These helpers do that enrichment, plus the per-action
 * sentence-case title rendering.
 */
import type { CmsAuditEvent, CmsCurrentUser, CmsRole } from '@core/persistence'
import { displayUserName, statusLabel } from './format'

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function auditUserLabel(
  userId: string | null,
  usersById: Map<string, CmsCurrentUser>,
  fallback: string | null,
): string | null {
  if (!userId) return fallback
  const user = usersById.get(userId)
  return user ? displayUserName(user) : fallback ?? userId
}

export function auditActor(event: CmsAuditEvent, usersById: Map<string, CmsCurrentUser>): string {
  if (!event.actorUserId) return 'by system'
  return `by ${auditUserLabel(event.actorUserId, usersById, event.actorLabel)}`
}

function auditTargetUser(event: CmsAuditEvent, usersById: Map<string, CmsCurrentUser>): string {
  return auditUserLabel(event.targetId, usersById, event.targetLabel) ?? 'Unknown user'
}

function roleName(
  roleId: string | null,
  rolesById: Map<string, CmsRole>,
  fallback: string | null = null,
): string | null {
  if (!roleId) return null
  return rolesById.get(roleId)?.name ?? fallback ?? roleId
}

function auditTargetRole(event: CmsAuditEvent, rolesById: Map<string, CmsRole>): string | null {
  if (event.targetType !== 'role') return null
  return roleName(
    event.targetId,
    rolesById,
    event.targetLabel ?? metadataString(event.metadata, 'name') ?? metadataString(event.metadata, 'slug'),
  )
}

export function auditTitle(
  event: CmsAuditEvent,
  usersById: Map<string, CmsCurrentUser>,
  rolesById: Map<string, CmsRole>,
): string {
  const targetUser = auditTargetUser(event, usersById)
  const role = auditTargetRole(event, rolesById)
  const email = metadataString(event.metadata, 'email')
  const pluginId = metadataString(event.metadata, 'pluginId') ?? event.targetId ?? 'Plugin'

  switch (event.action) {
    case 'login.success':
      return `${event.actorUserId ? auditUserLabel(event.actorUserId, usersById, event.actorLabel) : email ?? 'User'} logged in`
    case 'login.failure':
      return `Failed login for ${email ?? targetUser}`
    case 'logout':
      return `${event.actorUserId ? auditUserLabel(event.actorUserId, usersById, event.actorLabel) : 'User'} logged out`
    case 'user.create':
      return `${targetUser} was created`
    case 'user.update':
      return `${targetUser} was updated`
    case 'user.delete':
      return `${targetUser} was deleted`
    case 'user.suspend':
      return `${targetUser} was suspended`
    case 'password.change':
      return `Password changed for ${targetUser}`
    case 'role.create':
      return `${role ?? 'Role'} was created`
    case 'role.update':
      return `${role ?? 'Role'} was updated`
    case 'role.delete':
      return `${role ?? event.targetId ?? 'Role'} was deleted`
    case 'role.assign':
      return `${targetUser} role changed`
    case 'content.author.assign':
      return 'Content author changed'
    case 'publish':
      return 'Site was published'
    case 'plugin.install':
      return `${pluginId} was installed`
    case 'plugin.enable':
      return `${pluginId} was enabled`
    case 'plugin.disable':
      return `${pluginId} was disabled`
    case 'plugin.delete':
      return `${pluginId} was deleted`
    default:
      return event.action
  }
}

export function auditDetails(event: CmsAuditEvent, rolesById: Map<string, CmsRole>): string[] {
  const details: string[] = []
  const roleId = metadataString(event.metadata, 'roleId')
  const status = metadataString(event.metadata, 'status')
  if (roleId) details.push(`Role: ${roleName(roleId, rolesById, event.metadataLabels.roleId)}`)
  if (status) details.push(`Status: ${statusLabel(status as CmsCurrentUser['status'])}`)
  if (event.ipAddress && event.ipAddress !== 'unknown') details.push(`IP: ${event.ipAddress}`)
  return details
}
