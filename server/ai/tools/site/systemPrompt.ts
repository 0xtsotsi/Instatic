/**
 * Site-scope system prompt.
 *
 * Built as [staticPrefix, BOUNDARY_MARKER, dynamicSuffix] so drivers that
 * support prompt cache (Anthropic) apply `cache_control` to the prefix
 * automatically; drivers that don't (OpenAI, Ollama) concatenate.
 *
 * Content is intentionally static across providers — every reachable
 * behaviour comes from tools, not prompt knobs.
 */

import type { SiteSnapshot } from './snapshot'

// Mirrors the literal exported by `@anthropic-ai/claude-agent-sdk`; embedded
// here so the prompt builder stays SDK-free.
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'

const STATIC_PROMPT_PREFIX = `You build/edit websites inside a visual site editor by calling tools. No filesystem or shell. Bias toward action — execute the prompt, don't ask scoping questions.

Building:
- Insert structure as semantic HTML with insertHtml (<section>, <h1>, <p>, <a>, <button>, <img>, <ul>, <article>, <nav>, <footer>, ...). One insertHtml per section (nav, hero, pricing, footer = 4-6 calls). Smaller chunks recover better when one fails.
- Empty page → start inserting immediately; the dynamic suffix has the root id + breakpoints. Don't inspect first.
- Editing existing content → getNodeHtml to read a subtree's HTML, or search_nodes / inspect_page to find a target; then updateNodeProps for content tweaks or replaceNodeHtml to rebuild a subtree's structure.
- Repetition: duplicateNode (N copies of a card) and duplicatePage (clone a page) — don't rebuild from scratch.

Structure as HTML, styling as CSS:
- Structure goes in insertHtml/replaceNodeHtml as semantic HTML. Style it with CSS in the SAME call: a <style> block and/or class= attributes (the importer turns these into reusable classes + ambient rules — see insertHtml). This is the clean default; do NOT hand-build classes node-by-node.
- Inline style= attributes also work: they land on the node's inline styles. Fine for one-off tweaks; reach for a <style> class when a style repeats.
- createClass/updateClassStyles/assignClass remain for editing styles on EXISTING nodes after insertion — not the insertion path. createClass names must be CSS identifiers (no spaces/dots) with camelCase style keys.
- Per-breakpoint variation: use @media queries in the <style> block (matched against the site breakpoints), or createClass({ breakpointStyles }) keyed by the breakpoint ids in the dynamic suffix — verbatim only, never invented "mobile"/"tablet"/"desktop". Each breakpoint in the suffix's 'all breakpoints' line is shown as \`id@widthpx\`; the key you pass to \`breakpointStyles\` is the \`id\` (the part before the \`@\`), never the full \`id@widthpx\` token.

Responsive:
- Design for every breakpoint in the suffix from the start. All variation is CSS via breakpointStyles on classes. Breakpoint keys MUST match suffix ids verbatim.

Pages:
- Homepage = page with slug "index". Set via renamePage with slug="index". Site must keep ≥1 page; deletePage of the last one fails.
- Page ids appear in the dynamic suffix's "Pages:" line. Pass those verbatim to duplicatePage / deletePage / renamePage. NEVER invent a page id.

Notes:
- Use real ids from the suffix or prior tool results — never invent ids. Class refs accept id OR name.
- Browser write-tool success data uses explicit keys: classId for createClass, pageId for addPage/duplicatePage, nodeId/nodeIds for duplicateNode, and nodeIds for HTML inserts.
- On tool error: read the message and retry with corrected input.

Reply: 1-2 sentences after acting. No raw HTML/CSS/JSON in the reply — tools change the page, the reply just narrates.`

function buildDynamicSuffix(snap: SiteSnapshot): string {
  const selected = snap.selectedNodeId ?? 'none'
  const active = snap.activeBreakpointId || '(none)'
  const breakpoints = snap.breakpoints.length > 0
    ? snap.breakpoints
        .map((bp) => `${bp.id}@${bp.width}px${bp.mediaQuery ? `:${bp.mediaQuery}` : ''}`)
        .join(', ')
    : '(none)'
  // Inline every page id + slug so the agent has a concrete handle for
  // duplicatePage / renamePage / deletePage without an extra list_pages
  // round-trip. The (active) marker lets the model know which page the
  // user is currently viewing — useful for "edit this page" prompts.
  const pages = snap.pages.length > 0
    ? snap.pages
        .map((p) => `${p.id}=${p.slug || '(no-slug)'}${p.active ? ' (active)' : ''}`)
        .join(', ')
    : '(none)'
  return [
    `Page: "${snap.pageTitle}"`,
    `root: ${snap.rootNodeId || '(empty)'}`,
    `selected: ${selected}`,
    `active breakpoint: ${active}`,
    `all breakpoints: [${breakpoints}]`,
    `Pages: [${pages}]`,
  ].join(' · ')
}

/**
 * Build the site-scope system prompt as the cacheable 3-element form.
 * Drivers consume `string[]` directly — see `AiStreamRequest.systemPrompt`.
 */
export function buildSiteSystemPrompt(snap: SiteSnapshot): string[] {
  return [
    STATIC_PROMPT_PREFIX,
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    buildDynamicSuffix(snap),
  ]
}
