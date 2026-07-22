/**
 * Instatic-side: walk captured HTML and assign `uid="<id>"` attributes
 * to every element, matching the page-tree node id format used elsewhere
 * in Instatic.
 *
 * Instatic's id format is a 12-character base62 string (the same
 * alphabet used by nanoid / standard short-id libraries). We use
 * nanoid with a length override to keep the generator in lock-step
 * with the rest of the codebase (see src/core/page-tree/scopedClassClone.ts
 * which already calls nanoid() for class ids).
 *
 * PURE: no Instatic imports, no DB. The lazy `require('linkedom')` keeps
 * happy-dom's global `document` from being picked up by the test runner
 * via top-level evaluation — linkedom only loads when assignUids is
 * actually called.
 */

/** Default uid length, matching the Instatic page-tree node id shape. */
export const UID_LENGTH = 12

const BASE62_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Generate a base62 uid of the given length. We use a custom base62
 * generator rather than nanoid directly so the output stays strictly
 * base62 (nanoid's default alphabet uses `-` and `_`, which we don't
 * want inside an HTML attribute value).
 */
export function generateUid(length: number = UID_LENGTH): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += BASE62_ALPHABET[Math.floor(Math.random() * BASE62_ALPHABET.length)]
  }
  return out
}

export interface AssignUidsOptions {
  /** Uids that must not be reused (existing page-tree ids, caller-owned ids). */
  reservedUids?: Set<string>
  /** Maximum number of retry attempts when the random generator collides. Default 100. */
  maxAttempts?: number
}

/**
 * Walk `html`, attach `uid="<base62>"` to every element, return the
 * rewritten HTML and the list of assigned uids (in document order).
 *
 * Existing `uid` attributes on elements are replaced with a fresh uid —
 * the captured HTML is the source of truth for content, not the
 * capture pipeline's identifier space.
 */
export function assignUids(
  html: string,
  options: AssignUidsOptions = {},
): { html: string; uids: string[] } {
  const reserved = options.reservedUids ?? new Set<string>()
  const maxAttempts = options.maxAttempts ?? 100
  const uids: string[] = []
  const seen = new Set<string>(reserved)

  // Lazy-load linkedom so happy-dom's `document` global (used by other
  // capture tests) doesn't get picked up by our function via top-level
  // import hoisting.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseHTML } = require('linkedom') as typeof import('linkedom')
  const { document } = parseHTML(html)

  // linkedom returns a document with a null documentElement for empty input.
  // Treat that as "nothing to do".
  if (!document.documentElement) {
    return { html, uids: [] }
  }

  function gen(): string {
    for (let i = 0; i < maxAttempts; i++) {
      const u = generateUid()
      if (!seen.has(u)) return u
    }
    throw new Error(`failed to generate a unique uid after ${maxAttempts} attempts`)
  }

  const all: Element[] = []
  for (const el of document.querySelectorAll('*')) all.push(el as Element)

  for (const el of all) {
    const uid = gen()
    uids.push(uid)
    seen.add(uid)
    el.setAttribute('uid', uid)
  }

  return { html: document.documentElement.outerHTML, uids }
}