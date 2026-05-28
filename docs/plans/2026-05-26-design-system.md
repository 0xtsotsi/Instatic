# Design System workspace — research + design

A brainstorm for adding a **Design System** entity to the Site panel: a single canvas document that previews every design token, every interactive primitive, and every saved Visual Component, with click-to-edit affordances for both designers and developers.

This is a plan, not a doc. It describes work that has not been built yet. When the work ships, the lasting parts move to `docs/features/design-system.md` and this file is deleted.

---

## TL;DR

- **One link, no section header.** Add a single "Design System" row at the top of `SiteExplorerPanel`, above `Pages` — no count, no group title.
- **It opens a third kind of canvas document.** Extend `ActiveDocument` from `{ kind: 'page' } | { kind: 'visualComponent' }` to add `{ kind: 'designSystem' }`. Same `NodeTree<PageNode>` shape, same canvas pipeline, same iframe-per-breakpoint rendering — no new rendering layer.
- **The document is a seeded, locked, system-owned tree.** Like the three system `data_tables` (posts / pages / components), it cannot be deleted or renamed. Users can rearrange and add to it, but the four canonical sections (Foundations, Type Scale, Controls, Components) regenerate themselves from the framework + VC catalog on save.
- **Editing is in-context.** Click a swatch on the canvas → ring lights up, the right sidebar shows that color token's editor (hex, hover/focus variants, dark-mode pair). Same for type ramp steps, spacing scale steps, button variants. The existing `ColorsPanel` / `TypographyPanel` / `SpacingPanel` become *deep-edit* surfaces; the canvas becomes the *discovery* surface.
- **The Components section is auto-populated from the VC catalog.** Each saved Visual Component renders as a "frame" tile at its default param values, with one click to open the VC editor.
- **Tokens align with W3C DTCG Format Module 1.0** (Oct 2025). Import / export round-trips through the standard `$value` / `$type` JSON format, so users can move between Figma Variables, Penpot, Tokens Studio, Framer, and this CMS without conversion.
- **One source of truth, two audiences.** Designers get visual swatches, type previews, interactive states; developers get a `Code` panel that emits the literal CSS variable names + a copyable DTCG JSON snippet for each token.
- **No new data model.** Colors / typography / spacing already live in `site.settings.framework` and emit CSS variables via `generateFrameworkRootCss`. The Design System workspace is a *view* and an *editing surface*, not a new persistence layer.

---

## Why this is a plan, not just "another panel"

The codebase already ships token primitives:

| Concern         | Lives in                                                                          | Already does                                                       |
|-----------------|-----------------------------------------------------------------------------------|--------------------------------------------------------------------|
| Colors          | `src/core/framework/colors.ts` + `FrameworkColorSettings`                         | Tokens, dark-mode pair per color, generated utility classes        |
| Typography      | `src/core/framework/typography.ts` + `FrameworkTypographySettings`                | Fluid scales, per-breakpoint, class generators (`font-size`, etc.) |
| Spacing         | `src/core/framework/spacing.ts` + `FrameworkSpacingSettings`                      | Fluid spacing scales with utility classes                          |
| CSS emission    | `src/core/framework/generate.ts` (`generateFrameworkRootCss`)                     | One `:root { … }` block injected at publish                        |
| Canvas trees    | `NodeTree<PageNode>` (`src/core/page-tree/treeSchema.ts`)                         | Page-mode + VC-mode share the same tree shape                      |
| Visual Components| `src/core/visualComponents/`                                                     | Saved, reusable, slot-aware components                             |
| Active document | `ActiveDocument` (`src/admin/pages/site/store/slices/uiSlice.ts`)                 | Discriminated union `page | visualComponent`                       |

So the *building blocks* exist. What's missing is the **showroom** — a place where all of them are visible at once, in their applied form, with click-to-edit hooks.

The closest analogs in the wider tool ecosystem:

