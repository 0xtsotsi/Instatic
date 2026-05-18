/**
 * Dynamic prop binding — resolves runtime values from the publisher's
 * entry stack into a node's static props at render time.
 *
 * The stack semantics are the heart of how templates compose with loops:
 *  - The publisher seeds the stack with the page's primary entry when
 *    rendering a single-entry content template.
 *  - The `base.loop` renderer pushes each iteration's item onto the stack
 *    before recursing into the loop's child subtree, then pops on exit.
 *  - `dynamicBindings.source: 'currentEntry'` always reads the stack top,
 *    i.e. "the closest enclosing entity". Inside a loop nested in a
 *    template, that's the loop iteration; outside the loop it's still
 *    the template entry.
 *  - `dynamicBindings.source: 'parentEntry'` reads one frame below the
 *    top — useful inside a loop nested in a template, where you want to
 *    refer to the outer template entry from inside an iteration.
 *
 * Field lookup is generic: each `LoopItem` carries a `fields` map, and
 * the resolver simply reads `fields[binding.field]`. Format coercions
 * (e.g. markdown → HTML for body bindings with `format: 'html'`) happen
 * here as a thin shim so already-persisted bindings keep working without
 * the source needing to pre-render every variant.
 */

import type { DynamicPropBinding } from '@core/page-tree'
import type { LoopItem } from '@core/loops/types'
import { renderMarkdownToHtml } from '@core/markdown/renderMarkdown'
import type {
  PageFrame,
  SiteFrame,
  ViewerFrame,
  RouteFrame,
} from './contextFrames'
import {
  containsTokens,
  interpolateTokens,
  readFrame,
  walkFieldPath,
} from './tokenInterpolation'

/**
 * Render-time context handed to the publisher.
 *
 * `entryStack` is mutated in place by the publisher's loop interceptor
 * (push on iteration enter, pop on iteration exit). Stack-top resolves
 * `source: 'currentEntry'`; one below resolves `source: 'parentEntry'`.
 *
 * The four named frames (`page`, `site`, `viewer`, `route`) are always
 * provided on every render — they're built once by the publisher and
 * referenced by the corresponding binding sources. Anonymous renders
 * pass `viewer: null`; bindings against null frames resolve to empty.
 *
 * Frames are stable references across the whole render pass; the loop
 * interceptor only mutates `entryStack`. This keeps the resolver
 * branchless for the common case (frame lookup is a property read).
 */
export interface TemplateRenderDataContext {
  entryStack: LoopItem[]
  page?: PageFrame
  site?: SiteFrame
  viewer?: ViewerFrame | null
  route?: RouteFrame
}

/**
 * Resolve a single binding to its runtime value.
 *
 * Dispatch by source:
 *   - `currentEntry` / `parentEntry` — read from the entry stack
 *     (top / second-from-top).
 *   - `page` / `site` / `viewer` / `route` — read from the corresponding
 *     named frame on the context.
 *
 * Returns `undefined` for fields that don't exist on the resolved frame
 * (or when the requested frame doesn't exist) — the caller decides
 * whether to fall back to the static prop or substitute an empty value.
 *
 * Field paths are dotted (`author.name`, `parent.slug`). The first
 * segment opens against the frame; subsequent segments walk plain
 * objects via `walkFieldPath`. Multi-segment paths against `currentEntry`
 * are how relation traversal will be wired (Phase 6) — until that lands,
 * only the first segment is meaningful for relations, which matches
 * legacy single-segment binding semantics.
 *
 * `readFrame` / `walkFieldPath` are shared with the token interpolator
 * — both live in `./tokenInterpolation.ts` to avoid duplication.
 */
function resolveBindingValue(
  binding: DynamicPropBinding,
  context: TemplateRenderDataContext,
): unknown {
  const frame = readFrame(binding.source, context)
  if (!frame) return undefined

  const value = walkFieldPath(frame, binding.field)

  // Markdown shim: when a binding targets the `body` cell (post-type rows)
  // or any `richText` field stored as markdown and the binding requests
  // `format: 'html'`, render markdown to HTML here so the module receives
  // ready-to-embed HTML rather than raw markdown. Tokens embedded inside
  // the body markdown are interpolated FIRST so authors can write
  // `Hello {viewer.displayName|guest}` directly in a blog post body and
  // have it resolve against the same render context as page props.
  if (
    binding.format === 'html' &&
    typeof value === 'string' &&
    (binding.field === 'body' || binding.field === 'bodyMarkdown')
  ) {
    const interpolated = containsTokens(value) ? interpolateTokens(value, context) : value
    return renderMarkdownToHtml(interpolated)
  }

  return value
}

export function resolveDynamicProps(
  staticProps: Record<string, unknown>,
  bindings: Record<string, DynamicPropBinding> | undefined,
  context: TemplateRenderDataContext | undefined,
): Record<string, unknown> {
  if (!context) {
    // No render context — still pass through static props. Tokens inside
    // strings need a context to resolve, so they're left untouched.
    return staticProps
  }

  // Step 1: legacy single-binding overrides (for non-string props, this
  // is the only way a prop gets a dynamic value).
  let resolved: Record<string, unknown> | null = null
  if (bindings) {
    resolved = { ...staticProps }
    for (const [propKey, binding] of Object.entries(bindings)) {
      const value = resolveBindingValue(binding, context)
      if (value === undefined || value === null) {
        if (binding.fallback === 'empty') resolved[propKey] = ''
        continue
      }
      resolved[propKey] = value
    }
  }

  // Step 2: token interpolation for every string-typed prop value. Both
  // the original static props and any string overwritten by step 1 are
  // re-examined — a binding result might itself contain tokens
  // (uncommon but well-defined). The fast path inside
  // `interpolateTokens` skips work for strings with no token markers.
  const target = resolved ?? staticProps
  let mutated = resolved !== null
  for (const key of Object.keys(target)) {
    const v = target[key]
    if (typeof v !== 'string') continue
    if (!containsTokens(v)) continue
    if (!mutated) {
      resolved = { ...staticProps }
      mutated = true
    }
    resolved![key] = interpolateTokens(v, context)
  }

  return resolved ?? staticProps
}
