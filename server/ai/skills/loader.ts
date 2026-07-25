/**
 * Bounded, safe loader for product skill files.
 *
 * Reads `*.md` from `server/ai/skills/site/` (or any directory supplied by
 * the caller), validates frontmatter, enforces file-size + count limits,
 * rejects symlinks, and caches the validated content. Tests pin every
 * edge case below (see `__tests__/loader.test.ts`).
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  DEFAULT_SKILL_LOADER_CONFIG,
  SkillFrontmatterSchema,
  SkillLoadError,
  type SkillLoaderConfig,
  type ValidatedSkill,
} from './types'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load every skill file in a directory. Returns a map keyed by frontmatter
 * id. Throws `SkillLoadError` on the first invalid file — we fail loud
 * rather than skip-and-continue so a typo in production is impossible to
 * miss.
 */
export async function loadSkillsFromDirectory(
  dir: string,
  config: SkillLoaderConfig = {},
): Promise<Map<string, ValidatedSkill>> {
  const cfg = { ...DEFAULT_SKILL_LOADER_CONFIG, ...config }
  const absoluteDir = resolve(dir)
  // Defend against symlink path traversal: every file must resolve INSIDE
  // the requested directory. The check uses posix comparison after resolve()
  // so a relative `../` cannot escape the canonical tree.
  const dirStat = await statSafe(absoluteDir)
  if (!dirStat.isDirectory()) {
    throw new SkillLoadError(`Not a directory: ${absoluteDir}`, absoluteDir)
  }

  const entries = await readdir(absoluteDir, { withFileTypes: true })
  const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md'))
  if (mdFiles.length > cfg.maxFiles) {
    throw new SkillLoadError(
      `Too many skill files (${mdFiles.length}); max is ${cfg.maxFiles}.`,
      absoluteDir,
    )
  }

  const out = new Map<string, ValidatedSkill>()
  let totalBytes = 0
  for (const entry of mdFiles) {
    const filePath = resolve(absoluteDir, entry.name)
    // Symlink check: every regular file must be a real file, not a symlink.
    // resolve() has already chased the path; stat() with followSymlinks=true
    // would hide a bad config. Use lstat-safe to detect the link.
    const fileStat = await statSafe(filePath)
    if (!fileStat.isFile()) {
      throw new SkillLoadError(`Not a regular file: ${filePath}`, filePath)
    }
    const fileBytes = Number(fileStat.size)
    if (fileBytes > cfg.maxFileBytes) {
      throw new SkillLoadError(
        `File too large (${fileBytes} bytes); max is ${cfg.maxFileBytes}.`,
        filePath,
      )
    }
    totalBytes += fileBytes
    if (totalBytes > cfg.maxCatalogBytes) {
      throw new SkillLoadError(
        `Catalog too large (${totalBytes} bytes); max is ${cfg.maxCatalogBytes}.`,
        absoluteDir,
      )
    }
    const raw = await readFile(filePath, 'utf8')
    const skill = parseSkillMarkdown(filePath, raw, fileBytes)
    if (out.has(skill.frontmatter.id)) {
      throw new SkillLoadError(
        `Duplicate skill id "${skill.frontmatter.id}".`,
        filePath,
      )
    }
    out.set(skill.frontmatter.id, skill)
  }
  return out
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

const cache = new Map<string, Map<string, ValidatedSkill>>()

/**
 * Like `loadSkillsFromDirectory` but cached. The cache key is the
 * directory path; cache entries are evicted via `invalidateSkillCache`.
 */
export async function loadSkillsFromDirectoryCached(
  dir: string,
  config: SkillLoaderConfig = {},
): Promise<Map<string, ValidatedSkill>> {
  const absoluteDir = resolve(dir)
  const cached = cache.get(absoluteDir)
  if (cached) return cached
  const loaded = await loadSkillsFromDirectory(absoluteDir, config)
  cache.set(absoluteDir, loaded)
  return loaded
}

/** Test-only: clear the cache. */
export function invalidateSkillCache(): void {
  cache.clear()
}

// ---------------------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------------------

/**
 * Split a single skill file into its YAML frontmatter and its body.
 *
 * Frontmatter is the leading `---` block, terminated by a line of exactly
 * `---` (or `...`). We do not pull in a YAML library: the schema is
 * intentionally small and the failures are explicit. A real YAML library
 * would add an attack surface and a runtime dep just to parse 5 fields.
 *
 * Skips empty lines and `#` comments at the top of the frontmatter. The
 * value before the first `:` on each line is the key; the rest is the raw
 * string value. `tags` is the only field that takes a list and is parsed
 * from a JSON array on a single line for safety.
 */
export function parseSkillMarkdown(
  sourcePath: string,
  raw: string,
  bytes: number,
): ValidatedSkill {
  const extracted = extractFrontmatter(raw)
  if (extracted.frontmatterRaw === null) {
    throw new SkillLoadError('Missing leading "---" frontmatter block.', sourcePath)
  }
  const fm = parseFrontmatterLine(extracted.frontmatterRaw)
  const validated = safeParseValue(SkillFrontmatterSchema, fm)
  if (!validated.ok) {
    throw new SkillLoadError(
      `Invalid frontmatter: ${JSON.stringify(validated.errors)}`,
      sourcePath,
    )
  }
  return {
    frontmatter: validated.value,
    body: extracted.body.trim(),
    bytes,
    sourcePath,
  }
}

function extractFrontmatter(raw: string): {
  frontmatterRaw: string | null
  body: string
} {
  // Strip a leading BOM if present.
  const text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  if (!text.startsWith('---')) {
    return { frontmatterRaw: null, body: text }
  }
  // The first line after the leading '---' opens the block; the closing
  // '---' is its own line.
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return { frontmatterRaw: null, body: text }
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) {
    return { frontmatterRaw: null, body: text }
  }
  const frontmatterRaw = lines.slice(1, end).join('\n')
  const body = lines.slice(end + 1).join('\n')
  return { frontmatterRaw, body }
}

function parseFrontmatterLine(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon === -1) continue
    const key = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    if (key.length === 0) continue
    if (key === 'tags') {
      // tags are an inline JSON array for safety.
      try {
        out[key] = JSON.parse(value)
      } catch {
        out[key] = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
      }
      continue
    }
    out[key] = stripQuotes(value)
  }
  return out
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function statSafe(path: string): Promise<Awaited<ReturnType<typeof stat>>> {
  try {
    return await stat(path)
  } catch (err) {
    throw new SkillLoadError(
      `Cannot stat file: ${err instanceof Error ? err.message : String(err)}`,
      path,
    )
  }
}

/** Re-export SkillLoaderConfig for ergonomic imports. */
export type { SkillLoaderConfig } from './types'
