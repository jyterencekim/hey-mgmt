---
id: decision_adr-track-dev-task-phase-as-ex
type: decision
title: 'ADR: Track dev task phase as extension metadata'
created_at: '2026-04-24'
updated_at: '2026-04-24'
decision_status: accepted
owners:
  - team
tags:
  - Operations
  - Engineering
owner: team
status: active
relations:
  - type: mentions
    target: decision_simplify-frontmatter
  - type: mentions
    target: decision_linear-ontology-adoption
  - type: supports
    target: playbook_delivery-practices
sources:
  - kind: doc
    ref: content/decisions/decision_simplify-frontmatter.md
    title: 'ADR: Remove sensitivity and retention_class, add iteration'
  - kind: doc
    ref: content/decisions/decision_linear-ontology-adoption.md
    title: 'ADR: Linear ontology adoption -- add initiative as 6th artifact type'
  - kind: doc
    ref: docs/OPERATING_GUIDE.md
    title: Operating Guide -- task status policy
---

## Context

Dev tasks often need to show handoff state after implementation starts:
awaiting code review, awaiting deployment, awaiting production release, or
verifying the release. Today that state leaks into task titles, checklist text,
or `status` changes.

The current task model already has clear fields:

- `status` tracks lifecycle: `plan`, `active`, `blocked`, `in_progress`,
  `done`, `archived`, `cancelled`.
- `iteration` tracks the 1-week work cadence.
- `priority` tracks Eisenhower intent.
- `relations` track dependencies and blockers.

Adding review, deployment, and release labels to `status` would mix lifecycle
with handoff state. Adding a new artifact type or ceremony would violate the
two-layer model from `decision_linear-ontology-adoption`.

## Decision

Track dev task delivery phase with optional task frontmatter `x_phase`.

Allowed values:

| Phase | Meaning |
|-------|---------|
| `implementation` | Code, spec, or config work is underway. |
| `awaiting_review` | Work is ready and waiting for review or approval. |
| `awaiting_deployment` | Work passed review and waits for deploy to a non-prod or target environment. |
| `awaiting_prod_release` | Work is deployable and waits for production release, feature flip, or release-window sign-off. |
| `verifying_release` | Production change is live and smoke tests, monitoring, or rollback-window checks are still open. |

`x_phase` is optional. It is for dev and deployment tasks where handoff state
matters. Non-dev tasks MAY omit it.

`status` remains authoritative for lifecycle. If a task waits on a concrete
dependency, set `status: blocked` and add a `blocked_by` relation. Keep
`x_phase` only to show which delivery lane the blocked task is in.

## Consequences

- No new artifact type.
- No new ceremony.
- No expansion of `status`.
- Because `x_phase` uses the extension namespace, the portable core remains
  Markdown + frontmatter + git.
- The team can use this immediately by editing task frontmatter.
- Tooling MAY later add `./hey task phase` and `./hey task list --phase`, but
  those commands are not required for the ontology change.

## Alternatives Considered

### Add More Statuses

Rejected. Statuses such as `awaiting_review`, `awaiting_deployment`, and
`awaiting_prod_release` are useful handoff states, but they are not lifecycle
states. A blocked task can also be awaiting production release, so encoding
phase as status loses information.

### Use Tags

Rejected. Tags are broad classification labels. They are not good state
machines, and they would create tag drift.

### Use Body Checklists Only

Rejected. Body checklists are useful for detail, but they are not easy to query
across active tasks.
