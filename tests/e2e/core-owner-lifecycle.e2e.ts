import { expect, test, type Browser, type Page } from '@playwright/test'

const OWNER_EMAIL = 'owner.e2e@example.com'
const OWNER_PASSWORD = 'qwerty123456'
const SITE_NAME = 'Automated E2E Site'
const PUBLISHED_TEXT = 'Automated E2E public headline'
const DRAFT_ONLY_TEXT = 'Automated E2E draft only headline'
const PUBLIC_BASE_URL = process.env.E2E_PUBLIC_BASE_URL ?? 'http://127.0.0.1:3002'

test.describe('core owner lifecycle', () => {
  test('sets up, edits, publishes, and keeps later drafts private', async ({ page, browser }) => {
    await test.step('complete first-run setup', async () => {
      await page.goto('/admin')
      await expect(page.getByRole('heading', { name: 'Set Up CMS' })).toBeVisible()

      await page.getByLabel('Site name').fill(SITE_NAME)
      await page.getByLabel('Email').fill(OWNER_EMAIL)
      await page.getByLabel('Password').fill(OWNER_PASSWORD)
      await page.getByRole('button', { name: 'Create Admin' }).click()

      await openSiteEditor(page)
    })

    await test.step('log out and log back in', async () => {
      await page.getByTestId('account-menu-trigger').click()
      await page.getByTestId('account-menu-sign-out').click()

      await expect(page.getByRole('heading', { name: 'Admin Login' })).toBeVisible()
      await page.getByLabel('Email').fill(OWNER_EMAIL)
      await page.getByLabel('Password').fill(OWNER_PASSWORD)
      await page.getByRole('button', { name: 'Sign In' }).click()

      await openSiteEditor(page)
    })

    await test.step('add editable homepage text', async () => {
      await page.getByTestId('canvas-notch-text-btn').click()
      await expect(page.getByTestId('property-control-text')).toBeVisible()

      await page.locator('#ctrl-text').fill(PUBLISHED_TEXT)
      await expect(canvasFrame(page).getByText(PUBLISHED_TEXT)).toBeVisible()
      await saveDraft(page)
    })

    await test.step('reload and confirm draft persistence', async () => {
      await page.reload()
      await expectEditorReady(page)
      await expect(canvasFrame(page).getByText(PUBLISHED_TEXT)).toBeVisible()
    })

    await test.step('publish and verify the visitor-facing page', async () => {
      await publishCurrentDraft(page)
      await expectPublicPage(browser, {
        visibleText: PUBLISHED_TEXT,
        hiddenText: DRAFT_ONLY_TEXT,
      })
    })

    await test.step('change the draft without publishing and verify public isolation', async () => {
      await selectTextLayer(page)
      await page.locator('#ctrl-text').fill(DRAFT_ONLY_TEXT)
      await expect(canvasFrame(page).getByText(DRAFT_ONLY_TEXT)).toBeVisible()
      await saveDraft(page)

      await expectPublicPage(browser, {
        visibleText: PUBLISHED_TEXT,
        hiddenText: DRAFT_ONLY_TEXT,
      })
    })
  })
})

async function expectEditorReady(page: Page): Promise<void> {
  await expect(page.getByTestId('canvas-root')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('canvas-notch')).toBeVisible()
}

async function openSiteEditor(page: Page): Promise<void> {
  if (!(await page.getByTestId('canvas-root').isVisible({ timeout: 1_000 }).catch(() => false))) {
    await page.getByRole('link', { name: 'Site' }).click()
  }
  await expectEditorReady(page)
}

async function saveDraft(page: Page): Promise<void> {
  await page.getByTestId('toolbar-publish-actions-trigger').click()
  await page.getByTestId('toolbar-save-draft-action').click()
  await expect(page.getByRole('status', { name: 'Draft saved' })).toBeVisible({
    timeout: 20_000,
  })
}

async function selectTextLayer(page: Page): Promise<void> {
  await page.getByRole('treeitem', { name: 'Text' }).click()
  await expect(page.getByTestId('property-control-text')).toBeVisible()
}

function canvasFrame(page: Page) {
  return page.frameLocator('iframe[title^="Canvas frame"]').first()
}

async function publishCurrentDraft(page: Page): Promise<void> {
  const publishButton = page.getByTestId('toolbar-publish-btn')
  await publishButton.click()
  const stepUpDialog = page.getByTestId('step-up-dialog')
  const stepUpOpened = await stepUpDialog
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true, () => false)
  if (stepUpOpened) {
    await page.getByTestId('step-up-password').fill(OWNER_PASSWORD)
    await page.getByTestId('step-up-confirm').click()
    await expect(stepUpDialog).toBeHidden({ timeout: 20_000 })
  }
  await expect(publishButton).toHaveText(/Published/, {
    timeout: 30_000,
  })
}

async function expectPublicPage(
  browser: Browser,
  expected: { visibleText: string; hiddenText: string },
): Promise<void> {
  const context = await browser.newContext()
  const visitor = await context.newPage()
  try {
    await visitor.goto(PUBLIC_BASE_URL)
    await expect(visitor.getByText(expected.visibleText)).toBeVisible()
    await expect(visitor.getByText(expected.hiddenText)).toHaveCount(0)
    await expect(visitor.locator('[data-testid="canvas-root"]')).toHaveCount(0)
  } finally {
    await context.close()
  }
}
