import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DepsSection } from '../../editor/components/DependenciesPanel/DepsSection'
import { useEditorStore } from '../../core/editor-store/store'
import { makeSite } from '../fixtures'
import { normalizeSiteRuntimeConfig } from '../../core/site-runtime'

afterEach(cleanup)
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function resetStore() {
  const packageJson = {
    dependencies: { 'canvas-confetti': '^1.9.3' },
    devDependencies: {},
  }
  useEditorStore.setState({
    site: makeSite({
      packageJson,
      runtime: normalizeSiteRuntimeConfig(undefined),
      files: [{
        id: 'script-1',
        path: 'src/scripts/celebrate.ts',
        type: 'script',
        content: `import confetti from 'canvas-confetti'\nimport { animate } from 'motion'`,
        createdAt: 1,
        updatedAt: 1,
      }],
    }),
    packageJson,
    siteRuntime: normalizeSiteRuntimeConfig(undefined),
    activePageId: 'page-1',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)

describe('DepsSection runtime script dependency usage', () => {
  it('marks packages imported by site scripts as in use', () => {
    render(<DepsSection collapsible={false} defaultExpanded />)

    const row = screen.getByTestId('dep-row-canvas-confetti')
    expect(within(row).getByText('in use')).toBeDefined()
    expect(within(row).getByTitle(/scripts: celebrate\.ts/)).toBeDefined()
  })

  it('surfaces missing runtime imports and can add them as dependencies', () => {
    render(<DepsSection collapsible={false} defaultExpanded />)

    const issues = screen.getByLabelText('Runtime dependency issues')
    expect(within(issues).getByText('motion')).toBeDefined()
    expect(within(issues).getByText('missing from dependencies')).toBeDefined()

    fireEvent.click(within(issues).getByRole('button', { name: 'Add' }))

    expect(useEditorStore.getState().packageJson.dependencies.motion).toBe('*')
    expect(useEditorStore.getState().site?.packageJson?.dependencies.motion).toBe('*')
  })

  it('resolves runtime dependencies into the site dependency lock', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        dependencyLock: {
          version: 1,
          packages: {
            'canvas-confetti': {
              name: 'canvas-confetti',
              requested: '^1.9.3',
              version: '1.9.3',
              resolvedAt: 123,
            },
          },
          updatedAt: 123,
        },
      }), { status: 200 })) as typeof fetch

    render(<DepsSection collapsible={false} defaultExpanded />)

    fireEvent.click(screen.getByRole('button', { name: 'Resolve runtime' }))
    expect(await screen.findByText('1 locked')).toBeDefined()
    expect(useEditorStore.getState().siteRuntime.dependencyLock.packages['canvas-confetti']?.version).toBe('1.9.3')
    expect(useEditorStore.getState().site?.runtime?.dependencyLock.packages['canvas-confetti']?.version).toBe('1.9.3')
  })
})
