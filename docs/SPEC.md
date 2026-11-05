# SPEC Status

This repository implements the Markdown-first Agentic Team OS spec with a **portable core** and optional local runtime modules:

- Canonical shared artifacts: `content/`
- Canonical personal artifacts: `workspace/{member}/`
- Optional agent runtime: `workspace/fisher/`
- Derived: `index/`
- Optional local DB: `.hey/catalog.sqlite`
- Single CLI: `./hey`

Intentional simplification:
- No mandatory API/web app runtime
- Workspaces: `workspace/{member}/` for personal worklogs, notes, progress
- Script-only tooling for portability and low maintenance
- Extension fields must use `x_*` so optional modules do not mutate the portable schema

## ID Format

Artifacts use slug-based IDs: `{prefix}_{slug}`

- Prefix: full type name (`task`, `decision`, `meeting`, `playbook`, `note`)
- Slug: max 30 chars, lowercase alphanumeric + hyphens, auto-derived from title
- Examples: `decision_deflate-ontology`, `task_oracle-fallback`, `meeting_weekly-sync`
- Filenames: `{id}.md` (e.g. `decision_deflate-ontology.md`)
- Uniqueness enforced by validator

## Audit Grades

Quality grades use letters only (no numerical scores):

| Grade | Meaning | Criteria met |
|-------|---------|-------------|
| A+ | Perfect | 9/9 |
| A | Strong | 7-8/9 |
| B | Solid | 5-6/9 |
| C | Gaps | 3-4/9 |
| D | Weak | 1-2/9 |
| F | Missing | 0/9 |
