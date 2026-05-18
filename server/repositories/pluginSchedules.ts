/**
 * Plugin scheduled jobs — persistence layer.
 *
 * Two tables (see `migrations-{pg,sqlite}.ts` → `002_plugin_schedules`):
 *
 *   `plugin_schedules`     — one row per (plugin_id, schedule_id), holds the
 *                            cadence + lock + last-run state. The scheduler
 *                            tick selects rows where `next_run_at <= now()`
 *                            and atomically claims them via
 *                            `running_token`/`lock_until`.
 *
 *   `plugin_schedule_runs` — append-only history of each fire (capped via
 *                            `trimScheduleRunHistory` to keep the latest
 *                            ~200 per (plugin_id, schedule_id) — bounded
 *                            growth without TTL infrastructure).
 *
 * Repository functions follow the dialect-naive rules in CLAUDE.md: only
 * ANSI-standard SQL, no `now()` in DML, no `::int` / `::jsonb` casts, no
 * `distinct on`, no `any($N::...)`. The architecture gate
 * `db-postgres-isms.test.ts` enforces this.
 */
import type { DbClient } from '../db/client'

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

/**
 * Cadence shape — what the plugin author declared. The scheduler reads
 * this and computes the next fire wall-clock from it.
 *
 * All time values are interpreted in UTC. The host's clock is the source
 * of truth; we don't yet expose a per-schedule timezone.
 */
export type Cadence =
  | { interval: 'hourly' }
  | { interval: 'daily'; at: string }                              // "HH:MM" UTC
  | { interval: 'weekly'; at: string; day: Weekday }                // "HH:MM" UTC
  | { interval: 'monthly'; at: string; dayOfMonth: number }         // dayOfMonth 1..28
  | { interval: 'every'; minutes: number }                          // 1..1440

export type OverlapPolicy = 'skip' | 'queue' | 'parallel'

export type ScheduleStatus = 'ok' | 'error' | 'timeout' | 'never_run'

