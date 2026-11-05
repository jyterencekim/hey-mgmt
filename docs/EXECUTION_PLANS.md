# Execution Plans

Execution plans are lightweight, versioned artifacts for tracking complex multi-step work that spans multiple tasks and decisions.

## When to Use

- Work that spans more than 3 tasks
- Cross-functional initiatives involving multiple owners
- Initiatives with phased delivery or dependencies between tasks

## Structure

Plans live as task artifacts with `status: plan` and link to their child tasks via `relations`:

```yaml
---
id: task_oracle-adapter-v2
type: task
title: "Plan: Oracle Adapter V2 Migration"
status: plan
definition_of_done:
  - "All child tasks completed"
  - "Integration tests passing"
relations:
  - type: implements
    target: decision_oracle-adapter-v2  # The authorizing decision
  - type: blocks
    target: task_adapter-data-layer  # Child task 1
  - type: blocks
    target: task_adapter-integration  # Child task 2
---

## Objective
...

## Phases
1. ...
2. ...

## Progress Log
- 2026-03-04: Plan created, Phase 1 tasks opened
```

## Lifecycle

| Status | Meaning |
|--------|---------|
| `plan` | Active plan, work in progress |
| `done` | All child tasks completed |
| `cancelled` | Plan abandoned (note reason in body) |

## Tracking

Use `./hey search --status plan` to find active plans.
Use relations to navigate from plan → child tasks → authorizing decisions.

## Guidelines

- Keep plans small: 3-8 child tasks maximum
- Update the progress log in the plan body when milestones are reached
- Link the plan to the authorizing decision via `implements` relation
- When complete, update status to `done` and record completion date
