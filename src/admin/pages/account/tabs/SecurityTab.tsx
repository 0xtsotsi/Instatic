import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import type { CmsCurrentUser } from '@core/persistence'
import {
  changeCurrentUserPassword,
  disableCurrentUserTotp,
  enableCurrentUserTotp,
  regenerateCurrentUserRecoveryCodes,
  startCurrentUserTotpSetup,
} from '@core/persistence'
import { Button } from '@ui/components/Button'
import { Dialog } from '@ui/components/Dialog'
import { Input } from '@ui/components/Input'
import { CopySolidIcon } from 'pixel-art-icons/icons/copy-solid'
import { useAdminSessionSetter } from '@admin/sessionContext'
import { StepUpCancelledMessage, useStepUp } from '@admin/shared/StepUp'
import styles from '../AccountPage.module.css'

interface SecurityTabProps {
  user: CmsCurrentUser
}

interface SecurityCardProps {
  title: string
  description: string
  status: string
  statusActive?: boolean
  action: ReactNode
  testId: string
}

interface TotpSetup {
  secret: string
  otpauthUrl: string
}

interface TotpQrCode {
  otpauthUrl: string
  dataUrl: string
}

interface TotpQrError {
  otpauthUrl: string
  message: string
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString()
}

function SecurityCard({
  title,
  description,
  status,
  statusActive = false,
  action,
  testId,
}: SecurityCardProps) {
  return (
    <div className={styles.card} data-testid={testId}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>{title}</h3>
          <p className={styles.cardDesc}>{description}</p>
        </div>
        <div className={styles.cardActions}>{action}</div>
      </div>
      <p
        className={
          statusActive
            ? `${styles.cardStatus} ${styles.cardStatusActive}`
            : styles.cardStatus
        }
        role="status"
      >
        {status}
      </p>
    </div>
  )
}

