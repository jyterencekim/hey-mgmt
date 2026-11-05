---
id: playbook_operating-philosophy
type: playbook
title: 'Operating Philosophy: Why This System Exists'
created_at: '2026-03-06'
updated_at: '2026-04-08'
playbook_version: 1.3.0
owner: team
status: active
tags:
  - Operations
  - Product
relations:
  - type: supports
    target: playbook_golden-principles
  - type: supports
    target: decision_deflate-ontology
  - type: mentions
    target: playbook_governing-artifact-maintenance
sources:
  - kind: doc
    ref: content/playbooks/playbook_golden-principles.md
    title: >-
      Golden Principles — codebase hygiene rules that follow from this
      philosophy
  - kind: doc
    ref: content/decisions/decision_deflate-ontology.md
    title: 'ADR: Deflate ontology — evidence of Principle 2 in practice'
  - kind: doc
    ref: content/decisions/decision_plans-as-tasks.md
    title: 'ADR: Plans as tasks — evidence of Principle 2 in practice'
---

# Operating Philosophy: Why This System Exists

Golden Principles keep the repo clean. This playbook explains why the repo exists and how work should flow.

## Manifesto

This repo is the team’s operating system. It shows what’s done, what’s in flight, and what’s next — and who owns it.

The contract is Markdown + frontmatter + relations + git. Tools (agents, CLIs, editors, dashboards) are replaceable.

Shared truth, personal interfaces: people can use different tools, as long as they read/write the same contract.

## Principle 1: Shared Ledger, Personal Agents

> 단일 도구 강요 대신, 개인별 에이전트가 같은 장부를 쓰게 하자.

Work through any agent or interface; all read/write the same ledger (this repo).

System of record: plain Markdown in `content/`. Personal interfaces vary. Keep the contract machine-readable and tool-agnostic.

## Principle 2: Fixed Cadence, Not Flexible Sizing

> 사람은 일 크기/시간 추정이 서툴다. 주기는 고정하고 일을 그에 맞춰 쪼개자.

Two layers, no more:
1) **Initiatives = strategy.** Multi-task, multi-month efforts with a clear definition of done. They provide context; they don’t live in weekly iterations.
2) **Tasks = execution.** Bounded deliverables that fit a 1-week iteration (`iteration: YYYY-WNN`). If it doesn’t fit, split it. Link tasks to their initiative with `child_of`.

Keep cadence fixed. Review iteration tasks against the initiative. Capture lessons and evolve the initiative.

See `decision_deflate-ontology` and `decision_linear-ontology-adoption` for the rationale for a two-tier model.

## Principle 3: Inbox-First Chaos Containment

> 혼란은 inbox에 가두고, 분류는 에이전트가 하게 하자.

Send raw input (requests, bugs, rough ideas, Slack threads) to the inbox first. The agent classifies, tags, links, and promotes to `content/` or discards. Humans review the sorted result, not the noise.

Flow: Raw input → inbox → AI triage → `content/` (or discard)

## Principle 4: Instructing the Repo Is Teaching Ourselves

> 레포에 지시를 쓰는 일 = 팀의 학습을 기록·가속하는 일.

Playbooks, decisions, and tasks capture lessons. Improving an artifact improves the team. If the repo stops changing, it stops teaching. Keep instructions alive.

When behavior changes, the governing artifact that teaches that behavior MUST change too. Otherwise the repo stops teaching the truth and starts teaching stale history.

See `playbook_governing-artifact-maintenance`.
