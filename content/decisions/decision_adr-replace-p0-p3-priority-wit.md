---
id: decision_adr-replace-p0-p3-priority-wit
type: decision
title: 'ADR: Replace p0-p3 priority with Eisenhower matrix quadrants'
created_at: '2026-04-09'
updated_at: '2026-04-09'
decision_status: accepted
owners:
  - team
tags:
  - Operations
  - Product
relations:
  - type: supersedes
    target: decision_staged-prioritization
sources:
  - url: 'https://en.wikipedia.org/wiki/Eisenhower_matrix'
    title: Eisenhower Decision Matrix — urgent/important classification
  - url: 'https://doi.org/10.1007/s10664-024-10553-4'
    title: 'Quantitative study of 32,139 prioritization decisions (2024)'
area: Team
owner: team
---

## Context

We use `priority: p0|p1|p2|p3` on every task. In practice the system provides no useful signal:

- **0 tasks are p0**, 49 are p1, 40 are p2, 1 is p3. Everything clusters into p1/p2 with no clear criteria distinguishing them.
- The scale is one-dimensional — it conflates urgency and importance into a single number with no defined rubric.
- A prior ADR (`decision_staged-prioritization`, proposed 2026-03-09) attempted to solve this by removing priority entirely in favor of iteration assignment + WIP limits. That proposal was never accepted — the team still wanted a quick classification signal on each task.

## Decision

Replace `priority: p0|p1|p2|p3` with an Eisenhower-matrix-inspired `priority` field using four named quadrants:

| Quadrant | Label | Meaning | Example |
|----------|-------|---------|---------|
| Important + Urgent | `do` | Act now — blocks revenue or users | Withdrawal verification, prod bug |
| Important + Not Urgent | `plan` | Strategic — schedule it | Predictive allocation engine, docs |
| Not Important + Urgent | `routine` | Has a deadline but low strategic value — do fast or automate | Recurring reports, minor config |
| Not Important + Not Urgent | `drop` | Backlog or delete | Nice-to-haves that keep lingering |

### Schema change

```yaml
# BEFORE
priority: p1  # opaque number

# AFTER
priority: do | plan | routine | drop  # intent-carrying label
```

### Migration

All existing tasks will be migrated:
- `p0` → `do`
- `p1` → `plan` (default — most p1 tasks are important but not immediately urgent)
- `p2` → `plan` (review individually if needed)
- `p3` → `drop`

This is a bulk migration — after it runs, every task uses the new vocabulary.

## Consequences

### Positive
- Every priority label carries intent — "do" means act now, "plan" means schedule
- Forces the question "is this actually important?" at task creation
- The "routine" quadrant highlights work that should be automated away
- The "drop" quadrant gives explicit permission to stop tracking low-value items
- Simple single field — no need for two booleans or staged lifecycle

### Negative
- Existing tooling and queries that filter on p0-p3 must be updated
- Team members need to learn the new vocabulary (though it's self-explanatory)
- The mapping of p1/p2 → plan is a best-guess bulk migration; some tasks may need manual reclassification

## Alternatives Considered

1. **Staged prioritization (decision_staged-prioritization)** — Remove priority entirely, use iteration assignment as the commitment signal. Rejected: team still wants a quick classification label on each task independent of iteration.
2. **Two separate fields (urgent + important booleans)** — More precise but heavier. Rejected: a single quadrant label is simpler and carries the same information.
3. **Keep p0-p3 with better rubric** — Add definitions for each level. Rejected: numeric scales inherently lack intent; labels communicate better.

