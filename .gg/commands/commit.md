---
name: commit
description: Run lint, typecheck, and prettier-check; agent code review; commit with AI message; push.
---

1. Run quality checks (auto-fix where available):
   - `bun run lint` (eslint . --cache)
   - `bunx tsc -b` (typecheck, from `build` script in package.json:1)
   - `bun run format:check` (prettier --check)
     Fix ALL errors before continuing. If only `format:check` fails, run `bun run format` once and re-check.

2. Review changes: `git status`, `git diff --staged`, `git diff`.

3. Fast review gate: spawn ONE subagent with the full diff. Review ONLY the diff for real bugs, regressions, leftover debug code, and unintended changes. Score each issue 0-100 confidence (pre-existing issues and stylistic nitpicks = false positives, score low). Report ONLY issues with confidence >= 80, with file:line and a one-line fix. If none, reply "CLEAR". Fast, not a deep audit.

4. If CLEAR: proceed straight to step 5 and push WITHOUT asking the user anything.
   If issues >= 80 were reported: STOP, show the issues, then a single `ask_user` `choice` question (`id: "land"`, "Want me to fix this first, or commit and push anyway?") with:
   - "Fix it first, then commit & push" (recommended, hint: keeps the branch green)
   - "Commit & push anyway" (hint: issue stays open in the log)
     The card is the ONLY ask — do not restate the two options as text or end with an asking line. If `ask_user` is unavailable, ask the same two options in prose.
     On fix-first: fix, re-run step 1, then continue (no re-review). Otherwise continue as-is.

5. Stage relevant files with `git add` (specific files, not `-A`).

6. Generate a commit message: verb first (Add/Update/Fix/Remove/Refactor), specific, concise, one line preferred.

7. Commit AND push in one go - never pause for confirmation:
   `git commit -m "..."`
   `git push`
