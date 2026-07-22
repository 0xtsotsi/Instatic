/**
 * Instatic-side: reads site design tokens (via site_read_styles) and rewrites
 * a captured CSS sheet to use var(--*) where a token is a close match.
 * Task 6 will fill this in.
 */
export function applyDesignTokens(
  _css: string,
  _siteStyles: { className: string; declarations: Record<string, string> }[],
): string {
  throw new Error('not implemented (Task 6)')
}
