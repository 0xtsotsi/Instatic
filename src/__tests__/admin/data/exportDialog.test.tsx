/**
 * ExportDialog — interactive export configuration dialog.
 *
 * Tests the full interaction surface:
 *   1.  Initial state: all tables checked, site shell on, media off, scope=all, estimate shown
 *   2.  Toggling site shell switch flips aria-checked
 *   3.  Toggling media switch flips aria-checked
 *   4.  Unchecking a table flips its checkbox
 *   5.  scope='selected' radio is disabled when no rows are selected
 *   6.  scope='selected' with N rows locks table checkboxes to the active table
 *   7.  initialScope='selected' pre-selects the scope radio on first render
 *   8.  Download success: fetch called with right body, success toast, onClose called
 *   9.  Download error: inline alert shown, error toast, onClose NOT called
 *   10. Cancel calls onClose
 *   11. Download button is disabled when all tables unchecked and site shell off
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DataTableListItem } from '@core/data/schemas'
import { subscribeToasts, type Toast } from '@ui/components/Toast/toastBus'
import { ExportDialog } from '@admin/pages/data/components/ExportDialog/ExportDialog'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const POSTS_TABLE: DataTableListItem = {
  id: 'posts',
  name: 'Posts',
  slug: 'posts',
  kind: 'postType',
  singularLabel: 'Post',
  pluralLabel: 'Posts',
  routeBase: '/posts',
  primaryFieldId: 'title',
  fields: [],
  system: true,
  rowCount: 5,
  createdByUserId: null,
  updatedByUserId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const PAGES_TABLE: DataTableListItem = {
  id: 'pages',
  name: 'Pages',
  slug: 'pages',
  kind: 'page',
  singularLabel: 'Page',
  pluralLabel: 'Pages',
  routeBase: '',
  primaryFieldId: 'title',
  fields: [],
  system: true,
  rowCount: 3,
  createdByUserId: null,
  updatedByUserId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ── Global state saved for restore ───────────────────────────────────────────

const originalFetch = globalThis.fetch
// TypeScript types these as always-defined; happy-dom may not implement them,
// but we always set our own mock version so runtime absence is fine.
let savedCreateObjectURL: typeof URL.createObjectURL
let savedRevokeObjectURL: typeof URL.revokeObjectURL
let savedAnchorClick: typeof HTMLAnchorElement.prototype.click

beforeEach(() => {
  savedCreateObjectURL = URL.createObjectURL
  savedRevokeObjectURL = URL.revokeObjectURL
  savedAnchorClick = HTMLAnchorElement.prototype.click
  // Mock browser download helpers that don't exist in happy-dom
  URL.createObjectURL = (_obj: Blob | MediaSource) => 'blob:mock-url'
  URL.revokeObjectURL = (_url: string) => {}
  // Prevent anchor navigation side-effects in the happy-dom environment
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {}
})

afterEach(() => {
  globalThis.fetch = originalFetch
  URL.createObjectURL = savedCreateObjectURL
  URL.revokeObjectURL = savedRevokeObjectURL
  HTMLAnchorElement.prototype.click = savedAnchorClick
  cleanup()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ExportDialog', () => {
  it('initial state — all tables checked, site shell on, media off, scope=all, estimate shown', () => {
    render(
      <ExportDialog
        open={true}
        onClose={() => {}}
        tables={[POSTS_TABLE, PAGES_TABLE]}

      />,
    )

    // Dialog renders with neutral tone → role="dialog"
    expect(screen.getByRole('dialog')).toBeTruthy()

    // Site shell switch is on
    const siteShellSwitch = screen.getByRole('switch', { name: /include site shell/i })
    expect(siteShellSwitch.getAttribute('aria-checked')).toBe('true')

    // Media switch is off
    const mediaSwitch = screen.getByRole('switch', { name: /include media files/i })
    expect(mediaSwitch.getAttribute('aria-checked')).toBe('false')

    // Both table checkboxes are checked
    const postsCheckbox = screen.getByRole('checkbox', { name: /include table posts/i }) as HTMLInputElement
    const pagesCheckbox = screen.getByRole('checkbox', { name: /include table pages/i }) as HTMLInputElement
    expect(postsCheckbox.checked).toBe(true)
    expect(pagesCheckbox.checked).toBe(true)

    // All-rows scope radio is selected
    const allRadio = screen.getByRole('radio', { name: /all rows/i }) as HTMLInputElement
    expect(allRadio.checked).toBe(true)

    // Estimate label is rendered
    expect(screen.getByText(/estimated size/i)).toBeTruthy()
  })

  it('toggling the site-shell switch flips its aria-checked', () => {
    render(
      <ExportDialog
        open={true}
        onClose={() => {}}
        tables={[POSTS_TABLE]}

      />,
    )

    const sw = screen.getByRole('switch', { name: /include site shell/i })
    expect(sw.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
  })

  it('toggling the media switch flips its aria-checked', () => {
    render(
      <ExportDialog
        open={true}
        onClose={() => {}}
        tables={[POSTS_TABLE]}

      />,
    )

    const sw = screen.getByRole('switch', { name: /include media files/i })
    expect(sw.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
  })

  it('unchecking a table checkbox flips it to unchecked', () => {
    render(
      <ExportDialog
        open={true}
        onClose={() => {}}
        tables={[POSTS_TABLE, PAGES_TABLE]}

      />,
    )

    const postsCheckbox = screen.getByRole('checkbox', { name: /include table posts/i }) as HTMLInputElement
    expect(postsCheckbox.checked).toBe(true)

    fireEvent.click(postsCheckbox)
    expect(postsCheckbox.checked).toBe(false)

    // Other table should remain checked
    const pagesCheckbox = screen.getByRole('checkbox', { name: /include table pages/i }) as HTMLInputElement
    expect(pagesCheckbox.checked).toBe(true)
  })

  it("scope='selected' radio is disabled when selectedRowIds is empty", () => {
    render(
      <ExportDialog
        open={true}
        onClose={() => {}}
        tables={[POSTS_TABLE, PAGES_TABLE]}

        selectedRowIds={[]}
      />,
    )

    const selectedRadio = screen.getByRole('radio', { name: /only the/i }) as HTMLInputElement
    expect(selectedRadio.disabled).toBe(true)
  })

  it("scope='selected' with N rows locks table checkboxes to the active table", () => {
    render(
      <ExportDialog
        open={true}
        onClose={() => {}}
        tables={[POSTS_TABLE, PAGES_TABLE]}

        selectedRowIds={['r1', 'r2']}
        activeTableId="posts"
      />,
    )

    const selectedRadio = screen.getByRole('radio', { name: /only the/i }) as HTMLInputElement
    expect(selectedRadio.disabled).toBe(false)

    fireEvent.click(selectedRadio)

    // All table checkboxes become disabled (scope is locked to active table)
    const postsCheckbox = screen.getByRole('checkbox', { name: /include table posts/i }) as HTMLInputElement
    const pagesCheckbox = screen.getByRole('checkbox', { name: /include table pages/i }) as HTMLInputElement
    expect(postsCheckbox.disabled).toBe(true)
    expect(pagesCheckbox.disabled).toBe(true)

    // Active table is checked; inactive table is not
    expect(postsCheckbox.checked).toBe(true)
    expect(pagesCheckbox.checked).toBe(false)
  })

  it("initialScope='selected' pre-selects the scope radio on first render", () => {
    render(
      <ExportDialog
        open={true}
        onClose={() => {}}
        tables={[POSTS_TABLE]}

        selectedRowIds={['r1']}
        activeTableId="posts"
        initialScope="selected"
      />,
    )

    const selectedRadio = screen.getByRole('radio', { name: /only the/i }) as HTMLInputElement
    const allRadio = screen.getByRole('radio', { name: /all rows/i }) as HTMLInputElement

    expect(selectedRadio.checked).toBe(true)
    expect(allRadio.checked).toBe(false)
  })

  it('download success — fetch called with correct body, success toast pushed, onClose called', async () => {
    let onCloseCalled = false
    let fetchBodyStr: string | null = null

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/admin/api/cms/export') {
        fetchBodyStr = (init?.body as string) ?? null
        // Return a valid 200 response; exportSiteBundle calls res.blob()
        return jsonResponse('{}')
      }
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }

    let capturedToasts: Toast[] = []
    const unsub = subscribeToasts((snapshot) => { capturedToasts = [...snapshot] })

    try {
      render(
        <ExportDialog
          open={true}
          onClose={() => { onCloseCalled = true }}
          tables={[POSTS_TABLE, PAGES_TABLE]}
  
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /download bundle/i }))

      await waitFor(() => {
        expect(onCloseCalled).toBe(true)
      })

      // Fetch was called with the correct body shape
      expect(fetchBodyStr).not.toBeNull()
      const body = JSON.parse(fetchBodyStr!) as {
        tables: string[]
        includeMedia: boolean
        includeSite: boolean
      }
      expect(Array.isArray(body.tables)).toBe(true)
      expect(body.tables).toContain('posts')
      expect(body.tables).toContain('pages')
      expect(body.includeSite).toBe(true)
      expect(body.includeMedia).toBe(false)

      // Success toast was pushed
      expect(capturedToasts.some((t) => t.kind === 'success' && t.title === 'Export complete')).toBe(true)
    } finally {
      unsub()
    }
  })

  it('download error — inline alert shown, error toast pushed, onClose NOT called', async () => {
    let onCloseCalled = false

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/admin/api/cms/export') {
        return new Response(JSON.stringify({ error: 'boom' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
      return jsonResponse({ error: `Unexpected: ${url}` }, 500)
    }

    let capturedToasts: Toast[] = []
    const unsub = subscribeToasts((snapshot) => { capturedToasts = [...snapshot] })

    try {
      render(
        <ExportDialog
          open={true}
          onClose={() => { onCloseCalled = true }}
          tables={[POSTS_TABLE]}
  
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /download bundle/i }))

      // Inline role="alert" error appears
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeTruthy()
      })

      expect(onCloseCalled).toBe(false)

      // Error toast was pushed
      expect(capturedToasts.some((t) => t.kind === 'error' && t.title === 'Export failed')).toBe(true)
    } finally {
      unsub()
    }
  })

  it('estimate is fetched from the server and grows when media is toggled on', async () => {
    // The estimate endpoint reports a size that depends on includeMedia, so we
    // can assert the dialog re-requests and re-renders when the toggle flips.
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/admin/api/cms/export/estimate') {
        const body = JSON.parse((init?.body as string) ?? '{}') as { includeMedia?: boolean }
        return jsonResponse({ bytes: body.includeMedia ? 5_000_000 : 12_000 })
      }
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }

    render(
      <ExportDialog
        open={true}
        onClose={() => {}}
        tables={[POSTS_TABLE]}
      />,
    )

    // Initial (media off) estimate resolves to ~12 KB.
    await waitFor(() => {
      expect(screen.getByText(/estimated size: ~12 KB/i)).toBeTruthy()
    })

    // Flip media on → the dialog re-requests and the estimate jumps to MB.
    fireEvent.click(screen.getByRole('switch', { name: /include media files/i }))
    await waitFor(() => {
      expect(screen.getByText(/estimated size: ~4\.8 MB/i)).toBeTruthy()
    })
  })

  it('Cancel button calls onClose', () => {
    let onCloseCalled = false
    render(
      <ExportDialog
        open={true}
        onClose={() => { onCloseCalled = true }}
        tables={[POSTS_TABLE]}

      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCloseCalled).toBe(true)
  })

  it('Download button is disabled when all tables unchecked and site shell is off', () => {
    render(
      <ExportDialog
        open={true}
        onClose={() => {}}
        tables={[POSTS_TABLE]}

      />,
    )

    // Turn off site shell
    fireEvent.click(screen.getByRole('switch', { name: /include site shell/i }))
    // Uncheck the only table
    fireEvent.click(screen.getByRole('checkbox', { name: /include table posts/i }))

    const downloadBtn = screen.getByRole('button', { name: /download bundle/i }) as HTMLButtonElement
    expect(downloadBtn.disabled).toBe(true)
  })
})
