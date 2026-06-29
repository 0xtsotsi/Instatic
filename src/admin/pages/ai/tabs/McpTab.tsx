/**
 * MCP tab — create, list, and revoke MCP connectors.
 *
 * A connector lets an external MCP client (Claude Code, Codex, a remote agent)
 * connect to this instance and operate the CMS tools, exactly as the built-in
 * AI panel does. The bearer token is shown ONCE on creation; only its hash is
 * stored server-side. Capabilities offered are filtered to those the current
 * admin holds — you cannot mint a connector more powerful than yourself.
 */
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { useAsyncResource } from '@admin/lib/useAsyncResource'
import { useCurrentAdminUser } from '@admin/sessionContext'
import { hasCapability } from '@admin/access'
import { Button } from '@ui/components/Button'
import { Dialog } from '@ui/components/Dialog'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { Checkbox } from '@ui/components/Checkbox'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { TrashSolidIcon } from 'pixel-art-icons/icons/trash-solid'
import { ApiError } from '@core/http'
import { getErrorMessage } from '@core/utils/errorMessage'
import type { CoreCapability } from '@core/capabilities'
import type { McpConnectorView, McpConnectorType, CreateMcpConnectorResult } from '@core/ai'
import {
  listMcpConnectors,
  createMcpConnector,
  revokeMcpConnector,
} from '../../../ai/api'
import styles from '../AiPage.module.css'
import mcpStyles from './McpTab.module.css'

// MCP-relevant capabilities, grouped read vs. write. Each connector is gated
// against these through the same engine the built-in agent uses, so the list
// mirrors what the tools actually check.
interface CapabilityOption {
  cap: CoreCapability
  label: string
  write: boolean
}

const CAPABILITY_OPTIONS: readonly CapabilityOption[] = [
  { cap: 'site.read', label: 'Read site structure & pages', write: false },
  { cap: 'content.manage', label: 'Read content (pages, posts, data, media)', write: false },
  { cap: 'data.custom.tables.read', label: 'Read custom data tables', write: false },
  { cap: 'media.read', label: 'Read media library', write: false },
  { cap: 'ai.tools.write', label: 'Allow write operations (required to edit anything)', write: true },
  { cap: 'site.structure.edit', label: 'Edit page structure (add / move / delete nodes)', write: true },
  { cap: 'site.content.edit', label: 'Edit node content & properties', write: true },
  { cap: 'site.style.edit', label: 'Edit node styles', write: true },
  { cap: 'content.create', label: 'Create content entries', write: true },
  { cap: 'content.edit.any', label: 'Edit any content entry', write: true },
  { cap: 'media.write', label: 'Upload media', write: true },
]

const READ_ONLY_CAPS = CAPABILITY_OPTIONS.filter((o) => !o.write).map((o) => o.cap)

const TYPE_OPTIONS: Array<{ value: McpConnectorType; label: string }> = [
  { value: 'local', label: 'Local (Claude Code, Codex, Cursor)' },
  { value: 'remote', label: 'Remote (hosted endpoint for remote agents)' },
]

async function revokeConnectorAction(
  id: string,
  setBusyIds: (updater: (prev: Set<string>) => Set<string>) => void,
  setActionError: (error: string | null) => void,
  refresh: () => void,
): Promise<void> {
  setBusyIds((prev) => new Set(prev).add(id))
  try {
    await revokeMcpConnector(id)
    setActionError(null)
    refresh()
  } catch (err) {
    setActionError(getErrorMessage(err, 'Failed to revoke connector.'))
  } finally {
    setBusyIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }
}

