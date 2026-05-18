/**
 * PermissionReviewSection — pre-install / pre-upgrade permission consent UI.
 *
 * For a fresh install: lists every requested permission with its label
 * and description.
 *
 * For an upgrade: computes the diff against the previously-granted set
 * and renders three status classes:
 *
 *   • new      — listed first with a "NEW" badge + warning tint. These
 *                are the permissions a malicious upgrade would slip in
 *                without notice if we silently re-approved everything.
 *                The user MUST see and consciously approve them.
 *   • existing — already approved on the prior install. Shown for full
 *                context but visually de-emphasised.
 *   • dropped  — previously granted but not requested by the new manifest;
 *                the host will auto-revoke them. Shown as informational.
 *
 * If the upgrade adds zero new permissions, we render a quick reassurance
 * banner ("No new permissions in this update") so the user can confirm
 * with confidence.
 */
import { Button } from '@ui/components/Button'
import {
  permissionDescription,
  type PluginManifest,
  type PluginPermission,
} from '@core/plugin-sdk'
import { permissionLabel } from '@core/plugins/manifest'
import {
  computePermissionDiff,
  type PermissionDiffRow,
  type PermissionDiffStatus,
} from './computePermissionDiff'
import styles from './PermissionReviewSection.module.css'

interface PermissionReviewPending {
  manifest: PluginManifest
  upgradeFromVersion?: string
  previouslyGrantedPermissions?: PluginPermission[]
}

interface PermissionReviewSectionProps {
  pending: PermissionReviewPending
  uploading: boolean
  onCancel: () => void
  onConfirm: () => void
}

function statusBadgeClass(status: PermissionDiffStatus): string {
  if (status === 'new') return styles.badgeNew
  if (status === 'existing') return styles.badgeExisting
  return styles.badgeDropped
}

function statusBadgeLabel(status: PermissionDiffStatus): string {
  if (status === 'new') return 'New'
  if (status === 'existing') return 'Already approved'
  return 'No longer requested'
}

export function PermissionReviewSection({
  pending,
  uploading,
  onCancel,
  onConfirm,
}: PermissionReviewSectionProps) {
  const isUpgrade = Boolean(pending.upgradeFromVersion)
  const rows: PermissionDiffRow[] = isUpgrade
    ? computePermissionDiff(
        pending.manifest.permissions,
        pending.previouslyGrantedPermissions,
      )
    : pending.manifest.permissions.map<PermissionDiffRow>((permission) => ({
        permission,
        // For fresh installs we still annotate "new" so the row styling
        // shows up consistently — but don't show the "Already approved"
        // / "No longer requested" branches that don't apply.
        status: 'new',
      }))

  const newCount = rows.filter((row) => row.status === 'new').length

  return (
    <section
      className={styles.review}
      aria-labelledby="plugin-permissions-title"
    >
      <div>
        <h2 id="plugin-permissions-title">
          {isUpgrade
            ? `Update ${pending.manifest.name}`
            : 'Approve Plugin Permissions'}
        </h2>
        <p>
          {isUpgrade
            ? `Updating from ${pending.upgradeFromVersion} to ${pending.manifest.version}. Existing settings and stored data are preserved; the plugin runs its migrate hook before re-activating.`
            : `${pending.manifest.name} requests access before activation.`}
        </p>
      </div>

      {isUpgrade && newCount > 0 && (
        <div className={styles.alert} role="alert" data-testid="permission-diff-alert">
          This update requests <strong>{newCount} new permission{newCount === 1 ? '' : 's'}</strong>.
          Review the highlighted rows below before continuing.
        </div>
      )}

      {isUpgrade && newCount === 0 && rows.length > 0 && (
        <div className={styles.alert} role="status" data-testid="permission-diff-noop">
          No new permissions in this update.
        </div>
      )}

      {rows.length > 0 && (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li
              key={`${row.permission}:${row.status}`}
              className={styles.row}
              data-status={row.status}
              data-permission={row.permission}
            >
              <div className={styles.label}>
                <strong>{permissionLabel(row.permission)}</strong>
                {isUpgrade && (
                  <span className={`${styles.badge} ${statusBadgeClass(row.status)}`}>
                    {statusBadgeLabel(row.status)}
                  </span>
                )}
              </div>
              <span className={styles.description}>
                {permissionDescription(row.permission)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancel}
        >
          <span>Cancel</span>
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={uploading}
          onClick={onConfirm}
        >
          <span>
            {uploading
              ? isUpgrade
                ? 'Updating'
                : 'Installing'
              : isUpgrade
                ? newCount > 0
                  ? `Approve ${newCount} new and update to ${pending.manifest.version}`
                  : `Update to ${pending.manifest.version}`
                : 'Approve and Install'}
          </span>
        </Button>
      </div>
    </section>
  )
}