export function SecurityTab({ user }: SecurityTabProps) {
  const { runStepUp } = useStepUp()
  const setSessionUser = useAdminSessionSetter()
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [totpSetup, setTotpSetup] = useState<TotpSetup | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [totpQrCode, setTotpQrCode] = useState<TotpQrCode | null>(null)
  const [totpQrError, setTotpQrError] = useState<TotpQrError | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [mfaError, setMfaError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const newPasswordId = useId()
  const confirmPasswordId = useId()
  const totpCodeId = useId()

  const passwordStatus = user.passwordUpdatedAt
    ? `Last changed: ${formatDateTime(user.passwordUpdatedAt)}`
    : user.lastLoginAt
      ? `Last login: ${formatDateTime(user.lastLoginAt)}`
      : 'Password has not been used yet.'

  const mfaStatus = user.mfaEnabled
    ? `On${user.mfaEnabledAt ? ` since ${formatDateTime(user.mfaEnabledAt)}` : ''}`
    : 'Off'

  const recoveryStatus = user.mfaEnabled
    ? `${user.mfaRecoveryCodesRemaining} recovery ${user.mfaRecoveryCodesRemaining === 1 ? 'code' : 'codes'} remaining.`
    : 'Enable two-factor authentication before generating recovery codes.'
  const currentTotpQrDataUrl =
    totpSetup && totpQrCode?.otpauthUrl === totpSetup.otpauthUrl ? totpQrCode.dataUrl : null
  const currentTotpQrError =
    totpSetup && totpQrError?.otpauthUrl === totpSetup.otpauthUrl ? totpQrError.message : null

  useEffect(() => {
    if (!totpSetup) return undefined

    const setup = totpSetup
    let cancelled = false

    async function renderQrCode(): Promise<void> {
      try {
        const { toString } = await import('qrcode')
        const svg = await toString(setup.otpauthUrl, {
          type: 'svg',
          margin: 2,
          errorCorrectionLevel: 'M',
          width: 224,
          color: {
            dark: '#000000ff',
            light: '#ffffffff',
          },
        })
        if (!cancelled) {
          setTotpQrCode({
            otpauthUrl: setup.otpauthUrl,
            dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          })
        }
      } catch (err) {
        console.error('[account-security] QR code generation failed:', err)
        if (!cancelled) {
          setTotpQrError({
            otpauthUrl: setup.otpauthUrl,
            message: 'Could not render the QR code. Use the setup key instead.',
          })
        }
      }
    }

    void renderQrCode()
    return () => { cancelled = true }
  }, [totpSetup])

  function resetPasswordDialog(): void {
    setPasswordOpen(false)
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError(null)
  }

  function resetTotpDialog(): void {
    setTotpSetup(null)
    setTotpCode('')
    setMfaError(null)
    setTotpQrCode(null)
    setTotpQrError(null)
    setSecretCopied(false)
  }

  function stepUpCancelled(err: unknown): boolean {
    return err instanceof Error && err.message === StepUpCancelledMessage
  }

  async function handleCopySecret(): Promise<void> {
    if (!totpSetup) return
    setMfaError(null)
    if (!navigator.clipboard?.writeText) {
      setMfaError('Clipboard is not available in this browser.')
      return
    }

    try {
      await navigator.clipboard.writeText(totpSetup.secret)
      setSecretCopied(true)
    } catch (err) {
      console.error('[account-security] Copy MFA setup key failed:', err)
      setMfaError('Could not copy the setup key.')
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy) return
    setPasswordError(null)
    setError(null)
    setStatus(null)
    if (newPassword.length < 12) {
      setPasswordError('Password must be at least 12 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }
    setBusy('password')
    try {
      const updated = await runStepUp(() => changeCurrentUserPassword({ newPassword }))
      setSessionUser(updated)
      resetPasswordDialog()
      setStatus('Password updated. Other devices were signed out.')
    } catch (err) {
      if (!stepUpCancelled(err)) {
        setPasswordError(err instanceof Error ? err.message : 'Could not update password.')
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleStartMfa(): Promise<void> {
    if (busy) return
    setBusy('mfa-start')
    setError(null)
    setMfaError(null)
    setStatus(null)
    try {
      const setup = await runStepUp(() => startCurrentUserTotpSetup())
      setTotpQrCode(null)
      setTotpQrError(null)
      setSecretCopied(false)
      setTotpSetup(setup)
      setTotpCode('')
    } catch (err) {
      if (!stepUpCancelled(err)) {
        setError(err instanceof Error ? err.message : 'Could not start MFA setup.')
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleEnableMfa(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy || !totpSetup) return
    setBusy('mfa-enable')
    setMfaError(null)
    setError(null)
    setStatus(null)
    try {
      const result = await runStepUp(() =>
        enableCurrentUserTotp({ secret: totpSetup.secret, code: totpCode }),
      )
      setSessionUser(result.user)
      resetTotpDialog()
      setRecoveryCodes(result.recoveryCodes)
      setStatus('Two-factor authentication enabled.')
    } catch (err) {
      if (!stepUpCancelled(err)) {
        setMfaError(err instanceof Error ? err.message : 'Could not enable MFA.')
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleDisableMfa(): Promise<void> {
    if (busy) return
    setBusy('mfa-disable')
    setError(null)
    setStatus(null)
    try {
      const updated = await runStepUp(() => disableCurrentUserTotp())
      setSessionUser(updated)
      setRecoveryCodes([])
      setStatus('Two-factor authentication disabled.')
    } catch (err) {
      if (!stepUpCancelled(err)) {
        setError(err instanceof Error ? err.message : 'Could not disable MFA.')
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleRegenerateRecoveryCodes(): Promise<void> {
    if (busy || !user.mfaEnabled) return
    setBusy('recovery')
    setError(null)
    setStatus(null)
    try {
      const result = await runStepUp(() => regenerateCurrentUserRecoveryCodes())
      setSessionUser(result.user)
      setRecoveryCodes(result.recoveryCodes)
      setStatus('Recovery codes regenerated.')
    } catch (err) {
      if (!stepUpCancelled(err)) {
        setError(err instanceof Error ? err.message : 'Could not regenerate recovery codes.')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={styles.section} aria-labelledby="account-security-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="account-security-title">Security</h2>
          <p>Password, two-factor authentication, and connected sign-ins.</p>
        </div>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {status && <p className={styles.cardStatus} role="status">{status}</p>}

      <div className={styles.cards}>
        <SecurityCard
          testId="security-password-card"
          title="Password"
          description="Change your password. Other devices are signed out after a successful update."
          status={passwordStatus}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => setPasswordOpen(true)}
              data-testid="security-change-password"
            >
              <span>Change password</span>
            </Button>
          }
        />
        <SecurityCard
          testId="security-mfa-card"
          title="Two-factor authentication"
          description="Use a TOTP authenticator app as a second factor when signing in."
          status={mfaStatus}
          statusActive={user.mfaEnabled}
          action={
            user.mfaEnabled ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => void handleDisableMfa()}
                data-testid="security-mfa-disable"
              >
                <span>{busy === 'mfa-disable' ? 'Disabling…' : 'Disable'}</span>
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => void handleStartMfa()}
                data-testid="security-mfa-enable"
              >
                <span>{busy === 'mfa-start' ? 'Starting…' : 'Enable'}</span>
              </Button>
            )
          }
        />
        <SecurityCard
          testId="security-recovery-card"
          title="Recovery codes"
          description="One-time codes you can use if you lose access to your authenticator app."
          status={recoveryStatus}
          statusActive={user.mfaEnabled && user.mfaRecoveryCodesRemaining > 0}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy !== null || !user.mfaEnabled}
              onClick={() => void handleRegenerateRecoveryCodes()}
              data-testid="security-recovery-regenerate"
            >
              <span>{busy === 'recovery' ? 'Generating…' : 'Generate codes'}</span>
            </Button>
          }
        />
        <SecurityCard
          testId="security-connected-card"
          title="Connected sign-ins"
          description="OAuth providers and passkeys you can use alongside your password."
          status="Email + password is the only sign-in method right now."
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled
              tooltip="OAuth and passkeys are a separate sign-in provider pass."
            >
              <span>Add provider</span>
            </Button>
          }
        />
      </div>

      <Dialog
        open={passwordOpen}
        onClose={resetPasswordDialog}
        title="Change password"
        size="md"
        footer={
          <>
            <Button type="button" variant="secondary" size="sm" disabled={busy === 'password'} onClick={resetPasswordDialog}>
              <span>Cancel</span>
            </Button>
            <Button
              type="submit"
              form="security-password-form"
              variant="primary"
              size="sm"
              disabled={busy === 'password'}
              data-testid="security-password-submit"
            >
              <span>{busy === 'password' ? 'Saving…' : 'Save password'}</span>
            </Button>
          </>
        }
      >
        <form id="security-password-form" className={styles.dialogFields} onSubmit={(event) => void handlePasswordSubmit(event)}>
          <div className={styles.dialogField}>
            <label htmlFor={newPasswordId} className={styles.dialogLabel}>New password</label>
            <Input
              id={newPasswordId}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.currentTarget.value)}
              data-testid="security-password-new"
            />
          </div>
          <div className={styles.dialogField}>
            <label htmlFor={confirmPasswordId} className={styles.dialogLabel}>Confirm new password</label>
            <Input
              id={confirmPasswordId}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              data-testid="security-password-confirm"
            />
          </div>
          {passwordError && <p className={styles.error} role="alert">{passwordError}</p>}
        </form>
      </Dialog>

      <Dialog
        open={totpSetup !== null}
        onClose={resetTotpDialog}
        title="Enable two-factor authentication"
        size="lg"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy === 'mfa-enable'}
              onClick={resetTotpDialog}
            >
              <span>Cancel</span>
            </Button>
            <Button
              type="submit"
              form="security-mfa-form"
              variant="primary"
              size="sm"
              disabled={busy === 'mfa-enable' || totpCode.trim().length < 6}
              data-testid="security-mfa-submit"
            >
              <span>{busy === 'mfa-enable' ? 'Enabling…' : 'Enable MFA'}</span>
            </Button>
          </>
        }
      >
        {totpSetup && (
          <form id="security-mfa-form" className={styles.dialogFields} onSubmit={(event) => void handleEnableMfa(event)}>
            <div className={styles.mfaSetupGrid}>
              <div className={styles.qrPanel}>
                <div className={styles.qrFrame} aria-live="polite">
                  {currentTotpQrDataUrl ? (
                    <img
                      src={currentTotpQrDataUrl}
                      alt="Scan this QR code with your authenticator app"
                      data-testid="security-mfa-qr-code"
                    />
                  ) : (
                    <span className={styles.qrPlaceholder}>
                      {currentTotpQrError ? 'QR code unavailable' : 'Rendering QR code'}
                    </span>
                  )}
                </div>
                {currentTotpQrError && <p className={styles.error} role="alert">{currentTotpQrError}</p>}
              </div>

              <div className={styles.mfaSetupContent}>
                <div className={styles.mfaStep}>
                  <h3>Scan the QR code</h3>
                  <p className={styles.secondaryText}>
                    Use Google Authenticator, 1Password, Microsoft Authenticator, Authy, or any TOTP app.
                  </p>
                </div>

                <div className={styles.secretBox}>
                  <span className={styles.dialogLabel}>Manual setup key</span>
                  <code data-testid="security-mfa-secret">{totpSetup.secret}</code>
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => void handleCopySecret()}
                    data-testid="security-mfa-copy-secret"
                  >
                    <CopySolidIcon size={12} aria-hidden="true" />
                    <span>{secretCopied ? 'Copied' : 'Copy key'}</span>
                  </Button>
                </div>

                <a className={styles.authenticatorLink} href={totpSetup.otpauthUrl}>
                  Open authenticator app
                </a>

                <div className={styles.dialogField}>
                  <label htmlFor={totpCodeId} className={styles.dialogLabel}>Authentication code</label>
                  <Input
                    id={totpCodeId}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(event) => setTotpCode(event.currentTarget.value)}
                    data-testid="security-mfa-code"
                  />
                </div>
              </div>
            </div>
            {mfaError && <p className={styles.error} role="alert">{mfaError}</p>}
          </form>
        )}
      </Dialog>

      <Dialog
        open={recoveryCodes.length > 0}
        onClose={() => setRecoveryCodes([])}
        title="Recovery codes"
        size="md"
        footer={
          <Button type="button" variant="primary" size="sm" onClick={() => setRecoveryCodes([])}>
            <span>Done</span>
          </Button>
        }
      >
        <div className={styles.dialogFields}>
          <p className={styles.secondaryText}>
            Save these recovery codes now. They will not be shown again.
          </p>
          <div className={styles.recoveryGrid}>
            {recoveryCodes.map((code) => (
              <code key={code}>{code}</code>
            ))}
          </div>
        </div>
      </Dialog>
    </section>
  )
}
