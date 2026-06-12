/**
 * AiSuggestionSparkle — the ✨ action on metadata inputs.
 *
 * Click → `POST /admin/api/cms/seo/generate` → three suggestions render as
 * tappable bubbles under the input. Tapping fills the input through the
 * normal dirty/save flow (nothing auto-saves). Two trailing bubbles:
 * "More options" regenerates (excluding already-shown texts) and "Reject"
 * dismisses the row.
 *
 * Gating: requires `ai.chat` — without it the sparkle renders disabled with
 * an inline reason (never available-then-blocked). Provider-not-configured
 * surfaces as an inline error with a pointer to the AI workspace, matching
 * the AgentPanel's handling.
 */
import { useState } from 'react'
import { Button } from '@ui/components/Button'
import { AiBoxSolidIcon } from 'pixel-art-icons/icons/ai-box-solid'
import { hasCapability } from '@admin/access'
import { useCurrentAdminUser } from '@admin/sessionContext'
import { getErrorMessage } from '@core/utils/errorMessage'
import { generateSeoSuggestions, type SeoTarget } from '../lib/seoApi'
import type { SeoDraftField } from '../hooks/useSeoDraft'
import styles from './AiSuggestionBubbles.module.css'

interface AiSuggestionSparkleProps {
  target: SeoTarget
  field: SeoDraftField
  canManage: boolean
  onPick: (suggestion: string) => void
}

export function AiSuggestionSparkle({ target, field, canManage, onPick }: AiSuggestionSparkleProps) {
  const currentUser = useCurrentAdminUser()
  const unrestricted = !currentUser
  const canChat = unrestricted || hasCapability(currentUser, 'ai.chat')

  const [suggestions, setSuggestions] = useState<string[] | null>(null)
  const [seen, setSeen] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate(exclude: string[]): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const next = await generateSeoSuggestions(target.kind, target.id, field, exclude)
      setSuggestions(next)
      setSeen([...exclude, ...next])
    } catch (err) {
      console.error('[seo-page] suggestion generation failed:', err)
      setError(getErrorMessage(err, 'Could not generate suggestions'))
    } finally {
      setLoading(false)
    }
  }

  function pick(suggestion: string): void {
    onPick(suggestion)
    setSuggestions(null)
  }

  const disabledReason = !canManage
    ? 'Your role does not include Manage SEO'
    : !canChat
      ? 'Your role does not include Use AI chat'
      : undefined

  return (
    <div className={styles.wrap}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={disabledReason !== undefined || loading}
        tooltip={disabledReason ?? 'Generate suggestions with AI'}
        aria-label={`Generate ${field} suggestions with AI`}
        onClick={() => void generate([])}
        data-testid={`seo-sparkle-${field}`}
      >
        <AiBoxSolidIcon size={13} aria-hidden="true" />
        {loading && <span className={styles.loadingText}>Generating…</span>}
      </Button>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {suggestions !== null && suggestions.length > 0 && (
        <div className={styles.bubbles} role="group" aria-label="AI suggestions">
          {suggestions.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              variant="secondary"
              size="xs"
              className={styles.bubble}
              onClick={() => pick(suggestion)}
            >
              {suggestion}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={styles.bubbleAction}
            disabled={loading}
            onClick={() => void generate(seen)}
            data-testid={`seo-sparkle-${field}-more`}
          >
            More options
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={styles.bubbleAction}
            onClick={() => {
              setSuggestions(null)
              setError(null)
            }}
            data-testid={`seo-sparkle-${field}-reject`}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}
