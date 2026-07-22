/**
 * Apply the site's design tokens to a captured CSS sheet. For every
 * colour property in the captured CSS, find the closest token colour
 * (by CIEDE2000 distance) and rewrite the value to var(--token-name).
 *
 * Threshold: distance < 8 = "indistinguishable to most humans".
 * If the closest token is farther, leave the captured value alone.
 *
 * PURE: no Instatic imports, no DB.
 */

export interface SiteToken {
  name: string
  value: string
  kind?: 'color' | 'length' | 'number' | 'string'
}

export interface ApplyTokensOptions {
  threshold?: number
  strictUnambiguous?: boolean
}

const COLOR_PROPS = new Set([
  'color', 'background-color', 'border-color', 'border-top-color',
  'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline-color', 'text-decoration-color', 'caret-color', 'fill', 'stroke',
])

interface RGB { r: number; g: number; b: number; a: number }

function parseHex(hex: string): RGB | null {
  const m = hex.match(/^#([0-9a-fA-F]{3,8})$/)
  if (!m) return null
  const s = m[1]
  if (s.length === 3 || s.length === 4) {
    const r = parseInt(s[0] + s[0], 16)
    const g = parseInt(s[1] + s[1], 16)
    const b = parseInt(s[2] + s[2], 16)
    const a = s.length === 4 ? parseInt(s[3] + s[3], 16) / 255 : 1
    return { r, g, b, a }
  }
  if (s.length === 6 || s.length === 8) {
    const r = parseInt(s.slice(0, 2), 16)
    const g = parseInt(s.slice(2, 4), 16)
    const b = parseInt(s.slice(4, 6), 16)
    const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }
  return null
}

function parseRgbFunc(s: string): RGB | null {
  const m = s.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/i)
  if (!m) return null
  return {
    r: parseInt(m[1], 10),
    g: parseInt(m[2], 10),
    b: parseInt(m[3], 10),
    a: m[4] !== undefined ? parseFloat(m[4]) : 1,
  }
}

function parseColor(s: string): RGB | null {
  const t = s.trim().toLowerCase()
  if (t === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  return parseHex(t) ?? parseRgbFunc(t)
}

function ciede2000(c1: RGB, c2: RGB): number {
  const toLab = (c: RGB): { L: number; a: number; b: number } => {
    let r = c.r / 255, g = c.g / 255, b = c.b / 255
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100
    let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100
    x /= 95.047; y /= 100.000; z /= 108.883
    x = x > 0.008856 ? Math.pow(x, 1/3) : 7.787 * x + 16/116
    y = y > 0.008856 ? Math.pow(y, 1/3) : 7.787 * y + 16/116
    z = z > 0.008856 ? Math.pow(z, 1/3) : 7.787 * z + 16/116
    return { L: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) }
  }
  const l1 = toLab(c1), l2 = toLab(c2)
  const avgL = (l1.L + l2.L) / 2
  const C1 = Math.sqrt(l1.a * l1.a + l1.b * l1.b)
  const C2 = Math.sqrt(l2.a * l2.a + l2.b * l2.b)
  const avgC = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))))
  const a1p = l1.a * (1 + G), a2p = l2.a * (1 + G)
  const C1p = Math.sqrt(a1p * a1p + l1.b * l1.b)
  const C2p = Math.sqrt(a2p * a2p + l2.b * l2.b)
  const avgCp = (C1p + C2p) / 2
  const h1p = Math.atan2(l1.b, a1p) * 180 / Math.PI + (Math.atan2(l1.b, a1p) < 0 ? 360 : 0)
  const h2p = Math.atan2(l2.b, a2p) * 180 / Math.PI + (Math.atan2(l2.b, a2p) < 0 ? 360 : 0)
  let dhp = h2p - h1p
  if (Math.abs(dhp) > 180) dhp = dhp > 180 ? dhp - 360 : dhp + 360
  const dLp = l2.L - l1.L
  const dCp = C2p - C1p
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360)
  const avgHp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2
  const T = 1 - 0.17 * Math.cos((avgHp - 30) * Math.PI / 180) +
              0.24 * Math.cos(2 * avgHp * Math.PI / 180) +
              0.32 * Math.cos((3 * avgHp + 6) * Math.PI / 180) -
              0.20 * Math.cos((4 * avgHp - 63) * Math.PI / 180)
  const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2))
  const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)))
  const Sl = 1 + (0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2))
  const Sc = 1 + 0.045 * avgCp
  const Sh = 1 + 0.015 * avgCp * T
  const Rt = -Math.sin(2 * dTheta * Math.PI / 180) * Rc
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
    Math.pow(dCp / Sc, 2) +
    Math.pow(dHp / Sh, 2) +
    Rt * (dCp / Sc) * (dHp / Sh)
  )
}

export function applyDesignTokens(
  css: string,
  tokens: SiteToken[],
  options: ApplyTokensOptions = {},
): string {
  const threshold = options.threshold ?? 8
  const strict = options.strictUnambiguous ?? true
  const colorTokens = tokens
    .filter((t) => (t.kind ?? 'color') === 'color')
    .map((t) => ({ name: t.name, value: t.value, rgb: parseColor(t.value) }))
    .filter((t) => t.rgb !== null) as { name: string; value: string; rgb: RGB }[]

  if (colorTokens.length === 0) return css

  return css.replace(
    /([a-zA-Z-]+)\s*:\s*([^;}]+?)\s*(;|})/g,
    (full, prop: string, value: string, term: string) => {
      if (!COLOR_PROPS.has(prop.trim().toLowerCase())) return full
      const rgb = parseColor(value)
      if (!rgb) return full
      if (strict && !/^#[0-9a-fA-F]{3,8}$|^rgba?\(/.test(value.trim().toLowerCase())) return full
      let best: { name: string; dist: number } | null = null
      for (const tok of colorTokens) {
        const dist = ciede2000(rgb, tok.rgb)
        if (best === null || dist < best.dist) best = { name: tok.name, dist }
      }
      if (!best || best.dist > threshold) return full
      return `${prop}: var(${best.name})${term}`
    },
  )
}

/**
 * Extract colour tokens from a live site document. Walks the framework
 * colour settings and produces a flat token list with CSS variable names
 * (--<slug>) and their light-mode values.
 *
 * Instatic-side; the input is whatever `getDraftSiteDocument` returns.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export function tokensFromSite(site: any): SiteToken[] {
  const tokens: SiteToken[] = []
  if (!site || !site.settings || !site.settings.framework) return tokens
  const colors = site.settings.framework.colors
  if (!colors || !Array.isArray(colors.tokens)) return tokens
  for (const t of colors.tokens) {
    if (typeof t.slug !== 'string' || t.slug.length === 0) continue
    if (typeof t.lightValue !== 'string' || t.lightValue.length === 0) continue
    tokens.push({ name: `--${t.slug}`, value: t.lightValue, kind: 'color' })
  }
  return tokens
}
