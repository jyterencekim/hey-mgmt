---
id: decision_plans-as-tasks
type: decision
title: 'ADR: Execution plans as task artifacts with status:plan'
created_at: '2026-03-04'
updated_at: '2026-03-04'
owner: team
status: active
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
    ref: docs/EXECUTION_PLANS.md
    title: Execution Plans guide
  - kind: doc
    ref: content/playbooks/playbook_golden-principles.md
    title: 'Golden Principles: One Artifact, One Concern'
---

## Context

Multi-step initiatives need tracking beyond a single task. Options considered:

1. A dedicated `plan` artifact type (rejected — inflates ontology, see ADR: deflate ontology)
2. A separate `plans/` directory with markdown files (rejected — bypasses validation/indexing pipeline)
3. Task artifacts with `status: plan` (accepted)

## Decision

Plans are `task` artifacts with `status: plan`. They:
- Use the standard `definition_of_done` field to define completion
- Link to child tasks via `relations: [{type: blocks, target: task_...}]`
- Link to authorizing decisions via `relations: [{type: implements, target: decision_...}]`
- Track progress in the artifact body under `## Progress Log`

Discovery: `./hey search --status plan` lists all active plans.

## Consequences

- Plans flow through the same validation, indexing, and audit pipeline as tasks
- No new directories or types required
- Plan completion is queryable from the SQLite catalog
- Agents navigate plan→child tasks→decisions via the backlinks index
