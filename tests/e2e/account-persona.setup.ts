import { expect, test as setup } from '@playwright/test'
import { ACCOUNT_PERSONA } from './helpers/constants'
import { completeStepUp, login } from './helpers'

/**
 * Setup project — creates the dedicated "account tester" persona once, after the
 * owner exists (this file is matched by the same `setup` project as
 * `auth.setup.ts`, which runs before every spec).
 *
 * `account.e2e` runs its account-GLOBAL destructive flows (sign out everywhere,
 * change password, enable/disable MFA) against THIS persona instead of the
 * shared owner, so those flows can't invalidate `OWNER_STATE_FILE` and log out
 * every later spec. The persona logs in fresh in each of those tests, so no
 * saved storage state is needed here — only that the account exists.
 *
 * Idempotent for local `E2E_REUSE_SERVER=1` iteration: if the persona is already
 * present it does nothing.
 */
setup('create the account tester persona', async ({ page }) => {
  await login(page)

  await page.goto('/admin/users')
  const alreadyExists = await page
    .getByText(ACCOUNT_PERSONA.email)
    .isVisible()
    .catch(() => false)
  if (alreadyExists) return

  await page.getByRole('button', { name: 'Create User', exact: true }).click()
  await page.locator('input[name="new-user-email-address"]').fill(ACCOUNT_PERSONA.email)
  await page.locator('input[name="new-user-display-name"]').fill(ACCOUNT_PERSONA.displayName)
  await page.locator('input[name="new-user-initial-password"]').fill(ACCOUNT_PERSONA.password)
  await page.locator('select[name="new-user-role"]').selectOption({ label: ACCOUNT_PERSONA.role })
  await page.locator('button[form="users-page-user-form"]').click()
  await completeStepUp(page)
  await expect(page.getByText(ACCOUNT_PERSONA.email)).toBeVisible()
})
