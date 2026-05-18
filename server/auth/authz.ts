import type { DbClient } from '../db/client'
import { SESSION_COOKIE_NAME, hashSessionToken } from './tokens'
import { roleHasCapability, type CoreCapability } from './capabilities'
import { findUserBySessionHash, getSessionStepUpExpiresAt, sessionRequiresMfa } from './sessions'
import { jsonResponse } from '../http'
import type { AuthUser } from '../repositories/users'

/**
 * Step-up auth window — sensitive actions (delete user, revoke another
 * device, sign out all devices, …) require the user to have re-entered
 * their password within the last 15 minutes. Stored on the session row as
 * `step_up_expires_at`; cleared automatically by elapse, or refreshed by
 * `POST /admin/api/cms/auth/step-up`.
 */
export const STEP_UP_WINDOW_MS = 15 * 60 * 1000

function readCookie(req: Request, name: string): string {
  const cookie = req.headers.get('cookie') ?? ''
  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=')
    if (rawKey === name) return rawValue.join('=')
  }
  return ''
}

export async function getSessionHash(req: Request): Promise<string> {
  const token = readCookie(req, SESSION_COOKIE_NAME)
  return token ? hashSessionToken(token) : ''
}

export async function requireAuthenticatedUser(
  req: Request,
  db: DbClient,
): Promise<AuthUser | Response> {
  const idHash = await getSessionHash(req)
  const user = idHash ? await findUserBySessionHash(db, idHash) : null
  if (!user) {
    if (idHash && await sessionRequiresMfa(db, idHash)) {
      return jsonResponse({ error: 'mfa_required' }, { status: 401 })
    }
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
  }
  return user
}

export async function requireCapability(
  req: Request,
  db: DbClient,
  capability: CoreCapability,
): Promise<AuthUser | Response> {
  const user = await requireAuthenticatedUser(req, db)
  if (user instanceof Response) return user
  if (!userHasCapability(user, capability)) {
    return jsonResponse({ error: 'Forbidden' }, { status: 403 })
  }
  return user
}

export function userHasCapability(user: Pick<AuthUser, 'capabilities'>, capability: CoreCapability): boolean {
  return roleHasCapability(user.capabilities, capability)
}

export function userHasAnyCapability(
  user: Pick<AuthUser, 'capabilities'>,
  capabilities: readonly CoreCapability[],
): boolean {
  return capabilities.some((capability) => userHasCapability(user, capability))
}

export async function requireAnyCapability(
  req: Request,
  db: DbClient,
  capabilities: readonly CoreCapability[],
): Promise<AuthUser | Response> {
  const user = await requireAuthenticatedUser(req, db)
  if (user instanceof Response) return user
  if (!userHasAnyCapability(user, capabilities)) {
    return jsonResponse({ error: 'Forbidden' }, { status: 403 })
  }
  return user
}

/**
 * Returns the authenticated user when their current session is inside a
 * fresh step-up window; otherwise returns a 401 response with the structured
 * body `{ error: 'step_up_required' }` so the client can open the StepUp
 * dialog and retry.
 *
 * The handler pattern is identical to `requireCapability`: callers
 * `await requireStepUp(req, db)`, `if (user instanceof Response) return user`,
 * then proceed knowing the action has been re-authenticated.
 *
 * Exposed in addition to `requireCapability` (rather than baked in) because
 * not every capability-gated action is sensitive — listing users is gated
 * by `users.manage` but doesn't need step-up; deleting one does.
 */
export async function requireStepUp(
  req: Request,
  db: DbClient,
): Promise<AuthUser | Response> {
  const user = await requireAuthenticatedUser(req, db)
  if (user instanceof Response) return user
  const idHash = await getSessionHash(req)
  if (!idHash) {
    return jsonResponse({ error: 'step_up_required' }, { status: 401 })
  }
  const expiresAt = await getSessionStepUpExpiresAt(db, idHash)
  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    return jsonResponse({ error: 'step_up_required' }, { status: 401 })
  }
  return user
}
