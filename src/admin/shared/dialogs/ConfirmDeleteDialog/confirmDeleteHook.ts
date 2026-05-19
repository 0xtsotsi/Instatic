/**
 * Hook + types backing <ConfirmDeleteProvider/>.
 *
 * Lives in a non-component module because Fast Refresh requires component
 * files to export only components. Same split-file layout as
 * `frameworkChangeConfirmHook.ts`.
 */

import { createContext, use } from 'react'

export interface ConfirmDeleteRequest {
  /** Short title shown in the dialog header. e.g. "Delete header layer?" */
  title: string
  /** Optional secondary line — e.g. "This will remove all of its children." */
  description?: string
  /** Confirm button label — defaults to "Delete". */
  confirmLabel?: string
  /** Action to execute on confirm or, when the preference is off, immediately. */
  commit: () => void
}

export interface PendingConfirmState {
  request: ConfirmDeleteRequest
}

export interface ConfirmDeleteContextValue {
  /**
   * Request a confirmation. When the `confirmBeforeDelete` preference is on
   * the dialog appears and `commit` runs only after the user clicks Delete.
   * When the preference is off, `commit` runs synchronously and no dialog
   * is shown — matches the historical "Delete is destructive but instant"
   * behaviour.
   */
  confirmDelete: (request: ConfirmDeleteRequest) => void
}

export const ConfirmDeleteContext = createContext<ConfirmDeleteContextValue | null>(null)

/**
 * Access the editor's central confirm-delete dispatch.
 *
 * When no `<ConfirmDeleteProvider/>` is mounted (e.g. unit-test renders that
 * mount a single panel in isolation), the hook falls back to executing
 * `commit()` immediately — the same behaviour as having the
 * `confirmBeforeDelete` preference turned off. This keeps consumers usable
 * outside the production provider tree without making every test fixture
 * wrap them.
 */
export function useConfirmDelete(): ConfirmDeleteContextValue['confirmDelete'] {
  const ctx = use(ConfirmDeleteContext)
  return ctx?.confirmDelete ?? ((request) => request.commit())
}
