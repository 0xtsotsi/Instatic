import { definePluginAdminApp } from '@instatic/plugin-sdk'
import { Alert, Button, Card, Heading, Input, Stack, Text } from '@instatic/host-ui'
import { useMemo, useState, type FormEvent } from 'react'

type CaptureMode = 'dom+styles' | 'dom-only' | 'styles-only'
type CaptureScope = 'page' | 'subtree' | 'element'

type CaptureResult = {
  ok: boolean
  error?: string
  html?: string
  css?: string
  nextActions?: unknown[]
}

const endpoint = '/admin/api/cms/plugins/instatic.capture-from-url/runtime/capture'

export function CaptureWorkflow() {
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<CaptureMode>('dom+styles')
  const [scope, setScope] = useState<CaptureScope>('page')
  const [selector, setSelector] = useState('')
  const [result, setResult] = useState<CaptureResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const preview = useMemo(() => {
    if (!result?.html) return ''
    return `<!doctype html><html><head><style>${result.css ?? ''}</style></head><body>${result.html}</body></html>`
  }, [result])

  async function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const body = {
        url,
        mode,
        scope,
        ...(scope !== 'page' && selector.trim() ? { selector: selector.trim() } : {}),
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json() as CaptureResult
      if (!response.ok || !data.ok) throw new Error(data.error || `Capture failed (${response.status})`)
      setResult(data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Capture failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Stack gap={16}>
      <div>
        <Heading level={1}>Capture from URL</Heading>
        <Text variant="muted">Capture a page or selected element and inspect the SDK result.</Text>
      </div>

      <Card>
        <form onSubmit={capture}>
          <Stack gap={16}>
            <Input label="URL" type="url" required value={url} placeholder="https://example.com" onChange={setUrl} />

            <fieldset>
              <legend>Mode</legend>
              {(['dom+styles', 'dom-only', 'styles-only'] as const).map((value) => (
                <label key={value} style={{ marginRight: 16 }}>
                  <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} /> {value}
                </label>
              ))}
            </fieldset>

            <fieldset>
              <legend>Scope</legend>
              {(['page', 'subtree', 'element'] as const).map((value) => (
                <label key={value} style={{ marginRight: 16 }}>
                  <input type="radio" name="scope" value={value} checked={scope === value} onChange={() => setScope(value)} /> {value}
                </label>
              ))}
            </fieldset>

            <Input
              label="CSS selector"
              value={selector}
              placeholder="#hero or main > section"
              disabled={scope === 'page'}
              required={scope !== 'page'}
              description="Required for subtree and element captures."
              onChange={setSelector}
            />
            <Button variant="primary" type="submit" disabled={loading}>{loading ? 'Capturing…' : 'Capture'}</Button>
          </Stack>
        </form>
      </Card>

      {error ? <Alert tone="danger" title="Capture failed">{error}</Alert> : null}
      {result ? (
        <Stack gap={16}>
          <Card>
            <Heading level={2}>Preview</Heading>
            {preview ? (
              <iframe title="Captured page preview" sandbox="" srcDoc={preview} style={{ width: '100%', minHeight: 480, border: '1px solid currentColor' }} />
            ) : <Text variant="muted">This capture did not return HTML.</Text>}
          </Card>
          <Card>
            <Heading level={2}>HTML</Heading>
            <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>{result.html ?? ''}</pre>
          </Card>
          <Card>
            <Heading level={2}>CSS</Heading>
            <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>{result.css ?? ''}</pre>
          </Card>
          <Card>
            <Heading level={2}>nextActions</Heading>
            <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>{JSON.stringify(result.nextActions ?? [], null, 2)}</pre>
          </Card>
        </Stack>
      ) : null}
    </Stack>
  )
}

export default definePluginAdminApp(CaptureWorkflow)
