---
id: playbook_golden-principles
type: playbook
title: 'Golden Principles: Keep the Repo Clean'
created_at: '2026-03-04'
updated_at: '2026-08-10'
playbook_version: 1.1.0
owner: team
status: active
tags:
  - Operations
  - Review
relations:
  - type: supports
    target: decision_deflate-ontology
  - type: mentions
    target: playbook_operating-philosophy
  - type: mentions
    target: playbook_governing-artifact-maintenance
sources:
  - kind: doc
    ref: content/policies/governance.yml
    title: Governance policy — enforces sources and validation rules
  - kind: doc
    ref: AGENTS.md
    title: Agent guide — vocabulary and validation rules
---

# Golden Principles: Keep the Repo Clean

Practical rules to keep knowledge legible, consistent, and useful. Apply at write time, not as an audit gate — `./hey validate` is the only mechanical check; the rest is writer discipline. A retrospective review pass is opt-in for cross-file refactors or ontology shifts.

## Principle 1: No Unattributed Claims

Decision artifacts must include `sources`. Unsourced claims belong in a `note` with a hypothesis tag.

**Enforced by:** `./hey validate` (sources policy in `governance.yml`)

## Principle 2: Use Shared Vocabulary

Use terms from `content/vocab/entities.yml` and `content/vocab/tags.yml`. Add new terms to vocab first, then use them.

**Enforced by:** `./hey validate` (tag and entity vocabulary checks)

## Principle 3: Keep Active Tasks Fresh

Review *active tasks* stale >90 days. Update them, close them, or mark them `x_evergreen: true` to prevent priorities from drifting unnoticed.

Scope (per [`decision_adr-narrow-staleness-to-tasks`](../decisions/decision_adr-narrow-staleness-to-tasks.md)):

- Applies to `type: task` only. Notes, decisions, meetings, initiatives, and playbooks are not on a freshness clock — they capture moments or rules, not open work.
- Terminal-status tasks (`done`, `archived`, `cancelled`) are exempt. Closure is the signal; the `updated_at` of a finished task is *supposed* to be old. Per [`decision_adr-task-done-vs-archived-lif`](../decisions/decision_adr-task-done-vs-archived-lif.md), do not relabel `done` → `archived` based on age.
- Long-running active tasks that legitimately span multiple quarters (multi-month initiatives, on-call playbooks-as-tasks, long-running monitoring tickets) MAY set frontmatter `x_evergreen: true` to opt out explicitly.

Freshness also applies to governing artifacts. If a change alters team behavior, routing, or policy, the artifact that governs that behavior MUST be updated in the same work — but this is a discipline expectation enforced at PR review, not by the staleness clock.

**Enforced by:** `./hey validate` (staleness detection scoped per [`decision_adr-narrow-staleness-to-tasks`](../decisions/decision_adr-narrow-staleness-to-tasks.md), 90-day threshold)

## Principle 4: One Artifact, One Concern

Each artifact covers a single topic. If a task exceeds 3 acceptance criteria, split it.

**Enforced by:** Convention (review during PR)

## Principle 5: Relations Over Duplication

Don’t copy information across artifacts. Link it via `relations` (e.g., `supports`, `implements`, `links_to`).

**Enforced by:** `./hey validate` (relation target integrity)

## Principle 6: Sources Chain Completeness

Decisions link to prompting tasks. Tasks link to authorizing decisions. Build a navigable graph.

**Enforced by:** Convention (the letter-grade relation-density check was retired by [`decision_adr-retire-letter-grade-audit`](../decisions/decision_adr-retire-letter-grade-audit.md))

## Principle 7: Canonical Before Custom

Prefer existing entities/tags in `content/vocab/`. Use aliases in `entities.yml` when appropriate.

**Enforced by:** `./hey validate` (entity vocabulary checks)

## Periodic Maintenance

Run `./hey validate` weekly (the `/clean` checklist wraps it) to review
validation errors/warnings and vocab compliance. Rotting open tasks surface
through the loop board's undated pile and session-start overdue triage — not
a separate grade report (see
[`decision_adr-retire-letter-grade-audit`](../decisions/decision_adr-retire-letter-grade-audit.md)).

During change-intent work, use `playbook_governing-artifact-maintenance` as the input and output hook for keeping rules synchronized with behavior.
