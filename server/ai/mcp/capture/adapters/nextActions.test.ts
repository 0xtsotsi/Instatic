import { describe, expect, it } from 'bun:test'
import { buildNextActions, type CaptureResult } from './nextActions'

const baseResult: CaptureResult = {
  html: '<p uid="abc">x</p>',
  css: '',
  uids: ['abc'],
  assetFiles: [],
  unavailable: [],
}

describe('buildNextActions', () => {
  it('omits site_apply_css when there is no CSS', () => {
    const actions = buildNextActions(baseResult, { parentNodeId: 'p1' })
    expect(actions.find((a) => a.tool === 'site_apply_css')).toBeUndefined()
  })

  it('always emits at least one site_insert_html action', () => {
    const actions = buildNextActions(baseResult, { parentNodeId: 'p1' })
    const insert = actions.find((a) => a.tool === 'site_insert_html')
    expect(insert).toBeDefined()
    expect((insert!.input as unknown as Record<string, unknown>).parentNodeId).toBe('p1')
    expect((insert!.input as unknown as Record<string, unknown>).html).toBe(baseResult.html)
  })

  it('emits site_apply_css when CSS is present, BEFORE site_insert_html', () => {
    const actions = buildNextActions({ ...baseResult, css: '.x { color: red; }' }, { parentNodeId: 'p1' })
    const idxCss = actions.findIndex((a) => a.tool === 'site_apply_css')
    const idxHtml = actions.findIndex((a) => a.tool === 'site_insert_html')
    expect(idxCss).toBeGreaterThanOrEqual(0)
    expect(idxHtml).toBeGreaterThan(idxCss)
  })

  it('emits log_unavailable_assets when unavailable is non-empty', () => {
    const actions = buildNextActions(
      { ...baseResult, unavailable: [{ url: 'https://x.com/a.png', reason: 'blocked' }] },
      { parentNodeId: 'p1' },
    )
    const log = actions.find((a) => a.tool === 'log_unavailable_assets')
    expect(log).toBeDefined()
    expect((log!.input as unknown as Record<string, unknown>).assets).toHaveLength(1)
  })

  it('omits log_unavailable_assets when nothing is unavailable', () => {
    const actions = buildNextActions(baseResult, { parentNodeId: 'p1' })
    expect(actions.find((a) => a.tool === 'log_unavailable_assets')).toBeUndefined()
  })

  it('defaults position to "append" when not specified', () => {
    const actions = buildNextActions(baseResult, { parentNodeId: 'p1' })
    expect((actions[0]!.input as unknown as Record<string, unknown>).position).toBe('append')
  })

  it('respects position: "prepend" when specified', () => {
    const actions = buildNextActions(baseResult, { parentNodeId: 'p1', position: 'prepend' })
    expect((actions[0]!.input as unknown as Record<string, unknown>).position).toBe('prepend')
  })

  it('order is css → html → log when all three apply', () => {
    const actions = buildNextActions(
      {
        ...baseResult,
        css: '.x {}',
        unavailable: [{ url: 'a', reason: 'r' }],
      },
      { parentNodeId: 'p1' },
    )
    expect(actions.map((a) => a.tool)).toEqual(['site_apply_css', 'site_insert_html', 'log_unavailable_assets'])
  })
})
