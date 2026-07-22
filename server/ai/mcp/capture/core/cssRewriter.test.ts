/**
 * Tests for rewriteCss — emits `.scopeClass .cap_<hash> { ... }` rules
 * from a selector → declarations map. Hash-based class names avoid
 * quoting issues when reusing generated CSS selectors as class names.
 */
import { describe, expect, it } from 'bun:test'
import { DEFAULT_SCOPE_CLASS, rewriteCss } from './cssRewriter'

describe('rewriteCss', () => {
  it('returns an empty string for empty input', () => {
    expect(rewriteCss({})).toBe('')
  })

  it('emits a single rule for one selector + one property', () => {
    const out = rewriteCss({ p: { color: 'red' } })
    expect(out).toContain(`.${DEFAULT_SCOPE_CLASS} .cap_`)
    expect(out).toContain('color: red;')
  })

  it('emits multiple rules sharing the scope class', () => {
    const out = rewriteCss({
      'div': { color: 'red' },
      'p': { color: 'blue' },
    })
    // Two rules, both scoped under the same class.
    const ruleCount = (out.match(/\{/g) ?? []).length
    expect(ruleCount).toBe(2)
    const occurrences = (out.match(new RegExp(`\\.${DEFAULT_SCOPE_CLASS} \\.cap_`, 'g')) ?? []).length
    expect(occurrences).toBe(2)
    expect(out).toContain('color: red;')
    expect(out).toContain('color: blue;')
  })

  it('honours a custom scopeClass', () => {
    const out = rewriteCss({ p: { color: 'red' } }, { scopeClass: 'my-prefix' })
    expect(out).toContain('.my-prefix .cap_')
    expect(out).not.toContain(`.${DEFAULT_SCOPE_CLASS}`)
  })

  it('emits stable order alphabetically when stableOrder is true', () => {
    const out = rewriteCss(
      { 'z > p': { color: 'red' }, 'a > p': { color: 'blue' } },
      { stableOrder: true },
    )
    const aIdx = out.indexOf('color: blue;')
    const zIdx = out.indexOf('color: red;')
    expect(aIdx).toBeGreaterThan(-1)
    expect(zIdx).toBeGreaterThan(-1)
    expect(aIdx).toBeLessThan(zIdx)
  })

  it('emits insertion order by default', () => {
    const out = rewriteCss({ 'z > p': { color: 'red' }, 'a > p': { color: 'blue' } })
    const aIdx = out.indexOf('color: blue;')
    const zIdx = out.indexOf('color: red;')
    expect(zIdx).toBeLessThan(aIdx)
  })

  it('preserves CSS custom properties (kebab passthrough)', () => {
    const out = rewriteCss({ ':root': { '--foo-bar': 'red' } })
    expect(out).toContain('--foo-bar: red;')
  })

  it('converts camelCase property names to kebab-case', () => {
    const out = rewriteCss({ p: { backgroundColor: 'red', fontSize: '16px' } })
    expect(out).toContain('background-color: red;')
    expect(out).toContain('font-size: 16px;')
    expect(out).not.toContain('backgroundColor:')
    expect(out).not.toContain('fontSize:')
  })
})
