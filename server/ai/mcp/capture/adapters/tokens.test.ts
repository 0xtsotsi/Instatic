import { describe, expect, it } from 'bun:test'
import { applyDesignTokens, tokensFromSite, type SiteToken } from './tokens'

const RED: SiteToken = { name: '--primary', value: '#ff0000', kind: 'color' }
const NEAR_RED: SiteToken = { name: '--accent', value: '#fe0000', kind: 'color' }
const BLUE: SiteToken = { name: '--secondary', value: '#0000ff', kind: 'color' }

describe('applyDesignTokens', () => {
  it('returns the input unchanged when no tokens are provided', () => {
    const css = '.x { color: #ff0000; }'
    expect(applyDesignTokens(css, [])).toBe(css)
  })

  it('rewrites a captured color to var(--name) when a token matches exactly', () => {
    const css = '.x { color: #ff0000; }'
    const out = applyDesignTokens(css, [RED])
    expect(out).toContain('color: var(--primary)')
  })

  it('rewrites when the closest token is within the default threshold (8)', () => {
    // NEAR_RED is 1 unit of red off (CIEDE2000 ~ 0.6).
    const css = '.x { color: #fe0000; }'
    const out = applyDesignTokens(css, [RED, NEAR_RED])
    // Either token could win; both are var(--*).
    expect(out).toMatch(/color: var\(--(primary|accent)\)/)
  })

  it('does NOT rewrite when the closest token is beyond the threshold', () => {
    const css = '.x { color: #00ff00; }' // green, far from red
    const out = applyDesignTokens(css, [RED])
    expect(out).toBe(css)
  })

  it('ignores non-color properties (font-size is never rewritten)', () => {
    const css = '.x { font-size: 16px; }'
    const out = applyDesignTokens(css, [RED])
    expect(out).toBe(css)
  })

  it('leaves currentColor alone under default strict mode', () => {
    const css = '.x { color: currentColor; }'
    const out = applyDesignTokens(css, [RED])
    expect(out).toBe(css)
  })

  it('leaves transparent alone (no token has it)', () => {
    const css = '.x { background-color: transparent; }'
    const out = applyDesignTokens(css, [RED])
    expect(out).toBe(css)
  })

  it('with threshold: 0 requires an exact match', () => {
    const css = '.x { color: #fe0000; }'
    const out = applyDesignTokens(css, [RED], { threshold: 0 })
    expect(out).toBe(css)
  })

  it('applies multiple rewrites in a single CSS string', () => {
    const css = '.x { color: #ff0000; background-color: #0000ff; }'
    const out = applyDesignTokens(css, [RED, BLUE])
    expect(out).toContain('color: var(--primary)')
    expect(out).toContain('background-color: var(--secondary)')
  })

  it('rewrites a captured rgb() function when it matches a token', () => {
    const css = '.x { color: rgb(255, 0, 0); }'
    const out = applyDesignTokens(css, [RED])
    expect(out).toContain('color: var(--primary)')
  })
})

describe('tokensFromSite', () => {
  it('returns an empty list for null', () => {
    expect(tokensFromSite(null)).toEqual([])
  })

  it('returns an empty list for a site with no framework settings', () => {
    expect(tokensFromSite({ settings: {} })).toEqual([])
  })

  it('returns an empty list for a site with no color tokens', () => {
    expect(tokensFromSite({ settings: { framework: { colors: { tokens: [] } } } })).toEqual([])
  })

  it('extracts --<slug> tokens from framework color settings', () => {
    const site = {
      settings: {
        framework: {
          colors: {
            tokens: [
              { slug: 'primary', lightValue: '#ff0000', darkValue: '' },
              { slug: 'secondary', lightValue: '#0000ff', darkValue: '' },
            ],
          },
        },
      },
    }
    const tokens = tokensFromSite(site)
    expect(tokens).toEqual([
      { name: '--primary', value: '#ff0000', kind: 'color' },
      { name: '--secondary', value: '#0000ff', kind: 'color' },
    ])
  })

  it('skips tokens with empty slug or empty lightValue', () => {
    const site = {
      settings: {
        framework: {
          colors: {
            tokens: [
              { slug: '', lightValue: '#ff0000' },
              { slug: 'good', lightValue: '' },
              { slug: 'kept', lightValue: '#00ff00' },
            ],
          },
        },
      },
    }
    expect(tokensFromSite(site)).toEqual([
      { name: '--kept', value: '#00ff00', kind: 'color' },
    ])
  })
})
