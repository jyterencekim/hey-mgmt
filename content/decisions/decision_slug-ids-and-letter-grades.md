---
id: decision_slug-ids-and-letter-grades
type: decision
title: Slug-based IDs and letter-only audit grades
created_at: '2026-03-04'
updated_at: '2026-08-10'
decision_status: accepted
owners:
  - team
tags:
  - Operations
relations:
  - type: supports
    target: decision_deflate-ontology
sources:
  - kind: doc
    ref: docs/SPEC.md
    title: Spec — ID format and audit grades reference
  - kind: doc
    ref: AGENTS.md
    title: Agent guide — frontmatter ID example
owner: team
---

## Context

The original artifact ID format used 26-character ULIDs (e.g. `dec_01KJVT2Y6EWG1NGC3TP7KCEZFJ`). These were machine-friendly but imposed cognitive burden on humans reading filenames, relations, and cross-references. The audit system reported quality as numerical percentages (e.g. "72%") that conveyed false precision — the underlying score is just 0-9 discrete points.

## Decision

### 1. Slug-based IDs

Replace ULID-based artifact IDs with human-readable slug-based IDs.

- Format: `{prefix}_{slug}` (e.g. `dec_deflate-ontology`)
- Slug: max 30 chars, lowercase alphanumeric + hyphens, auto-derived from title at creation
- Filenames: `{id}.md` (no redundant slug duplication)
- Uniqueness enforced by validator; collisions resolved by appending `-2`, `-3`

### 2. Letter-only audit grades

> **Superseded 2026-08-10** by
> [`decision_adr-retire-letter-grade-audit`](decision_adr-retire-letter-grade-audit.md):
> the letter-grade audit itself is retired (`./hey audit` and
> `scripts/lib/audit.mjs` removed), so this section no longer governs
> anything. Section 1 (slug-based IDs) remains fully in force.

Replace numerical percentages with letter grades.

| Grade | Score |
|-------|-------|
| A+ | 9/9 (perfect) |
| A | 7-8/9 |
| B | 5-6/9 |
| C | 3-4/9 |
| D | 1-2/9 |
| F | 0/9 |

No percentages appear in CLI or JSON output.

## Consequences

- IDs are readable at a glance in filenames, relations, and git logs
- Relations like `target: tsk_bootstrap-kb` are self-documenting
- Audit output is cleaner and avoids false-precision percentages
- Trade-off: slugs are set at creation time and won't track title renames (acceptable — same pattern as URL slugs)
- Trade-off: IDs lose temporal ordering that ULIDs provided (acceptable — `created_at` serves this purpose)
