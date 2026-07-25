/**
 * Skill catalog — the only path that picks which skills ship into the
 * composed system prompt.
 *
 * The catalog is an allowlist: a tool scope (site, content, data, plugin)
 * maps to a fixed set of skill ids. The chat handler asks the catalog for
 * the skills it may compose, never the loader directly. This keeps the
 * `.agents/skills` and `.gg/skills` implicit-load footgun out of the
 * runtime: nothing in the runtime path can enumerate arbitrary skill
 * directories.
 */

import { loadSkillsFromDirectoryCached } from './loader'
import type { ValidatedSkill } from './types'

// ---------------------------------------------------------------------------
// Scope → ids allowlist
// ---------------------------------------------------------------------------

const SITE_SKILL_IDS: ReadonlyArray<string> = ['website-design']

const SCOPE_TO_IDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  site: SITE_SKILL_IDS,
  content: [],
  data: [],
  plugin: [],
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the skills for one tool scope. Returns skills in the order
 * declared in the catalog (so the compose layer can apply layer
 * ordering deterministically). Unknown scopes return an empty list.
 *
 * The loader is invoked with the default skill directory at the canonical
 * product path. Tests can pre-populate the loader cache with a fixture
 * directory, so production code never reaches into the filesystem.
 */
export async function resolveSkillsForScope(
  scope: string,
  skillDir: string,
): Promise<ValidatedSkill[]> {
  const ids = SCOPE_TO_IDS[scope] ?? []
  if (ids.length === 0) return []
  const all = await loadSkillsFromDirectoryCached(skillDir)
  const out: ValidatedSkill[] = []
  for (const id of ids) {
    const skill = all.get(id)
    if (!skill) {
      // The catalog promised this id. A missing skill is a configuration
      // bug, not a soft failure — surface it loudly so the deploy doesn't
      // ship silently without its curated guidance.
      throw new Error(
        `[skills] Catalog references "${id}" but it is not present in ${skillDir}.`,
      )
    }
    out.push(skill)
  }
  return out
}

// ---------------------------------------------------------------------------
// Static catalog metadata (test-only and diagnostics)
// ---------------------------------------------------------------------------

export function listSkillIdsForScope(scope: string): ReadonlyArray<string> {
  return SCOPE_TO_IDS[scope] ?? []
}

export const PRODUCT_SKILL_DIRECTORY = 'server/ai/skills/site'
