---
id: decision_staged-prioritization
type: decision
title: 'ADR: Replace single-score priority with staged prioritization'
created_at: '2026-03-09'
updated_at: '2026-03-09'
decision_status: proposed
owners:
  - team
tags:
  - Operations
  - Product
relations:
  - type: mentions
    target: decision_plans-as-tasks
  - type: mentions
    target: playbook_operating-philosophy
sources:
  - url: 'https://dora.dev/capabilities/'
    title: 'DORA Capabilities (visualization, WIP limits, delivery metrics)'
  - url: 'https://doi.org/10.1007/s10664-024-10553-4'
    title: 'Quantitative study of 32,139 prioritization decisions (2024)'
area: Team
owner: team
---

## Context

We currently use a single `priority` field (p0–p3) on every task. This worked for bootstrapping, but we're finding it unintuitive and the research evidence actively warns against it:

- A 2024 study of 32,139 prioritization decisions found that **criteria importance shifts across the delivery lifecycle**. Business value matters before commitment; readiness and blocking matter near execution. A single score collapses this.
- DORA research recommends **visualization + WIP limits + flow metrics**, not priority ladders.
- Kanban research treats **WIP limits** as more impactful than priority ranking for delivery outcomes.
- The Eisenhower matrix is explicitly flagged as something **not to over-trust** for team backlog management.

Meanwhile, our Operating Philosophy (Principle 2: Fixed Cadence) already implies that **iteration assignment is the primary commitment signal** — if a task is in this week's iteration, it's urgent by definition.

## Proposed Decision

Replace the single `priority: p0|p1|p2|p3` field with **staged prioritization** — different criteria matter at different lifecycle stages:

### Stage 1: Backlog Replenishment (weekly `/sync`)

When deciding what enters the next iteration, weigh:
- **Value** — Does this move us toward the $10M TVL goal?
- **Risk reduction** — Does this reduce security, technical, or business risk?
- **Dependency** — Is something else blocked on this?
- **Strategy alignment** — Does it align with the 70% long-term value allocation?

No numeric score. The `/sync` ceremony is where humans (or AI agents advising humans) make the judgment call and assign tasks to the next iteration.

### Stage 2: Iteration Execution (daily `/morning`)

Once a task is in the iteration, priority is determined by:
- **Readiness** — Can this move right now? (no blockers, no waiting on external)
- **Blocking** — Is something else waiting on this?
- **Size** — Smaller tasks that unblock flow get done first
- **Due date** — Hard deadlines override other criteria

The `/morning` routine already surfaces blockers and due dates. This formalizes what it's doing.

### Stage 3: During Execution

Just unblock flow and reduce rework. No prioritization system needed — the developer focuses on completing what they started before pulling new work.

### Schema Change

```yaml
# BEFORE
priority: do  # single score, static

# AFTER
# No priority field. Instead:
iteration: 2026-W11     # commitment signal (stage 1 output)
due_date: 2026-03-13    # hard deadline if any
# blocked_by expressed via relations
```

The `priority` field becomes **optional** and **deprecated** — existing values are preserved but no longer required on new tasks. Iteration assignment replaces it as the primary signal.

### WIP Limits

Introduce a soft WIP limit per person: **7 open tasks maximum at any given time within a 1-week iteration**. "Open" means `status: ready` or `status: doing` (or `blocked`) with the current iteration assigned. If you have more than 7 simultaneously, something should be:
- Completed first (finish before starting)
- Deferred to the next iteration
- Delegated to another team member

This is tunable — start with 7 per person per week, adjust based on team experience after 4 iterations.

The `/morning` routine should warn when WIP exceeds the limit.

### Flow Metrics (Future)

Track monthly:
- **Lead time** — time from `active` to `done`
- **Deployment frequency** — deploys per week (from git/argo history)
- **Iteration throughput** — tasks completed per iteration

These replace "tasks closed" as the health signal.

## Consequences

### Positive
- Prioritization becomes contextual and honest, not a static label
- Iteration assignment is already understood by the team (Principle 2)
- WIP limits prevent overcommitment
- Removes the "everything is p0" failure mode
- Aligned with DORA and empirical prioritization research

### Negative
- Existing 60+ tasks have `priority` fields that become vestigial
- No quick "sort by priority" — replaced by "what's in this iteration?" and "what's blocked?"
- Requires team buy-in during the next `/sync`

### Migration Path
1. Accept this decision
2. Make `priority` optional in validation schema
3. Stop requiring it on new tasks
4. Existing values left as-is (no bulk migration needed)
5. Add WIP limit warning to `/morning`
6. Revisit after 4 iterations (1 month) — is the team finding it better?

## Open Questions

- WIP limit set to 7 per person per week. Revisit after 4 iterations.
- Should we track flow metrics from day one, or add them after the priority change settles?
- Does the team want a board visualization (e.g., a generated markdown Kanban view)?
