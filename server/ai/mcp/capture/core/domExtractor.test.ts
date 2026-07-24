/**
 * Tests for the pure TypeScript DOM walker.
 *
 * The walker is exercised directly in-process by handing it a happy-dom
 * Window. happy-dom has a known bug in v20 where the Window proxy does
 * not expose JS-runtime globals (SyntaxError, TypeError, Error) — so
 * the SelectorParser blows up with "undefined is not a constructor".
 * The makeCtx helper patches those constructors onto the Window
 * instance before any querySelector call, which sidesteps the bug.
 *
 * Tests are scoped to the pure walker. Page-side execution (the
 * Playwright fetcher) is covered by Task 6's integration test, gated
 * on CAPTURE_LIVE=1.
 */
import { describe, expect, it } from 'bun:test'
import { Window } from 'happy-dom'
import {
  COMPUTED_PROPS,
  extractDom,
  PAGE_WALKER_SOURCE,
  type ExtractContext,
} from './domExtractor'

/** Build an ExtractContext backed by a fresh happy-dom Window. */
function makeCtx(html: string): ExtractContext {
  const win = new Window()
  // happy-dom v20 quirk: the Window proxy doesn't expose native constructors,
  // so internal SelectorParser blows up when it tries `new this.window.SyntaxError`.
  // Pinning the natives onto the instance unblocks querySelector.
  ;(win as unknown as Record<string, unknown>).SyntaxError = SyntaxError
  ;(win as unknown as Record<string, unknown>).TypeError = TypeError
  ;(win as unknown as Record<string, unknown>).Error = Error
  win.document.write(html)
  return {
    document: win.document,
    window: win as unknown as Window & typeof globalThis,
    html,
    close: async () => {},
  }
}

const FIXTURE = `
<div class="root">
  <h1>Title</h1>
  <p class="body"><span>hi</span></p>
  <div class="x"></div>
  <div class="x"></div>
</div>
`

/**
 * Page with a hero section and a separate footer section. Used to verify
 * that scope=subtree narrows the walk to the matched subtree only — no
 * ancestors, no siblings, no other sections.
 */
const MULTI_SECTION_FIXTURE = `
<main>
  <section class="hero">
    <h1>Hello</h1>
    <p>Subtitle</p>
    <button>CTA</button>
  </section>
  <section class="features">
    <article>One</article>
    <article>Two</article>
  </section>
  <footer>
    <small>(c) 2026</small>
  </footer>
</main>
`