- **Webflow's Style Guide page** ([Webflow](https://webflow.com/blog/how-to-build-a-living-style-guide-in-webflow)): a real page on the site that previews every element + component. Editing happens in the normal designer surface; the style guide page just *shows*.
- **Figma Variables Collections + Modes** ([Figma](https://help.figma.com/hc/en-us/articles/15339657135383)): tokens organized by group, swap themes by mode, every variable carries the same name design and code use.
- **Penpot Design Tokens panel** ([Penpot](https://help.penpot.app/user-guide/design-tokens/)): hierarchical tokens via dot notation, aliases (`{token.name}`), themes + sets, DTCG-compliant export.
- **Storybook design-token addon** ([storybook-design-token](https://github.com/UX-and-I/storybook-design-token)): generates documentation pages from CSS variable annotations, with cards / tables / preview blocks.

What this CMS already has that those tools don't: **a working canvas with iframe-per-breakpoint rendering, a publisher, and a Visual Components catalog**. Reusing the canvas means the Design System feels native — same selection ring, same right sidebar, same Properties panel — instead of being a parallel admin UI.

---

## What the user sees

### The entry point — one link, no section

Today the Site panel has five section headers (`Pages`, `Templates`, `Components`, `Styles`, `Scripts`). The Design System link sits **above** them all with no header at all:

```text
┌──────────────────────────────────────┐
│ Site                              ✕  │
├──────────────────────────────────────┤
│ ◉ Design System            ↗         │   ← single row, full-width, no group
│                                      │
│ Pages                         3   +  │
│   About                  /about      │
│   Blog                   /blog       │
│   Home                       /       │
│                                      │
│ Templates                     1   +  │
│   Post Template          posts       │
│                                      │
│ Components                    0   {} │
│   None yet                           │
│                                      │
│ Styles                        1   🪣 │
│   site.css      src/styles/site.css  │
│                                      │
│ Scripts                       0   </>│
│   None yet                           │
└──────────────────────────────────────┘
```

It uses the same `row` styling as page / template rows but renders with the rail-tint **mint** icon (`◉`, `palette` icon) to mark it as a system-owned entity. Clicking the row sets `activeDocument = { kind: 'designSystem' }`; the canvas swaps to the design-system tree.

### The canvas — four sections, scrollable

When the Design System is active, the canvas renders a **single seeded page** with four titled sections, each a `base.container` with locked children. The page is full-width, has no breakpoint pinning by default, and supports the same zoom / pan controls as any other canvas document.

```text
═══════════════════════════════════════════════════════════════════
 Design System                                              ⓘ Help
 Single source of truth for tokens, controls, and components.
═══════════════════════════════════════════════════════════════════

▍ 01  FOUNDATIONS
   Colors                                                  + Add
   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
   │primary│ │accent │ │ink    │ │paper  │ │success│ │danger │
   │ #4f46…│ │ #f59e…│ │ #0a0a…│ │ #fafaf│ │ #34d3…│ │ #ef44…│
   └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘
              ↑ click any swatch → right sidebar edits that token

   Spacing                                                 + Add
   ┌─┐ ┌──┐ ┌────┐ ┌──────┐ ┌──────────┐ ┌──────────────┐
   │4│ │ 8│ │ 12 │ │  16  │ │     24   │ │      32      │
   └─┘ └──┘ └────┘ └──────┘ └──────────┘ └──────────────┘

   Radius                                                  + Add
   ┌─┐ ┌──┐ ┌───┐ ┌───┐ ┌───┐
   │3│ │6 │ │12 │ │16 │ │999│
   └─┘ └──┘ └───┘ └───┘ └───┘

▍ 02  TYPE SCALE
   Headings
   H1  Display headline                                  64 / 1.05
   H2  Section heading                                   48 / 1.1
   H3  Subsection heading                                32 / 1.2
   H4  Card title                                        24 / 1.3
   H5  Smaller heading                                   20 / 1.35
   H6  Smallest heading                                  16 / 1.4

   Body
   Body L  The quick brown fox jumps…                    18 / 1.5
   Body M  The quick brown fox jumps…                    16 / 1.5
   Body S  The quick brown fox jumps…                    14 / 1.45

   Mono
   Code    monospace example with backticks              14 / 1.45

▍ 03  CONTROLS
   Buttons
   [ Primary ] [ Secondary ] [ Ghost ] [ Danger ]   ← hover / focus / disabled
                                                       states all visible on
                                                       the canvas at once

   Inputs
   ┌──────────────────┐  ☐ Checkbox      ◯ Radio       Switch  ⊙─────
   │ Placeholder      │  ☑ Checked       ◉ Selected           ─────⊙
   └──────────────────┘

   Links + Lists + Tables
   This is a paragraph with a <a>link</a>. Lists, ordered, unordered,
   tables, blockquote, hr — every base HTML element with the site CSS
   applied.

▍ 04  COMPONENTS  (auto-populated from VC catalog)
   ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
   │ Hero            │ │ Pricing card    │ │ Testimonial     │
   │ ┌─────────────┐ │ │ ┌─────────────┐ │ │ ┌─────────────┐ │
   │ │ frame at    │ │ │ │ frame at    │ │ │ │ frame at    │ │
   │ │ default     │ │ │ │ default     │ │ │ │ default     │ │
   │ │ param values│ │ │ │ param values│ │ │ │ param values│ │
   │ └─────────────┘ │ │ └─────────────┘ │ │ └─────────────┘ │
   │ Open →          │ │ Open →          │ │ Open →          │
   └─────────────────┘ └─────────────────┘ └─────────────────┘
   None yet            ← rendered as EmptyState if VC list is empty
```

### Why these four sections, in this order

| Section       | What it shows                                                                                            | Why it's section #N                                                                       |
|---------------|----------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| Foundations   | Colors, spacing, radius. Optional: shadows, opacity, motion.                                             | These are the **atoms**. Everything else references them. Show them first.                |
| Type Scale    | H1–H6, body sizes, mono. Live at the px values the site emits.                                           | Type is the second atomic layer — the part of the system that *most* of the user content uses. |
| Controls      | Every native HTML element + interactive states (hover, focus, disabled, error). Buttons, inputs, links, lists, tables. | These are **molecules** — atoms combined. They demonstrate that the foundation works.    |
| Components    | The user's own VCs, rendered at default params.                                                          | The user's **organisms**, built from the system. Last because they depend on everything above. |

The order is Brad Frost's atomic-design hierarchy (Atoms → Molecules → Organisms) without using the jargon. Every designer recognizes "Colors → Type → Controls → Components"; only some recognize "atoms".

### In-context editing — the click-to-edit loop

The defining UX move: **clicking a swatch / type step / control on the canvas selects that token and opens its editor in the right sidebar.** No mode switch, no "edit tokens" button. Same affordance as clicking a node on a page.

For colors:
1. Click the `primary` swatch on the canvas
2. Selection ring lights up (the existing `--canvas-selection-ring` neon green)
3. Right sidebar shows: hex picker, name input, category, dark-mode pair (with a "link / break" toggle), shade + tint variant settings, "generated utility classes" preview
4. Hex change → live update on the canvas in every section that references `primary` → publish on next save

For type steps:
1. Click "H2" preview on the canvas
2. Right sidebar shows: that step's size (min/max), line-height, letter-spacing, font-weight, family-link
3. Editing the size animates every other step in the ramp (because the ramp is a fluid scale, not 6 isolated values)
4. The "Type Scale" section header has a "Scale ratio: 1.250 (Major Third)" pill — clicking it opens the scale-ratio picker

For controls + components:
1. Click a button → its variant editor (this is just a regular module on the canvas, so the standard properties panel handles it)
2. Click a VC frame → "Open in VC editor" CTA (because VCs already have their own editor)

This pattern is the same one Webflow uses for its style guide, the same one Penpot uses for tokens, and the same one Figma uses for variables — but here it's **physically the same UI** as page editing, not a separate mode.

### The right sidebar — three tabs per token

To serve both designer-first and developer-first users equally:

```text
┌─ Token: color.primary ────────────────────────┐
│  ● Visual    ⊙ Code    ⓘ Where used           │
├───────────────────────────────────────────────┤
│  Visual tab (default for designers):          │
│  ┌────────────┐                               │
│  │ #4f46e5    │  Name      primary           │
│  └────────────┘  Category   Brand            │
│  ┌────────────┐  Dark mode  on               │
│  │ #818cf8    │  Pair name  primary          │
│  └────────────┘                               │
│  Variants                                     │
│  ☑ 4 shades   ☑ 4 tints   ☐ transparent      │
│  Utilities                                    │
│  ☑ text  ☑ background  ☑ border  ☐ fill       │
└───────────────────────────────────────────────┘

┌─ Token: color.primary ────────────────────────┐
│  ◉ Visual    ⊙ Code    ⓘ Where used           │
├───────────────────────────────────────────────┤
│  Code tab (default for developers):           │
│                                               │
│  CSS variable                                 │
│    --color-primary: #4f46e5;                  │
│    --color-primary-dark: #818cf8;             │
│                                               │
│  Utility classes generated                    │
│    .text-primary       { color: … }           │
│    .bg-primary         { background: … }      │
│    .border-primary     { border-color: … }    │
│                                               │
│  DTCG JSON                            ⎘ copy  │
│    {                                          │
│      "color": {                               │
│        "primary": {                           │
│          "$value": "#4f46e5",                 │
│          "$type": "color"                     │
│        }                                      │
│      }                                        │
│    }                                          │
└───────────────────────────────────────────────┘

┌─ Token: color.primary ────────────────────────┐
│  ◉ Visual    ◉ Code    ⊙ Where used           │
├───────────────────────────────────────────────┤
│  Where used (across the site):                │
│    • Home page → Hero CTA button              │
│    • About page → Heading underline           │
│    • Post Template → Tag pill                 │
│    • Visual Component: Pricing Card → border  │
│    • Site CSS → 6 occurrences                 │
│                                               │
│  [ Find next occurrence ]  [ Replace token… ] │
└───────────────────────────────────────────────┘
```

The third tab (`Where used`) is the killer feature for designers + developers both. It's a static-analysis pass over the site document: which pages, templates, VCs, and `site.css` rules reference this token (by CSS variable name or generated utility class). Same code path as the existing audit log + dependency resolver — we just expose it.

### Theme + mode switching — at the top of the canvas

The canvas-mode toolbar already supports breakpoint switching. The Design System canvas adds **one extra control**: theme switcher.

```text
                     ┌───────────────────────────────────────┐
                     │ ◉ Light  ⊙ Dark   |  Phone Tablet Desk│
                     └───────────────────────────────────────┘
```

Toggling theme flips `data-theme` on the iframe document root, which the publisher's emitted CSS already handles (the dark color block is generated via `formatFrameworkColorThemeCss('dark', …)` in `src/core/framework/colors.ts`). Every section re-renders with the dark palette without page reload, without re-render of the React tree. This is the cheapest dark-mode preview in the industry — we already have all the data.

Future modes (brand variants, accessibility variants) can extend this control without changing the underlying token model. (DTCG mode support is in the 1.0 spec, so this is forward-compatible.)

---

## Data model — minimal extension, mostly view layer

### What changes

1. **`ActiveDocument` union extended:**
   ```ts
   // src/admin/pages/site/store/slices/uiSlice.ts
   export type ActiveDocument =
     | { kind: 'page'; pageId: string }
     | { kind: 'visualComponent'; vcId: string }
     | { kind: 'designSystem' }                  // ← new arm
   ```

   No ID — there's only ever one Design System per site. Single instance, like the three system data tables.

2. **`mutateActiveTree` gets a third arm:**
   ```ts
   // src/admin/pages/site/store/slices/site/nodeActions.ts
   function mutateActiveTree(fn: (tree: NodeTree<PageNode>) => void): void {
     const doc = state.activeDocument
     if (!doc || doc.kind === 'page')          fn(activePage)
     else if (doc.kind === 'visualComponent')  fn(vc.tree as NodeTree<PageNode>)
     else                                       fn(designSystemTree)   // ← new
   }
   ```

   The existing `no-vc-mode-branches-in-mutations.test.ts` rule still holds: the 11 named mutation actions remain one-liners.

3. **`SiteDocument` gains a `designSystem` field:**
   ```ts
   // src/core/page-tree/siteDocument.ts (shape sketch)
   {
     pages: Page[]
     visualComponents: VisualComponent[]
     designSystem: DesignSystemDocument   // ← new
     settings: { framework: FrameworkSettings, … }
     files: SiteFile[]
   }
   ```

   ```ts
   interface DesignSystemDocument {
     id: 'design-system'                  // singleton — always 'design-system'
     tree: NodeTree<PageNode>             // the seeded 4-section page
     pinnedComponents?: string[]          // optional: VC IDs the user wants in §4 first
     hiddenComponents?: string[]          // optional: VC IDs to hide from §4
   }
   ```

   Persistence: a new system-owned table or column (`design_systems` table, one row per site, similar to how `posts` / `pages` / `components` are system tables). Migration adds the row on first boot for existing sites.

### What does NOT change

- **No new token storage.** Colors, typography, spacing tokens stay in `site.settings.framework`. The Design System canvas reads them, the Colors / Typography / Spacing panels write them, the publisher emits them. Zero duplication.
- **No new CSS pipeline.** `generateFrameworkRootCss` (`src/core/framework/generate.ts`) already produces the `:root { --color-primary: …; }` block. The Design System canvas iframe loads `site.css` + the generated framework CSS just like any other canvas iframe does — that's why hex updates feel live.
- **No new module engine.** The Design System tree contains existing modules: `base.container`, `base.heading`, `base.text`, `base.button`, `base.visual-component-ref`. No new module type, no plugin SDK churn.
- **No new admin route.** The Design System lives at `/admin/site` like every other canvas document. `activeDocument` differentiates inside.

This is the load-bearing claim of the whole plan: **The Design System is a view, not a new model.** It's the right call because the model is already complete.

---

## Auto-population of the seeded sections

The four sections regenerate from the framework + VC catalog on **every save**. This is the difference between a "style guide page" (a regular page that goes stale) and a "Design System" (a live mirror of the system).

```text
on save:
  for each section in design_system.tree:
    if section.locked === true:
      regenerate(section, framework_settings, visual_components)
```

`regenerate` is idempotent: given the same framework + VC catalog, produces the same tree shape. User customizations (a renamed section title, reordered swatches, a "Notes" sub-block) live as **unlocked siblings** of the locked children. Lock state propagates through the same mechanism Visual Components already use for slot-instances (`syncSlotInstances` in `src/core/visualComponents/slotSync.ts`) — locked nodes are tree-managed, unlocked siblings are user-managed.

The user therefore can't accidentally delete the canonical swatch grid, but they CAN:

- Drop additional explanatory text above any section
- Add a "Brand inspiration" frame between Foundations and Type Scale
- Reorder sections (the four locked sections themselves remain, but their order is configurable)
- Add notes / decisions / version stamps as ordinary content

### What if the user empties the Components section?

Component section is generated from the VC catalog. If the user has zero VCs, the section renders an `EmptyState` ("No components yet — create your first Visual Component to see it here") that links to the VC creation flow. The section is never *deleted*, just empty — same pattern as the existing `Components` row in the Site panel showing "None yet".

---

## DTCG import / export

The W3C Design Tokens Community Group reached its [first stable spec (Format Module 2025.10)](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/) in October 2025. Penpot, Figma Variables, Sketch, Framer, Tokens Studio, and others either support it natively or via plugin.

Two operations:

### Export

The Design System workspace adds an `Export tokens` action in the toolbar. Output:

```json
{
  "$schema": "https://design-tokens.org/2025.10/schema.json",
  "color": {
    "primary": {
      "$value": "#4f46e5",
      "$type": "color",
      "$description": "Brand primary"
    },
    "primary-dark": {
      "$value": "#818cf8",
      "$type": "color"
    }
  },
  "typography": {
    "h1": {
      "fontSize": { "$value": "{spacing.scale.7}", "$type": "dimension" },
      "lineHeight": { "$value": 1.05, "$type": "number" }
    }
  },
  "spacing": {
    "scale": {
      "1": { "$value": "4px", "$type": "dimension" },
      "2": { "$value": "8px", "$type": "dimension" }
    }
  }
}
```

Includes mode-shifted variants (`@light`, `@dark`) for any token with dark-mode enabled. Standard alias syntax (`{token.path}`) for references between scales. Generated via a new module `src/core/framework/dtcg.ts` that walks the framework settings and emits DTCG-compliant JSON.

### Import

The same workspace accepts a DTCG file via drop or `Import tokens` action. Conflict resolution: the user sees a diff (existing → incoming, with green/red preview swatches) and can accept all / pick per-token / cancel. Successful import writes through the framework store actions — same code path as manual editing.

Why bother: this is what makes the Design System useful **across tools**. A designer can pull tokens from Figma Variables into the CMS without manual entry. A developer can hand the CMS-exported file to Style Dictionary and ship the same values to native apps.

Reference: [Style Dictionary's DTCG support](https://styledictionary.com/reference/utils/dtcg/) (v4+).

---

## What this gives each audience

### For designers

- **One screen with everything.** No "where do I find the spacing scale" hunt.
- **In-context preview.** Change `primary` → see it on the button on the canvas, in the heading underline, in the H1 selection accent, in dark mode, instantly.
- **No code panic.** Visual tab is the default; CSS variable names are visible but not in the way.
- **Theme A/B.** Light vs. dark toggle at the top of the canvas — same screen, no navigation.
- **VCs as frames.** "Here is what my Hero component looks like at default params" — without opening it, without composing a test page.
- **Round-trip with Figma.** DTCG export → Tokens Studio → Figma Variables. The CMS plays nice.

### For developers

- **CSS variable names visible.** `--color-primary` shown for every swatch. Copy-paste straight into hand-written CSS.
- **DTCG export.** Pipe into Style Dictionary to ship to iOS / Android / native.
- **Where-used analysis.** Before renaming a token, see every place it's referenced. Find-and-replace is safe.
- **Single source of truth.** `site.settings.framework` is the canonical store. The Design System workspace is a view; `bun run build` doesn't depend on it; the publisher doesn't care if it exists.
- **No mystery.** Tokens are plain TypeScript schemas (`FrameworkColorSettings`, etc.) with generated CSS variables. No JSON-in-database black box.

### For both

- **Living, not stale.** Generated from the same data the published site uses. Cannot drift.
- **Onboarding artifact.** A new collaborator opens the Design System workspace, learns the visual language in 30 seconds.
- **Discoverable settings.** Every framework knob lives on a swatch or step that the user can click. No hidden options.

---

## Implementation phasing

Pre-release. No backward compatibility concerns. Refactor freely. Suggested phases, but no part of this is set in stone — every phase boundary can move.

### Phase 1 — Surface + active document

1. Extend `ActiveDocument` with `{ kind: 'designSystem' }`.
2. Add the `DesignSystemDocument` type to `SiteDocument` schema (TypeBox).
3. Migration: add `design_systems` table; seed one row per existing site with the canonical 4-section tree.
4. `mutateActiveTree` learns the third arm.
5. `SiteExplorerPanel` adds the single-row Design System link at the top of the list, no section.
6. Clicking the link sets `activeDocument` → canvas swaps to the design-system tree.
7. Gate test update: `no-vc-mode-branches-in-mutations.test.ts` still passes (the new arm goes only inside `mutateActiveTree`).

After Phase 1, the canvas renders a static design-system page. No regeneration, no token editing from the canvas — but the workspace exists.

### Phase 2 — Locked-section regeneration

1. `src/core/designSystem/regenerate.ts` — given `framework` + `visualComponents`, produces the canonical locked subtree for each of the 4 sections.
2. Wire into the save lifecycle (`siteSlice`) — regenerate on every save.
3. Lock semantics: reuse the existing `locked` node flag + slot-instance approach.
4. Tests: regenerate is idempotent; user notes between sections survive a regen.

After Phase 2, the canvas auto-updates when the user adds a color, typography step, spacing step, or VC.

### Phase 3 — Click-to-edit

1. Token swatches / type rows / spacing chips become selectable canvas nodes with metadata pointing at their source token (`framework.color.id`, `framework.typography.groupId+stepId`).
2. Right sidebar gains a `TokenEditorPanel` that reads the selected node's token metadata and renders the existing `ColorTokenEditor` / `TypographyGroupEditor` / `SpacingGroupEditor` inline.
3. Edits flow through existing framework store actions — no new write paths.
4. Where-used tab: static analysis over the site document.

After Phase 3, the feature is shippable: discovery + edit loop closed.

### Phase 4 — Theme switcher + DTCG round-trip

1. `data-theme="light|dark"` toggle at the top of the canvas; iframe receives the attribute on its root.
2. `src/core/framework/dtcg.ts` — bi-directional translation between framework settings and DTCG 1.0 JSON.
3. Toolbar actions: `Export tokens`, `Import tokens`. Import uses the existing `Dialog` primitive for the diff confirmation.
4. Documentation: move this plan to `docs/features/design-system.md`.

After Phase 4, the feature is what the user asked for.

### Phase 5 (optional) — Components page enrichment

1. Each VC frame gets a small `<select>` for choosing a saved param preset.
2. Param presets stored on the VC itself (`presets: { name: string; params: Record<string, unknown> }[]`).
3. Frame title shows the active preset name.

This is gravy — most users will live happily without it. Open the VC editor for full param control.

---

## What this is NOT

- **Not a replacement for `site.css`.** Developers can still hand-write CSS that uses `var(--color-primary)`. The Design System workspace is additive.
- **Not a replacement for the existing Colors / Typography / Spacing left-sidebar panels.** Those panels remain as the deep-edit / "show me all tokens at once" surfaces. The Design System canvas is the **applied** view; the panels are the **listing** view. Both are valid entry points — the canvas-first user clicks a swatch; the dev-first user opens `ColorsPanel` from the rail.
- **Not a Figma plugin.** The CMS owns its tokens; DTCG export is for round-tripping. The CMS doesn't try to be Figma.
- **Not a code-generation tool.** It does not write React or Vue components. The CMS publishes plain semantic HTML + CSS; that is the contract.
- **Not a Storybook clone.** Storybook documents component variants for engineers reading source code. The Design System workspace shows a user their *own* tokens and *own* components. Different audience, different artifact.
- **Not multi-tenant.** Self-hosted only. No "shared design system across organizations" — that's outside the product's scope.

---

## Open questions (resolve before Phase 1)

1. **Section ordering.** Should users be able to reorder the four canonical sections? Probably yes (drop targets between sections). But: should the locked status persist across reorderings? Default: yes — order is configurable, content is not.
2. **Per-page token overrides.** Today, tokens are site-wide. Does any page need to override a token locally? Probably not for v1 — keep token scope at the site root. If demand emerges, mode-based theming (DTCG modes) is the right escape hatch, not per-page overrides.
3. **Multiple themes beyond light/dark.** v1 supports light + dark (already in `FrameworkColorToken.darkValue`). DTCG supports arbitrary modes. Adding more modes requires a small schema change (`darkValue: string` → `modeValues: Record<string, string>`). Defer to Phase 5+ — but design Phase 1's data model with room.
4. **Versioning and history.** Should the Design System workspace surface a "What changed?" view comparing the current state to the last publish? Useful for design-team reviews, but the audit log already records token CRUD. v1: link to the audit log filtered by `actor.kind=design-system`. v2+: build a dedicated diff view.
5. **Plugins.** Can a plugin contribute a section to the Design System canvas (e.g. an "Icons" section, a "Motion" section)? Yes, via the existing plugin SDK — a plugin can register a `designSystemSection` extension point. Defer to a later phase; the four canonical sections cover the common case.

---

## Risk register

| Risk                                                                  | Mitigation                                                                                  |
|-----------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| The auto-regen erases user customizations                             | Use the existing locked-children + unlocked-siblings pattern. Test thoroughly in Phase 2.   |
| Token rename breaks every page that referenced the old name           | Build the `Where used` analysis in Phase 3 and surface it in the rename dialog.            |
| DTCG import overwrites tokens without confirmation                    | Mandatory diff dialog before commit. Same pattern as existing `FrameworkChangeConfirmDialog`. |
| Performance: regenerating four sections on every save is wasteful     | Memoize per-input. The `framework` settings are immutable references via Immer; cheap key. |
| VC param defaults aren't suitable for thumbnail rendering             | Phase 5 adds per-VC presets. v1 just renders at the literal default params — designer's choice if they want different defaults. |
| Singleton design system collides with future multi-design-system asks | The singleton is intentional. If real demand emerges later, evolve schema with a migration. Pre-release rules apply. |

---

## What to do before starting Phase 1

- [ ] Get user agreement on the four canonical section titles (Foundations / Type Scale / Controls / Components).
- [ ] Confirm the icon for the Design System row in the Site panel (`palette` from `pixel-art-icons` is the natural pick).
- [ ] Confirm rail-tint for the row (mint matches "system / status" convention per `docs/design.md`).
- [ ] Pick a publish-time behavior: does the Design System render to a publishable URL (`/design-system`), or is it admin-only? Recommendation: **admin-only by default**, with a settings toggle "Publish Design System at /style-guide" for users who want to expose it (Webflow-style living style guide). Default off — most sites don't want a public design system.

---

## Related

- [docs/architecture.md](../architecture.md) — system overview
- [docs/editor.md](../editor.md) — the visual editor (where this lives)
- [docs/design.md](../design.md) — the editor's own design system (this plan's UI inherits from it)
- [docs/reference/design-tokens.md](../reference/design-tokens.md) — editor token catalog (different from site framework tokens)
- [docs/features/visual-components.md](../features/visual-components.md) — VC architecture, slot pattern
- [docs/reference/page-tree.md](../reference/page-tree.md) — `NodeTree<PageNode>` primitive (the Design System reuses this)
- Source-of-truth pointers (current):
  - `src/core/framework/schemas.ts` — token schemas
  - `src/core/framework/generate.ts` — CSS variable emission
  - `src/core/framework/colors.ts` / `typography.ts` / `spacing.ts` — per-family generators
  - `src/admin/pages/site/store/slices/uiSlice.ts` — `ActiveDocument` union
  - `src/admin/pages/site/store/slices/site/nodeActions.ts` — `mutateActiveTree`
  - `src/admin/pages/site/panels/SiteExplorerPanel/SiteExplorerPanel.tsx` — where the new link goes
  - `src/admin/pages/site/panels/ColorsPanel/` / `TypographyPanel/` / `SpacingPanel/` — existing deep-edit surfaces

## Research sources

External references that informed this plan. Cited inline above where specifically relevant.

- [Figma — Guide to variables](https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma) — collections + modes pattern
- [Figma — Overview of variables, collections, and modes](https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes)
- [Design System Mastery with Figma Variables (2025/2026)](https://www.designsystemscollective.com/design-system-mastery-with-figma-variables-the-2025-2026-best-practice-playbook-da0500ca0e66) — composite types, mode density, AI linting
- [Webflow — How to build a living style guide](https://webflow.com/blog/how-to-build-a-living-style-guide-in-webflow) — Style Guide page as a real on-site page
- [Webflow — Using a design system](https://help.webflow.com/hc/en-us/articles/41959932025235-Using-a-design-system-in-Webflow) — sections (typography, color, spacing, components)
- [Webflow — Design system checklist](https://university.webflow.com/resources/design-system-checklist)
- [Building a Design System in Webflow (2026)](https://digitaledge.org/building-a-design-system-in-webflow-best-practices-for-2026)
- [Framer Academy — Link and color Styles](https://www.framer.com/academy/lessons/framer-fundamentals-styles)
- [Framer Developers — Styles](https://www.framer.com/developers/styles)
- [Tokens Studio for Framer plugin](https://documentation.tokens.studio/plugins/tokens-studio-for-framer-plugin)
- [Penpot — Design Tokens user guide](https://help.penpot.app/user-guide/design-tokens/) — dot-notation hierarchy, aliases, themes + sets, 12+ token types
- [Penpot — Bringing Design Tokens (Tokens Studio collab)](https://tokens.studio/blog/bringing-design-tokens-to-penpot-an-open-source-collaboration-for-the-design-systems-community)
- [Design Tokens Community Group — first stable spec (2025.10)](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)
- [Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/)
- [Style Dictionary — DTCG utilities](https://styledictionary.com/reference/utils/dtcg/) — import / export reference implementation
- [Storybook — design-token addon](https://github.com/UX-and-I/storybook-design-token) — card / table preview patterns
- [Builder.io — Visual Copilot 2.0](https://www.builder.io/blog/visual-copilot-2) — AI design-system enforcement (orthogonal to this plan; relevant for future)
- [Dark Mode Design Systems guide (Muz.li)](https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/) — semantic tokens vs. raw values
- [Color tokens guide: light + dark in design systems (Bootcamp)](https://medium.com/design-bootcamp/color-tokens-guide-to-light-and-dark-modes-in-design-systems-146ab33023ac)
- [Tailwind CSS — Theme variables](https://tailwindcss.com/docs/theme) — `@theme` directive, CSS variable model in v4
