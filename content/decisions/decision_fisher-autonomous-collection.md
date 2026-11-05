---
id: decision_fisher-autonomous-collection
type: decision
title: 'ADR: Fisher autonomous collection with reflection gate'
created_at: '2026-04-08'
updated_at: '2026-04-08'
decision_status: accepted
owners:
  - team
tags:
  - Operations
  - Integration
relations:
  - type: mentions
    target: decision_no-separate-kb-dir
sources:
  - kind: doc
    ref: docs/superpowers/specs/2026-04-08-fisher-autonomous-collection-design.md
    title: Full design spec
  - kind: doc
    ref: workspace/fisher/decision_autonomous-collection-reflection-gate.md
    title: Fisher workspace decision record
area: Team
owner: team
---

# ADR: Fisher autonomous collection with reflection gate

## Context

Fisher's activity pipeline collects external signals from Slack, Confluence, Drive, and GitHub, then creates candidates for human approval via per-candidate Slack DMs with approve/reject buttons. The notification volume causes fatigue and disengagement. Team members stop reviewing candidates, defeating the purpose of the approval gate.

## Decision

Replace the approval-based pipeline with autonomous collection and a two-pass AI reflection gate.

### Three-tier model

| Tier | Gate | Human role |
|---|---|---|
| Raw events | None | -- |
| Observations | AI reflection (second pass) | Delete noise |
| Team knowledge | AI auto-promotion | Revoke bad promotions |

### Key changes

- **Remove**: Per-candidate Slack DMs, approve/reject buttons, 60s notification loop, candidate JSON files
- **Add**: Second AI reflection pass evaluating principles + relevance + signal strength
- **Add**: Twice-daily batched digest to `#hey-mgmt-internal` (12:00, 18:00 KST; configurable)
- **Add**: `workspace/fisher/observations/` staging area for browsable observations
- **Change**: Knowledge JSONL written only on promotion (not on every classification)
- **Change**: Content artifacts auto-updated on promotion (no human approval needed)
- **Change**: Human role from approve (opt-in) to revoke (opt-out)

### Digest actions

- **Revoke** (on promoted items): demotes back to observation tier; does not auto-rollback content edits
- **Delete** (on observations): removes from staging
- **Ignore** (implicit default): no action needed

## Rationale

1. Per-candidate notifications are unsustainable at current activity volume
2. Two-pass AI filtering (classify + reflect) provides sufficient quality gating
3. Human veto is cheaper than human approval
4. Batched digests reduce N daily notifications to 2
5. Observations preserve signal without polluting the knowledge base

## Consequences

- Reflection pass quality is critical — bad promotions require manual cleanup
- Observation retention strategy deferred (files accumulate for now)
- Digest channel is `#hey-mgmt-internal` initially; dedicated channel needed later
- Full design spec at `docs/superpowers/specs/2026-04-08-fisher-autonomous-collection-design.md`
