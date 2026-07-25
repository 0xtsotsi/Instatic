/**
 * Product-owned skill system — types.
 *
 * Skills are a thin layer of curated guidance that sits between the
 * always-on system-prompt rules and the per-request snapshot. They are
 * NOT tools (they're not callable) and they are NOT code (they're not
 * executed). They are markdown files with a small frontmatter header
 * that compose into the agent's system prompt.
 *
 * The product owns `server/ai/skills/site/*.md`. The agent loop's own
 * `.agents/skills` and `.gg/skills` directories are NEVER imported
 * implicitly — explicit allowlist via `catalog.ts` is the only path.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export interface SkillFrontmatter {
  /** Stable id used by the catalog allowlist (e.g. `website-design`). */
  readonly id: string
  /** Human-readable name shown in the composed prompt header. */
  readonly name: string
  /** One-line description used by the catalog allowlist. */
  readonly description: string
  /** Semantic version. Bumped when the body changes. */
  readonly version: string
  /** Optional applicability tags; the catalog may key on these. */
  readonly tags?: readonly string[]
}

// ---------------------------------------------------------------------------
// Loaded skill
// ---------------------------------------------------------------------------

/**
 * A validated, in-memory representation of one skill. The `body` is the
 * raw markdown BELOW the frontmatter. The catalog and composer treat the
 * skill as opaque + its metadata as the only public contract.
 */
export interface ValidatedSkill {
  readonly frontmatter: SkillFrontmatter
  readonly body: string
  /** Total frontmatter + body byte length, captured at load time. */
  readonly bytes: number
  /** Absolute path the skill was loaded from, for diagnostics only. */
  readonly sourcePath: string
}

// ---------------------------------------------------------------------------
// Loader configuration
// ---------------------------------------------------------------------------

export interface SkillLoaderConfig {
  /** Maximum bytes for a single skill file (default 256 KiB). */
  readonly maxFileBytes?: number
  /** Maximum number of files to load from a directory (default 100). */
  readonly maxFiles?: number
  /** Maximum total bytes for the whole catalog (default 1 MiB). */
  readonly maxCatalogBytes?: number
}

export const DEFAULT_SKILL_LOADER_CONFIG: Required<SkillLoaderConfig> = {
  maxFileBytes: 256 * 1024,
  maxFiles: 100,
  maxCatalogBytes: 1024 * 1024,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SkillLoadError extends Error {
  readonly path: string
  constructor(message: string, skillPath: string) {
    super(`[skills] ${skillPath}: ${message}`)
    this.name = 'SkillLoadError'
    this.path = skillPath
  }
}

// ---------------------------------------------------------------------------
// JSON schema for frontmatter
// ---------------------------------------------------------------------------

export const SkillFrontmatterSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9-]*$' }),
  name: Type.String({ minLength: 1, maxLength: 128 }),
  description: Type.String({ minLength: 1, maxLength: 512 }),
  version: Type.String({
    minLength: 1,
    maxLength: 32,
    pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(-[a-z0-9.-]+)?$',
  }),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 32 }), { maxItems: 16 })),
})

export type SkillFrontmatterType = Static<typeof SkillFrontmatterSchema>
