/**
 * RoleDialog — create / edit / view modal for CMS roles.
 *
 * `mode === 'view'` is read-only: every input is `disabled`, the submit
 * button is omitted, and the cancel button reads "Close". `'create'` and
 * `'edit'` share the same form layout and submit through `onSubmit`.
 *
 * The capability picker groups every CMS capability into the visual
 * sections defined by `CAPABILITY_GROUPS`. Each group has "All" / "Clear"
 * shortcut buttons that toggle every capability in the group at once via
 * `onSetCapabilityGroup`. The "Clear" button only appears when at least
 * one capability in that group is currently selected.
 */
import { useId, type FormEvent } from 'react'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { Dialog } from '@ui/components/Dialog'
import { Input } from '@ui/components/Input'
import { SaveSolidIcon } from 'pixel-art-icons/icons/save-solid'
import dialogStyles from '../../../shared/dialogs/SiteCreateDialog/SiteCreateDialog.module.css'
import styles from '../UsersPage.module.css'
import type { CapabilityGroup, RoleDialogMode, RoleFormState } from '../types'
import { CAPABILITY_GROUPS } from '../utils/capabilities'

interface RoleDialogProps {
  mode: RoleDialogMode
  form: RoleFormState
  busy: boolean
  error: string | null
  onChange: (form: RoleFormState) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onToggleCapability: (capability: string, checked: boolean) => void
  onSetCapabilityGroup: (group: CapabilityGroup, checked: boolean) => void
}

const ROLE_FORM_ID = 'users-page-role-form'

export function RoleDialog({
  mode,
  form,
  busy,
  error,
  onChange,
  onClose,
  onSubmit,
  onToggleCapability,
  onSetCapabilityGroup,
}: RoleDialogProps) {
  const title = mode === 'create' ? 'Create Role' : mode === 'edit' ? 'Edit Role' : 'View Role'
  const readonly = mode === 'view'
  const selectedCapabilities = new Set(form.capabilities)
  const nameId = useId()
  const slugId = useId()
  const descriptionId = useId()
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      size="xl"
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            <span>{readonly ? 'Close' : 'Cancel'}</span>
          </Button>
          {!readonly && (
            <Button type="submit" form={ROLE_FORM_ID} variant="primary" size="sm" disabled={busy}>
              <SaveSolidIcon size={14} aria-hidden="true" />
              <span>{mode === 'create' ? 'Create Role' : 'Save Role'}</span>
            </Button>
          )}
        </>
      }
    >
      <form id={ROLE_FORM_ID} className={dialogStyles.form} onSubmit={(event) => void onSubmit(event)}>
        <div className={dialogStyles.field}>
          <label htmlFor={nameId} className={dialogStyles.label}>Name</label>
          <Input
            id={nameId}
            value={form.name}
            required
            disabled={readonly}
            onChange={(event) => onChange({ ...form, name: event.currentTarget.value })}
          />
        </div>
        <div className={dialogStyles.field}>
          <label htmlFor={slugId} className={dialogStyles.label}>Slug</label>
          <Input
            id={slugId}
            value={form.slug}
            disabled={readonly}
            onChange={(event) => onChange({ ...form, slug: event.currentTarget.value })}
          />
        </div>
        <div className={dialogStyles.field}>
          <label htmlFor={descriptionId} className={dialogStyles.label}>Description</label>
          <Input
            id={descriptionId}
            value={form.description}
            disabled={readonly}
            onChange={(event) => onChange({ ...form, description: event.currentTarget.value })}
          />
        </div>
        <div className={styles.capabilityPicker}>
          {CAPABILITY_GROUPS.map((group) => {
            const selectedCount = group.capabilities.filter((capability) => selectedCapabilities.has(capability)).length
            return (
              <section key={group.title} className={styles.capabilityGroup}>
                <div className={styles.capabilityGroupHeader}>
                  <h3>{group.title}</h3>
                  {!readonly && (
                    <div className={styles.groupActions}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-label={`Select all ${group.title} capabilities`}
                        onClick={() => onSetCapabilityGroup(group, true)}
                      >
                        <span>All</span>
                      </Button>
                      {selectedCount > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-label={`Clear ${group.title} capabilities`}
                          onClick={() => onSetCapabilityGroup(group, false)}
                        >
                          <span>Clear</span>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <div className={styles.capabilities}>
                  {group.capabilities.map((capability) => (
                    <label key={capability}>
                      <Checkbox
                        checked={form.capabilities.includes(capability)}
                        disabled={readonly}
                        onCheckedChange={(checked) => onToggleCapability(capability, checked)}
                      />
                      <span>{capability}</span>
                    </label>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
        {error && <p role="alert" className={dialogStyles.errorText}>{error}</p>}
      </form>
    </Dialog>
  )
}
