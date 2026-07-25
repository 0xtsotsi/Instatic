---
id: website-design
name: Website Design
description: Curated guidance for designing distinctive, accessible, responsive websites inside Instatic's visual editor.
version: 1.0.0
tags: [website, design, accessibility, responsive]
---

# Website Design

This skill applies to every site-scope task in Instatic. It is guidance, not
a checklist — read the user's prompt, then pick the techniques that fit.

## 1. Discovery before design

Before you write any HTML, write down three things in your reply (not in code):

- **Audience.** Who is this for? A solo founder's portfolio reads nothing like a
  B2B SaaS landing page or a neighborhood bakery's storefront. The words, the
  imagery, the density of motion all start here.
- **One sentence goal.** What must the visitor *do* — book, sign up, read, buy,
  call? If the page doesn't move them toward that, cut it.
- **Tone in three adjectives.** "Calm, considered, premium." "Loud, fast,
  chaotic." "Friendly, neighborhood, hand-made." These adjectives are the lens
  every later choice passes through.

If the user hasn't said these things, ask — design without a clear audience
and goal produces generic output, which is the failure mode this skill exists
to prevent.

## 2. Hierarchy and structure

A well-designed page has a single, visible hierarchy. Concretely:

- **One primary heading per viewport.** The h1 carries the page's promise.
  Don't bury it inside a hero with three competing CTAs.
- **Two levels of section hierarchy, no more.** A reader should always know
  "which section am I in, and where does the next thing happen." If you need
  a third, you're probably trying to fit two pages on one screen.
- **Choose between long-scroll and a hand-off of pages.** A single product
  page works as long-scroll; a marketing site usually needs 3–5 linked pages.
  Don't pick the long-scroll for a multi-product catalog.

Concretely: plan sections as `<section>` siblings, each with a single
purpose. Section padding should be in `var(--space-*)` tokens, not raw px,
so the rhythm scales between breakpoints.

## 3. Responsive layout

Design responsive *from the start*, not as a fixup. The breakpoint the
suffix names already include tablet and mobile widths.

- **Three breakpoints is enough.** Most sites use mobile (≤640), tablet
  (≤960), desktop (≥961). Don't invent more.
- **Type scale, not magic numbers.** Use the existing `--text-*` tokens; if
  the page needs a new size, add it as a token first.
- **Stack on mobile, not "shrink."** A 2-column desktop layout collapses to
  a single column on mobile. Don't try to keep two side-by-side columns
  with smaller text — it's unreadable.
- **Test scroll behaviour.** A landing page should never horizontally scroll
  on mobile. Check by reading the suffix's breakpoint widths and writing
  one `@media` block per breakpoint that targets the layout, not the type.

## 4. Accessibility

- **Semantic HTML.** Use `<main>`, `<nav>`, `<header>`, `<footer>`, `<article>`,
  `<section>`, `<h1>`–`<h6>`, `<button>`, `<a>`. Not `<div onClick>`.
- **Visible focus.** Every interactive element must have a visible focus
  state. The default browser focus ring is fine; just don't `outline: none`.
- **Contrast.** Body text against its background should be at least 4.5:1.
  Large text (≥24px regular or ≥18.66px bold) needs 3:1.
- **Labels.** Every form input needs a `<label>` connected by `for`/`id`.
  Placeholder text is not a label.
- **Skip links.** Add a "Skip to main content" link as the first focusable
  element on the page.

## 5. Design tokens first

A consistent design comes from tokens, not from repeated literals. The
suffix's "Tokens —" line tells you what's already there. If it's empty,
this is the first thing to set up.

- **Colors**: pick a 5–7 color palette (background, surface, primary,
  secondary, accent, text, text-muted). Don't ship a 20-color palette.
- **Type scale**: `--text-xs` through `--text-4xl` is enough for most pages.
  Use a modular scale (1.2 or 1.25) so the proportions are pleasant.
- **Spacing**: `--space-3xs` through `--space-3xl` in a geometric sequence.
  This is the single biggest source of visual consistency.
- **Fonts**: at most two — one for headings, one for body. Pick a body font
  that reads at 16px; a heading font that looks distinctive at 32px.

When in doubt, fewer tokens beat more. Five well-chosen tokens used
everywhere beat twenty tokens used two-thirds of the time.

## 6. Non-generic visual direction

"Generic" is the failure that motivates this skill. Concretely:

- **No stock gradients.** A linear gradient from teal to purple is the
  shorthand for "this is a template." Use it only if the brand actually
  asked for it.
- **No centered-everything hero.** A bold visual on one side, copy on the
  other, is more interesting than a centered "Welcome to [Site]" headline.
- **Real imagery, not placeholders.** If you must placehold, use a clearly
  authored placeholder rectangle with a label in the design system color
  — never a stock photo.
- **Distinctive wordmark/heading.** Boring sans-serif headings at
  default weight blend into the background. Pick a font that has a
  distinctive letter shape (a high-contrast serif, a tight geometric
  sans, a hand-drawn display face) and use it for one element only.
- **Asymmetric grids.** A 12-column grid where everything is at columns
  2–10 is the same as no grid. Use the full width and break the grid
  intentionally at one or two places per page.

## 7. Content realism

The default failure mode is "lorem ipsum on a stock background." Don't.

- **Real product names, real numbers.** If the user said "we have 12
  integrations," name them. If they said "we were founded in 2019," say
  it. The more real the content, the more useful the design.
- **Specifics beat superlatives.** "The fastest ship tracker on the
  west coast" beats "the best logistics platform."
- **No marketing fluff.** Avoid words like "seamless," "robust,"
  "innovative," "cutting-edge," "next-generation." They say nothing.
- **Testimonials with attribution.** Anonymous quotes are worthless. Pull
  a real name, title, and company — even if you have to flag it as a
  placeholder for the user to fill in.

## 8. Preview-driven iteration

A page is not done until it has been viewed at every breakpoint AND has
been navigated end-to-end.

- **Open the preview** after every two or three sections. Don't write
  the whole page blind.
- **Switch breakpoints** explicitly. The suffix lists them; read each
  one against your layout.
- **Read the rendered HTML** with `site_read_document` after each
  significant edit. The HTML you wrote is not the HTML the editor
  stored — the importer may have transformed it.
- **Iterate one section at a time.** If a section feels wrong, fix it
  before moving on. Two wrong sections compound into a wrong page.

## 9. When in doubt

- **Read the page aloud.** If the copy doesn't read well, the design
  won't either.
- **Cut before you add.** A weaker section you remove is a stronger
  page you keep.
- **Stay inside the design system.** Every literal value in your CSS is
  a place the system can drift. If you find yourself writing `12px`,
  ask why it isn't `var(--space-3xs)`.