describe('extractDom (pure TypeScript walker)', () => {
  it('walks depth-first with maxDepth Infinity', () => {
    const ctx = makeCtx(FIXTURE)
    const nodes = extractDom({ selector: '.root', maxDepth: Infinity }, ctx)
    const tags = nodes.map((n) => (n.outerHTML.match(/^<(\w+)/) ?? [])[1])
    expect(tags).toEqual(['div', 'h1', 'p', 'span', 'div', 'div'])
    // Selectors chain up from the root.
    expect(nodes[0]!.selector).toBe('div')
    expect(nodes[1]!.selector).toBe('div > h1')
    expect(nodes[2]!.selector).toBe('div > p')
    expect(nodes[3]!.selector).toBe('div > p > span')
  })

  it('disambiguates same-tag siblings with :nth-of-type', () => {
    const ctx = makeCtx(FIXTURE)
    const nodes = extractDom({ selector: '.root', maxDepth: 1 }, ctx)
    const lastTwo = nodes.slice(-2).map((n) => n.selector)
    expect(lastTwo).toEqual(['div > div', 'div > div:nth-of-type(2)'])
  })

  it('maxDepth: 0 returns only the root element', () => {
    const ctx = makeCtx(FIXTURE)
    const nodes = extractDom({ selector: '.root', maxDepth: 0 }, ctx)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.selector).toBe('div')
  })

  it('maxDepth: 1 returns root + direct children (no grandchildren)', () => {
    const ctx = makeCtx(FIXTURE)
    const nodes = extractDom({ selector: '.root', maxDepth: 1 }, ctx)
    expect(nodes).toHaveLength(5)
    const tags = nodes.map((n) => (n.outerHTML.match(/^<(\w+)/) ?? [])[1])
    expect(tags).toEqual(['div', 'h1', 'p', 'div', 'div'])
    expect(nodes.find((n) => n.selector === 'div > p > span')).toBeUndefined()
  })

  it('non-existent selector returns an empty array', () => {
    const ctx = makeCtx(FIXTURE)
    const nodes = extractDom({ selector: '.nope', maxDepth: Infinity }, ctx)
    expect(nodes).toEqual([])
  })

  it('selector matching multiple elements returns only the first', () => {
    const ctx = makeCtx(FIXTURE)
    const nodes = extractDom({ selector: '.x', maxDepth: Infinity }, ctx)
    expect(nodes).toHaveLength(1)
  })

  it('selector: null captures the document body', () => {
    const ctx = makeCtx(
      '<html><body><main><p>x</p></main></body></html>',
    )
    const nodes = extractDom({ selector: null, maxDepth: 2 }, ctx)
    expect(nodes.length).toBeGreaterThanOrEqual(1)
    expect(nodes[0]!.outerHTML.toLowerCase()).toContain('<body>')
  })

  it('captures computed styles (object shape, not value-correctness)', () => {
    // happy-dom does not implement every CSS property, so we assert on
    // the SHAPE of the output rather than specific values. The Playwright
    // fetcher's integration test (Task 6) is the source of truth for
    // value correctness.
    const ctx = makeCtx(FIXTURE)
    const nodes = extractDom({ selector: '.root', maxDepth: 1 }, ctx)
    const h1 = nodes.find((n) => n.outerHTML.startsWith('<h1'))
    expect(h1).toBeTruthy()
    expect(typeof h1!.computedStyles).toBe('object')
    for (const [prop, v] of Object.entries(h1!.computedStyles)) {
      expect(typeof prop).toBe('string')
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
    }
  })

  it('scope=subtree (selector + maxDepth: Infinity) returns ONLY the matched subtree, not ancestors or siblings', () => {
    // Regression guard for the capture_from_url scope=subtree bug: the
    // fetcher used to hard-code selector:null + maxDepth:Infinity, so the
    // scope argument was validated but ignored. Here we assert the walker
    // itself narrows correctly when given a selector + Infinity depth.
    const ctx = makeCtx(MULTI_SECTION_FIXTURE)
    const nodes = extractDom({ selector: '.hero', maxDepth: Infinity }, ctx)
    const tags = nodes.map((n) => (n.outerHTML.match(/^<(\w+)/) ?? [])[1])
    // .hero is a <section> with three direct children; none of the other
    // sections or the footer must appear.
    expect(tags).toEqual(['section', 'h1', 'p', 'button'])
    // No leakage from outside the subtree.
    expect(nodes.some((n) => n.outerHTML.includes('features'))).toBe(false)
    expect(nodes.some((n) => n.outerHTML.includes('footer'))).toBe(false)
    expect(nodes.some((n) => n.outerHTML.includes('<main'))).toBe(false)
  })

  it('scope=element (selector + maxDepth: 0) returns only the matched element', () => {
    // Regression guard for the capture_from_url scope=element case.
    const ctx = makeCtx(MULTI_SECTION_FIXTURE)
    const nodes = extractDom({ selector: '.hero', maxDepth: 0 }, ctx)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.outerHTML.toLowerCase()).toContain('class="hero"')
    // No descendants of the matched element are included.
    expect(nodes.some((n) => n.outerHTML.startsWith('<h1'))).toBe(false)
    expect(nodes.some((n) => n.outerHTML.startsWith('<p'))).toBe(false)
    expect(nodes.some((n) => n.outerHTML.startsWith('<button'))).toBe(false)
  })
})

