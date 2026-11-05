---
id: decision_deflate-ontology
type: decision
title: 'ADR: Deflate artifact ontology from 10 to 5 types'
created_at: '2026-03-04'
updated_at: '2026-03-04'
owner: team
status: active
decision_status: accepted
owners:
  - team
tags:
  - Operations
relations: null
sources:
  - kind: commit
    ref: 3234c31
    title: 'Deflate ontology: 10 types to 5'
  - kind: doc
    ref: content/playbooks/playbook_golden-principles.md
    title: 'Golden Principles: One Artifact, One Concern'
---

## Context

The initial hey-mgmt scaffold defined 10 artifact types. Operating the repo with 10 types created friction: contributors could not consistently distinguish between types, the validator rules multiplied, and agent prompts required long type-selection explanations.

## Decision

Reduce to 5 canonical types:

| Type     | Prefix | Use for                  |
|----------|--------|--------------------------|
| task     | task     | Work to do               |
| decision | decision | Why we chose X over Y    |
| meeting  | meeting  | Notes + action items     |
| playbook | playbook | How to do X (runbook)    |
| note     | note     | Everything else          |

Execution plans are not a separate type — they are task artifacts with `status: plan`. See ADR: Execution plans as task artifacts.

## Consequences

- Simpler onboarding: 5 types fit in a single table in AGENTS.md
- Fewer validation rules
- Plans and roadmaps reuse the task scaffold, avoiding ontology proliferation
- Agents require no disambiguation logic for edge-case types
