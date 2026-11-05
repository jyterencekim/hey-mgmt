---
id: playbook_governing-artifact-maintenance
type: playbook
title: Governing Artifact Maintenance Hooks
created_at: '2026-04-08'
updated_at: '2026-04-08'
playbook_version: 1.0.0
owner: team
status: active
tags:
  - Operations
  - Documentation
  - Review
relations:
  - type: supports
    target: playbook_operating-philosophy
  - type: supports
    target: playbook_golden-principles
  - type: supports
    target: playbook_file-placement
sources:
  - kind: doc
    ref: AGENTS.md
    title: 'Agent rules for deps check, principles review, and validation'
  - kind: doc
    ref: content/playbooks/playbook_operating-philosophy.md
    title: Operating philosophy for shared ledger and teaching loop
  - kind: doc
    ref: content/playbooks/playbook_golden-principles.md
    title: Golden principles for freshness and non-duplication
  - kind: doc
    ref: content/playbooks/playbook_file-placement.md
    title: Canonical routing policy for file placement
  - kind: doc
    ref: ARCHITECTURE.md
    title: Architecture constraints and canonical document layers
---

# Governing Artifact Maintenance Hooks

## Purpose

Keep the repo's governing artifacts synchronized with actual behavior. When the team changes a rule, route, convention, or operating procedure, the corresponding governing artifact MUST change in the same work.

## Governing Artifacts

Governing artifacts are the files humans and agents rely on to interpret how the system works.

They include:

- `content/playbooks/` for reusable operating knowledge and conventions
- `content/decisions/` for committed rationale and policy choices
- `ARCHITECTURE.md` for portable-core and placement constraints
- `docs/OPERATING_GUIDE.md`, `docs/WORKFLOW_GUIDE.md`, and related repo-operating docs for `hey-mgmt`
- `AGENTS.md` when agent-specific behavior or required checks change

## Input Hook

Before executing change-intent work, ask:

1. What behavior, rule, route, or convention will change?
2. Which governing artifacts currently describe that behavior?
3. Will they still be correct after the change?

If the answer to the third question is no or uncertain, the affected governing artifact MUST be included in the planned write set.

## Output Hook

Before declaring work complete, ask:

1. What behavior actually changed?
2. Which governing artifacts now describe that behavior?
3. Were they updated in the same change?

If behavior changed and no governing artifact was updated, completion SHOULD be blocked until one of these is true:

- the relevant governing artifact is updated
- the behavior is reverted
- the change explicitly records why no governing artifact update is required

## Trigger Classes

These changes usually require a governing-artifact check:

- CLI behavior changes
- validation rule changes
- artifact routing or placement changes
- workflow or ceremony changes
- inbox lifecycle or task lifecycle changes
- naming, vocabulary, or schema changes
- runtime ownership boundary changes
- repeated decisions that should become reusable playbook guidance

## Routing Rules

- If the change updates *how to do something repeatedly*, update a `playbook`.
- If the change updates *what we decided and why*, update a `decision`.
- If the change updates *how `hey-mgmt` itself works structurally*, update `ARCHITECTURE.md` or the relevant operating doc in addition to any playbook or decision.
- If the change updates *agent-only required behavior*, update `AGENTS.md`.

## Examples

- Changing inbox statuses requires updating the inbox operating guidance and any governing playbook that describes inbox routing.
- Moving cross-repo versioning guidance out of a root doc requires updating the placement policy because the routing rule changed.
- Adding a new recurring ceremony requires updating the relevant operating playbook or workflow guide, not just the command implementation.

## Anti-Patterns

- Shipping behavior first and promising to update the docs later
- Leaving stale routing guidance in one artifact while another artifact reflects the new behavior
- Treating repeated decisions as tribal knowledge instead of promoting them into a playbook
- Updating a local draft or daily log instead of the canonical governing artifact

## Completion Rule

The maintenance loop is:

1. Identify governing artifacts during planning.
2. Implement the behavior change.
3. Update the governing artifact in the same work.
4. Run principles review.
5. Run `./hey validate`.

This hook is small on purpose. It is a gate, not a second workflow system.