describe('COMPUTED_PROPS', () => {
  it('has between 30 and 60 entries', () => {
    expect(COMPUTED_PROPS.length).toBeGreaterThanOrEqual(30)
    expect(COMPUTED_PROPS.length).toBeLessThanOrEqual(60)
  })

  it('includes key properties for typography and layout', () => {
    expect(COMPUTED_PROPS).toContain('color')
    expect(COMPUTED_PROPS).toContain('font-size')
    expect(COMPUTED_PROPS).toContain('display')
    expect(COMPUTED_PROPS).toContain('position')
  })

  it('has no duplicates', () => {
    expect(new Set(COMPUTED_PROPS).size).toBe(COMPUTED_PROPS.length)
  })
})

describe('PAGE_WALKER_SOURCE (page-side bridge)', () => {
  // The Playwright fetcher ships PAGE_WALKER_SOURCE into the page's V8 via
  // page.evaluate, where it runs inside a self-invoking function whose
  // args are JSON-baked at the call site:
  //   page.evaluate(
  //     `(function (target, COMPUTED_PROPS_) { ${PAGE_WALKER_SOURCE}
  //       return runExtract(target, COMPUTED_PROPS_);
  //     })(${JSON.stringify(target)}, ${JSON.stringify(props)})`,
  //   )
  // Playwright serialises string expressions by source and runs them in
  // the page's V8. PAGE_WALKER_SOURCE has to be plain JS that declares
  // every helper the trailing `runExtract` call uses — no `new Function`
  // host side, no closure bridging.
  it('is a non-empty string', () => {
    expect(typeof PAGE_WALKER_SOURCE).toBe('string')
    expect(PAGE_WALKER_SOURCE.length).toBeGreaterThan(0)
  })

  it('declares the walker helpers the fetcher depends on', () => {
    expect(PAGE_WALKER_SOURCE).toContain('function runExtract(')
    expect(PAGE_WALKER_SOURCE).toContain('function walk(')
    expect(PAGE_WALKER_SOURCE).toContain('function uniqueSelector(')
    expect(PAGE_WALKER_SOURCE).toContain('function captureStyles(')
  })

  it('closes runExtract on its own — the fetcher appends the trailing call', () => {
    expect(PAGE_WALKER_SOURCE.trimEnd().endsWith('return out;\n}')).toBe(true)
  })

  it('runs end-to-end inside a happy-dom realm via the fetcher\'s wrapper shape', () => {
    // Re-create the page-side shape the fetcher uses: an IIFE whose body
    // inlines PAGE_WALKER_SOURCE and then calls runExtract on the JSON-
    // baked args. PAGE_WALKER_SOURCE references `document` and `window`
    // as bare globals (which is correct in a real page's V8). In this
    // test we bridge happy-dom's realm into the function body by
    // materialising the source via `new Function`, binding `this` to the
    // happy-dom Window, and aliasing `document` and `window` to the
    // realm-bound versions. This is the closest in-process approximation
    // of the page-side execution the fetcher triggers in production;
    // the actual page-side run is exercised by the Playwright integration
    // test gated on CAPTURE_LIVE=1.
    const win = new Window()
    ;(win as unknown as Record<string, unknown>).SyntaxError = SyntaxError
    ;(win as unknown as Record<string, unknown>).TypeError = TypeError
    ;(win as unknown as Record<string, unknown>).Error = Error
    win.document.write(FIXTURE)
    const realmWindow = win as unknown as { document: unknown; window: unknown }
    const body = [
      'var document = this.document;',
      'var window = this.window;',
      PAGE_WALKER_SOURCE,
      'return runExtract(target, COMPUTED_PROPS_);',
    ].join('\n')
    const fn = new Function(
      'target',
      'COMPUTED_PROPS_',
      body,
    ) as unknown as (this: { document: unknown; window: unknown }, target: { selector: string | null; maxDepth: number }, props: readonly string[]) => ExtractedNodeFromWalker[]
    const result = fn.call(realmWindow, { selector: '.root', maxDepth: Infinity }, COMPUTED_PROPS)
    expect(Array.isArray(result)).toBe(true)
    const tags = result.map((n) => (n.outerHTML.match(/^<(\w+)/) ?? [])[1])
    expect(tags).toEqual(['div', 'h1', 'p', 'span', 'div', 'div'])
  })
})

type ExtractedNodeFromWalker = {
  selector: string
  outerHTML: string
  computedStyles: Record<string, string>
}