export function McpTab() {
  const {
    data: loaded,
    loading,
    error: loadError,
    refresh,
  } = useAsyncResource(() => listMcpConnectors(), [], {
    fallbackError: 'Failed to load connectors.',
  })
  const connectors: McpConnectorView[] = loaded ?? []
  const [showDialog, setShowDialog] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const error = loadError ?? actionError

  async function handleRevoke(id: string) {
    await revokeConnectorAction(id, setBusyIds, setActionError, refresh)
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>MCP connectors</h2>
          <p>
            Let external AI clients (Claude Code, Codex, remote agents) operate this site over the
            Model Context Protocol. Tokens are shown once and stored hashed.
          </p>
        </div>
        <Button type="button" variant="primary" size="sm" onClick={() => setShowDialog(true)}>
          <PlusIcon size={14} aria-hidden="true" />
          <span>Add connector</span>
        </Button>
      </div>

      {error && <p role="alert" className={styles.errorAlert}>{error}</p>}

      {loading ? (
        <div className={styles.emptyState}>Loading…</div>
      ) : connectors.length === 0 ? (
        <div className={styles.emptyState}>
          No connectors yet. Add one to let an AI client connect to this instance.
        </div>
      ) : (
        <div className={styles.credentialGrid}>
          {connectors.map((connector) => {
            const isBusy = busyIds.has(connector.id)
            return (
              <div key={connector.id} className={styles.credentialCard}>
                <div className={styles.credentialIdentity}>
                  <div className={styles.credentialLabel}>{connector.label}</div>
                  <div className={styles.credentialMeta}>
                    <span>{connector.type === 'local' ? 'Local' : 'Remote'}</span>
                    <span>·</span>
                    <span>{connector.capabilities.length} capabilities</span>
                    {connector.revoked && (
                      <>
                        <span>·</span>
                        <span className={`${styles.statusBadge} ${styles.danger}`}>Revoked</span>
                      </>
                    )}
                    {connector.lastUsedAt && (
                      <>
                        <span>·</span>
                        <span>Last used {new Date(connector.lastUsedAt).toLocaleString()}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className={styles.credentialActions}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleRevoke(connector.id)}
                    disabled={isBusy || connector.revoked}
                    title={connector.revoked ? 'Already revoked' : undefined}
                  >
                    <TrashSolidIcon size={14} aria-hidden="true" />
                    <span>{connector.revoked ? 'Revoked' : 'Revoke'}</span>
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showDialog && (
        <AddConnectorDialog
          onClose={() => setShowDialog(false)}
          onCreated={() => {
            setActionError(null)
            refresh()
          }}
        />
      )}
    </section>
  )
}

function AddConnectorDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const labelInputId = useId()
  const typeInputId = useId()
  const formId = useId()
  const currentUser = useCurrentAdminUser()
  // Offer only capabilities the current admin actually holds (or all, for the
  // unrestricted dev/owner session where currentUser is null).
  const grantable = CAPABILITY_OPTIONS.filter(
    (o) => !currentUser || hasCapability(currentUser, o.cap),
  )

  const [label, setLabel] = useState('')
  const [type, setType] = useState<McpConnectorType>('local')
  const [selected, setSelected] = useState<Set<CoreCapability>>(
    () => new Set(grantable.filter((o) => READ_ONLY_CAPS.includes(o.cap)).map((o) => o.cap)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreateMcpConnectorResult | null>(null)

  function toggle(cap: CoreCapability) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(cap)) next.delete(cap)
      else next.add(cap)
      return next
    })
  }

  function selectPreset(caps: readonly CoreCapability[]) {
    setSelected(new Set(grantable.filter((o) => caps.includes(o.cap)).map((o) => o.cap)))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      // `ai.chat` marks the connector as an AI caller, mirroring the built-in
      // panel. Always granted when the admin holds it.
      const capabilities = [...selected]
      if ((!currentUser || hasCapability(currentUser, 'ai.chat')) && !capabilities.includes('ai.chat')) {
        capabilities.push('ai.chat')
      }
      const result = await createMcpConnector({ label, type, capabilities })
      setCreated(result)
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : getErrorMessage(err, 'Failed to create connector.'))
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <TokenResultDialog result={created} onClose={onClose} />
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add MCP connector"
      size="md"
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            <span>Cancel</span>
          </Button>
          <Button type="submit" form={formId} variant="primary" size="sm" disabled={busy || selected.size === 0}>
            <PlusIcon size={14} aria-hidden="true" />
            <span>Create connector</span>
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.dialogForm} onSubmit={(e) => void handleSubmit(e)}>
        <div className={styles.dialogField}>
          <label htmlFor={labelInputId} className={styles.dialogFieldLabel}>Label</label>
          <Input
            id={labelInputId}
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            placeholder="e.g. My laptop (Claude Code)"
            required
          />
        </div>

        <div className={styles.dialogField}>
          <label htmlFor={typeInputId} className={styles.dialogFieldLabel}>Type</label>
          <Select
            id={typeInputId}
            value={type}
            onChange={(e) => setType(e.currentTarget.value as McpConnectorType)}
            options={TYPE_OPTIONS}
          />
        </div>

        <div className={styles.dialogField}>
          <div className={mcpStyles.capabilityHeader}>
            <span className={styles.dialogFieldLabel}>Capabilities</span>
            <div className={mcpStyles.presetButtons}>
              <Button type="button" variant="ghost" size="sm" onClick={() => selectPreset(READ_ONLY_CAPS)}>
                <span>Read-only</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => selectPreset(grantable.map((o) => o.cap))}
              >
                <span>Select all</span>
              </Button>
            </div>
          </div>
          <ul className={mcpStyles.capabilityList}>
            {grantable.map((option) => (
              <li key={option.cap} className={mcpStyles.capabilityItem}>
                <label className={mcpStyles.capabilityLabel}>
                  <Checkbox
                    checked={selected.has(option.cap)}
                    onCheckedChange={() => toggle(option.cap)}
                    boxSize="sm"
                  />
                  <span>{option.label}</span>
                  {option.write && <span className={mcpStyles.writeBadge}>write</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>

        {error && <p role="alert" className={styles.dialogError}>{error}</p>}
      </form>
    </Dialog>
  )
}

function TokenResultDialog({
  result,
  onClose,
}: {
  result: CreateMcpConnectorResult
  onClose: () => void
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const endpoint = `${origin}/_instatic/mcp`
  const claudeCommand = `claude mcp add instatic --transport http ${endpoint} --header "Authorization: Bearer ${result.token}"`

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
    } catch (err) {
      console.error('[McpTab] clipboard write failed:', err)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Connector created"
      size="md"
      footer={
        <Button type="button" variant="primary" size="sm" onClick={onClose}>
          <span>Done</span>
        </Button>
      }
    >
      <div className={mcpStyles.tokenBody}>
        <p role="status" className={mcpStyles.tokenNotice}>
          Copy this token now. It will not be shown again.
        </p>

        <div className={styles.dialogField}>
          <span className={styles.dialogFieldLabel}>Token</span>
          <div className={mcpStyles.copyRow}>
            <code className={mcpStyles.codeBlock}>{result.token}</code>
            <Button type="button" variant="secondary" size="sm" onClick={() => void copy(result.token, 'token')}>
              <span>{copied === 'token' ? 'Copied' : 'Copy'}</span>
            </Button>
          </div>
        </div>

        {result.connector.type === 'local' ? (
          <div className={styles.dialogField}>
            <span className={styles.dialogFieldLabel}>Add to Claude Code / Codex</span>
            <div className={mcpStyles.copyRow}>
              <code className={mcpStyles.codeBlock}>{claudeCommand}</code>
              <Button type="button" variant="secondary" size="sm" onClick={() => void copy(claudeCommand, 'cmd')}>
                <span>{copied === 'cmd' ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.dialogField}>
            <span className={styles.dialogFieldLabel}>Endpoint</span>
            <div className={mcpStyles.copyRow}>
              <code className={mcpStyles.codeBlock}>{endpoint}</code>
              <Button type="button" variant="secondary" size="sm" onClick={() => void copy(endpoint, 'url')}>
                <span>{copied === 'url' ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
            <p className={styles.secondaryText}>
              Send the token as an <code>Authorization: Bearer</code> header. ChatGPT/Gemini managed
              connectors require OAuth (coming soon); the token works today with Claude, Cursor, and
              custom remote agents.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
