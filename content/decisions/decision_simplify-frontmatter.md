---
id: decision_simplify-frontmatter
type: decision
title: 'ADR: Remove sensitivity and retention_class, add iteration'
created_at: '2026-03-04'
updated_at: '2026-03-04'
decision_status: accepted
owners:
  - team
tags:
  - Operations
relations:
  - type: supports
    target: decision_deflate-ontology
sources:
  - url: 'https://openai.com/index/harness-engineering'
    title: 'Harness engineering: leveraging Codex in an agent-first world'
  - kind: doc
    ref: ARCHITECTURE.md
    title: >-
      Architecture — leading principle: portable, human-friendly,
      low-maintenance
owner: team
---

## Context

The frontmatter schema required two fields that carried no meaningful information for the team:

1. **`sensitivity`** (required: `public | internal | confidential | secret`) — Every artifact was `internal`. A 4-person DeFi team has no confidentiality gradient. The context compile `--sensitivity-max` filter was always a no-op.

2. **`retention_class`** (required: `ephemeral | 30d | 180d | permanent`) — Retention was fully predictable from the type: decisions and playbooks are permanent by nature, tasks/meetings have lifecycle. No garbage collection process existed to act on it.

Meanwhile, two useful fields were missing or under-promoted:

3. **`due_date`** — Already partially implemented (`--due` flag) but not prominent in templates.
4. **`iteration`** — No way to group tasks by sprint/iteration for tracking.

## Decision

### Remove `sensitivity`

- Drop from required fields in validator
- Remove sensitivity filtering from retrieval and context compilation
- Remove `--sensitivity` CLI option and `--sensitivity-max` from context compile

### Remove `retention_class`

- Drop from required fields in validator
- Remove playbook retention_class enforcement (playbooks are permanent by nature)
- Remove `--retention` CLI option

### Add `iteration` (optional)

- Optional string field on tasks (e.g., `2026-W10`, `Sprint 3`)
- Added `--iteration` CLI flag to `hey new` and `hey task new`
- Indexed in manifest and SQLite catalog for queryability

### Promote `due_date` visibility

- Already implemented; made more prominent in templates and operating guide.

## Rationale

Leading principle: "Keep operations portable, human-friendly, and low-maintenance."

- Fields that carry zero information violate "human-friendly" — they're noise in every artifact
- The Harness article: "When everything is 'important,' nothing is" — similarly, when every field has the same value, the field is meaningless
- `iteration` earns its place because it enables a new capability (sprint-based task grouping) that the team actively needs

## Consequences

- 2 fewer required fields → simpler onboarding, less frontmatter noise
- Existing artifacts updated: sensitivity and retention_class lines removed
- Context compile no longer filters by sensitivity (everything passes)
- If fine-grained retention or sensitivity is ever needed, fields can be re-added