export interface PluginSchedule {
  pluginId: string
  scheduleId: string
  cadence: Cadence
  overlap: OverlapPolicy
  maxDurationMs: number
  enabled: boolean
  consecutiveFailures: number
  lastRunAt: string | null
  lastFinishedAt: string | null
  lastStatus: ScheduleStatus
  lastError: string | null
  lastDurationMs: number | null
  nextRunAt: string
  runningToken: string | null
  lockUntil: string | null
  claimedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PluginScheduleRun {
  id: string
  pluginId: string
  scheduleId: string
  startedAt: string
  finishedAt: string | null
  status: ScheduleStatus
  error: string | null
  durationMs: number | null
  triggeredBy: 'tick' | 'run-now'
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface ScheduleRow {
  plugin_id: string
  schedule_id: string
  cadence_json: unknown
  overlap: string
  max_duration_ms: number
  enabled: boolean | number
  consecutive_failures: number
  last_run_at: string | Date | null
  last_finished_at: string | Date | null
  last_status: string | null
  last_error: string | null
  last_duration_ms: number | null
  next_run_at: string | Date
  running_token: string | null
  lock_until: string | Date | null
  claimed_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

interface ScheduleRunRow {
  id: string
  plugin_id: string
  schedule_id: string
  started_at: string | Date
  finished_at: string | Date | null
  status: string
  error: string | null
  duration_ms: number | null
  triggered_by: string
}

function toIso(value: string | Date | null): string | null {
  if (value == null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toIsoRequired(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function parseCadence(value: unknown): Cadence {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Cadence } catch { /* fall through */ }
  }
  return value as Cadence
}

function parseOverlap(value: string): OverlapPolicy {
  return value === 'queue' || value === 'parallel' ? value : 'skip'
}

function parseStatus(value: string | null): ScheduleStatus {
  if (value === 'ok' || value === 'error' || value === 'timeout') return value
  return 'never_run'
}

function mapSchedule(row: ScheduleRow): PluginSchedule {
  return {
    pluginId: row.plugin_id,
    scheduleId: row.schedule_id,
    cadence: parseCadence(row.cadence_json),
    overlap: parseOverlap(row.overlap),
    maxDurationMs: row.max_duration_ms,
    enabled: Boolean(row.enabled),
    consecutiveFailures: row.consecutive_failures,
    lastRunAt: toIso(row.last_run_at),
    lastFinishedAt: toIso(row.last_finished_at),
    lastStatus: parseStatus(row.last_status),
    lastError: row.last_error,
    lastDurationMs: row.last_duration_ms,
    nextRunAt: toIsoRequired(row.next_run_at),
    runningToken: row.running_token,
    lockUntil: toIso(row.lock_until),
    claimedAt: toIso(row.claimed_at),
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
  }
}

function mapRun(row: ScheduleRunRow): PluginScheduleRun {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    scheduleId: row.schedule_id,
    startedAt: toIsoRequired(row.started_at),
    finishedAt: toIso(row.finished_at),
    status: parseStatus(row.status),
    error: row.error,
    durationMs: row.duration_ms,
    triggeredBy: row.triggered_by === 'run-now' ? 'run-now' : 'tick',
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScheduleUpsertInput {
  pluginId: string
  scheduleId: string
  cadence: Cadence
  overlap: OverlapPolicy
  maxDurationMs: number
  nextRunAt: string
}

/**
 * Insert or update a schedule. Called when the plugin's `activate` hook
 * runs `api.cms.schedule.register(...)` — re-activation MUST overwrite
 * cadence + maxDurationMs (the plugin code is the source of truth) but
 * MUST preserve last-run state so a restart doesn't lose history or
 * re-fire schedules that already ran.
 */
export async function upsertPluginSchedule(
  db: DbClient,
  input: ScheduleUpsertInput,
): Promise<void> {
  const cadenceJson = JSON.stringify(input.cadence)
  await db`
    insert into plugin_schedules (
      plugin_id, schedule_id, cadence_json, overlap, max_duration_ms,
      enabled, next_run_at, claimed_at, created_at, updated_at
    )
    values (
      ${input.pluginId}, ${input.scheduleId}, ${cadenceJson}, ${input.overlap}, ${input.maxDurationMs},
      ${true}, ${input.nextRunAt}, ${new Date().toISOString()}, ${new Date().toISOString()}, ${new Date().toISOString()}
    )
    on conflict (plugin_id, schedule_id) do update set
      cadence_json = excluded.cadence_json,
      overlap = excluded.overlap,
      max_duration_ms = excluded.max_duration_ms,
      enabled = ${true},
      next_run_at = excluded.next_run_at,
      claimed_at = excluded.claimed_at,
      updated_at = excluded.updated_at
  `
}

/**
 * Cancel a previously-registered schedule. Soft-disables the row so the
 * tick stops firing it; the row stays for audit. The plugin's `activate`
 * call re-creates / re-enables on next boot if the registration is still
 * there.
 */
export async function disablePluginSchedule(
  db: DbClient,
  pluginId: string,
  scheduleId: string,
): Promise<void> {
  await db`
    update plugin_schedules
    set enabled = ${false}, updated_at = ${new Date().toISOString()}
    where plugin_id = ${pluginId} and schedule_id = ${scheduleId}
  `
}

export async function enablePluginSchedule(
  db: DbClient,
  pluginId: string,
  scheduleId: string,
): Promise<void> {
  await db`
    update plugin_schedules
    set enabled = ${true}, consecutive_failures = ${0}, updated_at = ${new Date().toISOString()}
    where plugin_id = ${pluginId} and schedule_id = ${scheduleId}
  `
}

export async function listSchedulesForPlugin(
  db: DbClient,
  pluginId: string,
): Promise<PluginSchedule[]> {
  const { rows } = await db<ScheduleRow>`
    select * from plugin_schedules
    where plugin_id = ${pluginId}
    order by schedule_id asc
  `
  return rows.map(mapSchedule)
}

export async function getSchedule(
  db: DbClient,
  pluginId: string,
  scheduleId: string,
): Promise<PluginSchedule | null> {
  const { rows } = await db<ScheduleRow>`
    select * from plugin_schedules
    where plugin_id = ${pluginId} and schedule_id = ${scheduleId}
    limit 1
  `
  return rows[0] ? mapSchedule(rows[0]) : null
}

/**
 * Select up to N schedules ready to fire NOW. The scheduler tick calls
 * this then attempts to claim each via `tryClaimSchedule` — the two-step
 * dance is what lets multiple HA instances safely race for the same row
 * without firing twice.
 */
export async function selectDueSchedules(
  db: DbClient,
  nowIso: string,
  limit: number,
): Promise<PluginSchedule[]> {
  const { rows } = await db<ScheduleRow>`
    select * from plugin_schedules
    where enabled = ${true}
      and next_run_at <= ${nowIso}
      and (lock_until is null or lock_until <= ${nowIso})
    order by next_run_at asc
    limit ${limit}
  `
  return rows.map(mapSchedule)
}

/**
 * Atomically reserve a schedule for THIS tick. Returns true if we won the
 * race and may fire the handler; false if another tick (or another HA
 * instance) already claimed it. The lock auto-expires after
 * `maxDurationMs * 2` so a crashed scheduler tick can't permanently
 * deadlock a schedule.
 *
 * The `running_token = null` precondition is what makes this safe across
 * HA instances: only ONE UPDATE statement can transition the token from
 * null to a fresh value because Postgres + SQLite both serialize row
 * updates.
 */
export async function tryClaimSchedule(
  db: DbClient,
  pluginId: string,
  scheduleId: string,
  token: string,
  lockUntilIso: string,
  nowIso: string,
): Promise<boolean> {
  const result = await db`
    update plugin_schedules
    set running_token = ${token}, lock_until = ${lockUntilIso}, updated_at = ${nowIso}
    where plugin_id = ${pluginId}
      and schedule_id = ${scheduleId}
      and (running_token is null or (lock_until is not null and lock_until <= ${nowIso}))
      and enabled = ${true}
  `
  return result.rowCount > 0
}

/** Release the lock and record the run's outcome. Called once per fire. */
export async function recordScheduleRunOutcome(
  db: DbClient,
  args: {
    pluginId: string
    scheduleId: string
    token: string
    nowIso: string
    status: ScheduleStatus
    error: string | null
    durationMs: number
    nextRunAt: string
    resetFailures: boolean
  },
): Promise<void> {
  if (args.resetFailures) {
    await db`
      update plugin_schedules
      set running_token = null,
          lock_until = null,
          last_run_at = coalesce(last_run_at, ${args.nowIso}),
          last_finished_at = ${args.nowIso},
          last_status = ${args.status},
          last_error = ${args.error},
          last_duration_ms = ${args.durationMs},
          next_run_at = ${args.nextRunAt},
          consecutive_failures = ${0},
          updated_at = ${args.nowIso}
      where plugin_id = ${args.pluginId}
        and schedule_id = ${args.scheduleId}
        and running_token = ${args.token}
    `
    return
  }
  await db`
    update plugin_schedules
    set running_token = null,
        lock_until = null,
        last_finished_at = ${args.nowIso},
        last_status = ${args.status},
        last_error = ${args.error},
        last_duration_ms = ${args.durationMs},
        next_run_at = ${args.nextRunAt},
        consecutive_failures = consecutive_failures + ${1},
        updated_at = ${args.nowIso}
    where plugin_id = ${args.pluginId}
      and schedule_id = ${args.scheduleId}
      and running_token = ${args.token}
  `
}

/**
 * Mark the schedule's "started running" state — separate from
 * `recordScheduleRunOutcome` so we can stamp `last_run_at` BEFORE
 * the handler completes. Lets the admin UI show "running now" even
 * for long-running jobs.
 */
export async function markScheduleRunStarted(
  db: DbClient,
  pluginId: string,
  scheduleId: string,
  startedAtIso: string,
): Promise<void> {
  await db`
    update plugin_schedules
    set last_run_at = ${startedAtIso}, updated_at = ${startedAtIso}
    where plugin_id = ${pluginId} and schedule_id = ${scheduleId}
  `
}

/**
 * Pause a schedule that exceeded the consecutive-failure cap. The
 * schedule's row stays but enabled=false; the admin operator must
 * manually resume after fixing the cause.
 */
export async function pauseSchedule(
  db: DbClient,
  pluginId: string,
  scheduleId: string,
  reasonIso: string,
): Promise<void> {
  await db`
    update plugin_schedules
    set enabled = ${false}, updated_at = ${reasonIso}
    where plugin_id = ${pluginId} and schedule_id = ${scheduleId}
  `
}

// ---------------------------------------------------------------------------
// Run history
// ---------------------------------------------------------------------------

export async function insertScheduleRun(
  db: DbClient,
  run: {
    id: string
    pluginId: string
    scheduleId: string
    startedAt: string
    triggeredBy: 'tick' | 'run-now'
  },
): Promise<void> {
  await db`
    insert into plugin_schedule_runs (
      id, plugin_id, schedule_id, started_at, status, triggered_by
    )
    values (
      ${run.id}, ${run.pluginId}, ${run.scheduleId}, ${run.startedAt}, ${'never_run'}, ${run.triggeredBy}
    )
  `
}

export async function finalizeScheduleRun(
  db: DbClient,
  runId: string,
  outcome: { finishedAt: string; status: ScheduleStatus; error: string | null; durationMs: number },
): Promise<void> {
  await db`
    update plugin_schedule_runs
    set finished_at = ${outcome.finishedAt},
        status = ${outcome.status},
        error = ${outcome.error},
        duration_ms = ${outcome.durationMs}
    where id = ${runId}
  `
}

export async function listRecentRuns(
  db: DbClient,
  pluginId: string,
  scheduleId: string,
  limit = 20,
): Promise<PluginScheduleRun[]> {
  const { rows } = await db<ScheduleRunRow>`
    select * from plugin_schedule_runs
    where plugin_id = ${pluginId} and schedule_id = ${scheduleId}
    order by started_at desc
    limit ${limit}
  `
  return rows.map(mapRun)
}

/**
 * Trim history beyond `keepPerSchedule` entries per (plugin_id,
 * schedule_id). Called occasionally by the tick — not every iteration —
 * to bound storage without blocking the hot path.
 */
export async function trimScheduleRunHistory(
  db: DbClient,
  keepPerSchedule = 200,
): Promise<void> {
  // Two-step: pick the per-group cutoff timestamp, then delete older rows
  // within each group. ANSI-standard subquery, dialect-naive — works on
  // both Postgres and SQLite.
  await db`
    delete from plugin_schedule_runs
    where id in (
      select r.id from plugin_schedule_runs r
      where r.started_at < (
        select min(t.started_at) from (
          select started_at from plugin_schedule_runs
          where plugin_id = r.plugin_id and schedule_id = r.schedule_id
          order by started_at desc
          limit ${keepPerSchedule}
        ) t
      )
    )
  `
}
