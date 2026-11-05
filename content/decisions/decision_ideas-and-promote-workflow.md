---
id: decision_ideas-and-promote-workflow
type: decision
title: 'ADR: Replace thoughts+memo with ideas+promote two-stage workflow'
created_at: '2026-04-06'
updated_at: '2026-04-06'
owner: team
status: active
decision_status: accepted
owners:
  - team
tags:
  - Operations
  - Documentation
relations:
  - type: supports
    target: decision_no-separate-kb-dir
  - type: supports
    target: decision_deflate-ontology
sources:
  - kind: doc
    ref: workspace/charlie/docs/skill-architecture-thought-capture.md
    title: Original skill architecture design (superseded)
  - kind: doc
    ref: .claude/commands/idea.md
    title: /idea command implementation
  - kind: doc
    ref: .claude/commands/promote.md
    title: /promote command implementation
---

# ADR: Replace thoughts+memo with ideas+promote two-stage workflow

## Context

The original system had two personal capture paths:
- `/think` → `workspace/$MEMBER/thoughts/` (timestamped, ephemeral)
- `/memo` → `workspace/$MEMBER/memo/` (evergreen, updated in-place)

Plus an informal `workspace/$MEMBER/docs/` for how-to's and reports.

### Problems observed

1. **Routing tax**: Members couldn't tell at capture time whether something would be ephemeral or evergreen. Procedural content leaked into memo (`operational-fee-analysis.md`).
2. **Parallel ontology**: Personal `docs/` duplicated the team's canonical `content/` graph (notes, playbooks, decisions), weakening search and validation.
3. **Memo ≈ thought**: In practice, the distinction was lifecycle (timestamped vs evergreen), not content — too subtle for low-friction capture.

## Decision

### One capture command: `/idea`

Single personal capture verb. All subjective content goes to `workspace/$MEMBER/ideas/`.

**Filename**: `YYYY-MM-DD-[kind]-slug.md`

**Kinds** (`x_kind`):
| Kind | What it captures |
|------|-----------------|
| `concern` | Risk, worry, downside scenario |
| `idea` | Proposal, suggestion, improvement |
| `observation` | Pattern noticed, reflection, connection |
| `position` | Standing belief, philosophy, framework |

`position` absorbs what `/memo` was trying to do — without a second capture path.

### One promotion command: `/promote`

When an idea matures into a shared team artifact, `/promote` promotes it to `content/`:

| Target | When |
|--------|------|
| `content/tasks/` | Actionable work that should enter the shared backlog |
| `content/notes/` | Findings, reports, knowledge |
| `content/playbooks/` | Reusable how-to's, runbooks |
| `content/decisions/` | Team commitments and rationale |

This respects the repo's existing artifact model instead of inventing a parallel one.

### Deprecations

- `/memo` command — removed
- `/think` command — renamed to `/idea`
- `workspace/$MEMBER/thoughts/` — renamed to `workspace/$MEMBER/ideas/`
- `workspace/$MEMBER/memo/` — contents migrated, directory removed
- `workspace/$MEMBER/docs/` — treated as drafts, promoted to `content/`, directory deprecated

## Consequences

- **For individuals**: One easy capture verb, no routing decision at write time.
- **For the team**: Durable knowledge lands in the validated, searchable `content/` graph.
- **For the repo**: No parallel ontology competing with the architecture.
- **Trade-off**: Promotion requires a deliberate second step (`/promote`). This is intentional — shared artifacts should be a conscious decision, not an accident of where you first wrote something.
