---
id: playbook_delivery-practices
type: playbook
title: 'Delivery Practices: How We Work'
created_at: '2026-03-09'
updated_at: '2026-04-24'
playbook_version: 1.1.0
owner: team
status: active
tags:
  - Operations
  - Product
relations:
  - type: mentions
    target: playbook_operating-philosophy
  - type: mentions
    target: decision_staged-prioritization
  - type: mentions
    target: decision_adr-track-dev-task-phase-as-ex
sources:
  - url: 'https://dora.dev/capabilities/'
    title: DORA Capabilities
  - url: 'https://doi.org/10.1007/s10664-024-10553-4'
    title: 'Quantitative study of 32,139 prioritization decisions (2024)'
  - kind: doc
    ref: content/decisions/decision_adr-track-dev-task-phase-as-ex.md
    title: 'ADR: Track dev task phase as extension metadata'
---

# Delivery Practices: How We Work

The Operating Philosophy explains *why* the system exists. This playbook captures *how* we work — evidence-backed practices the team has adopted. Each practice links to the research that informed it and the decision artifact where it was formally adopted.

## 1. Visualize Work, Don't Hide It

DORA research treats visualization (dashboards, boards, value stream maps) as among the most established findings in software delivery improvement. Visibility improves shared understanding, bottleneck detection, communication, and decision-making.

**Our practice**: The repo is the board. `./hey search`, `/morning`, `/review-roadmap`, and `/sync` generate live views of work state. Every task has a status, an owner, and an iteration visible to everyone.

For dev and deployment tasks, use optional `x_phase` to show handoff state without changing lifecycle status:

| Phase | Meaning |
|-------|---------|
| `implementation` | Code, spec, or config work is underway |
| `awaiting_review` | Work is ready and waiting for review or approval |
| `awaiting_deployment` | Work passed review and waits for deploy to a non-prod or target environment |
| `awaiting_prod_release` | Work is deployable and waits for production release, feature flip, or release-window sign-off |
| `verifying_release` | Production change is live and smoke tests, monitoring, or rollback-window checks are still open |

`status` remains the lifecycle field. If a task waits on a concrete dependency, use `status: blocked` and a `blocked_by` relation, then keep `x_phase` to show the delivery lane.

## 2. Limit Work in Progress

Kanban research consistently treats WIP limits as a core practice for responsiveness, predictability, quality, and waste reduction. There is no universal "right" number — tune empirically.

**Our practice**: 7 active tasks maximum per person per 1-week iteration. If you exceed the limit, finish something, defer it, or delegate it before pulling new work. Revisit the limit after 4 iterations.

See: `decision_staged-prioritization`

## 3. Short Replenishment Cycles

A systematic review of industrial agile metrics found that teams use metrics mainly for sprint planning, progress tracking, quality measurement, process improvement, and motivation. Short-cycle planning is a recurring practical mechanism that works.

**Our practice**: 1-week iterations (Principle 2 from the Operating Philosophy). Weekly `/sync` ceremony fills the next iteration. Daily `/morning` surfaces blockers and today's focus.

## 4. Prioritize with Multiple Criteria, Not One Score

A 2024 study of 32,139 prioritization decisions found that prioritization criteria shift across the delivery lifecycle. Business value matters before commitment; readiness and blocking matter near execution. A single score collapses this nuance.

**Our practice**: Staged prioritization — different criteria at different lifecycle stages:

- **Backlog replenishment** (weekly `/sync`): value, risk reduction, dependency, strategy alignment
- **Iteration execution** (daily `/morning`): readiness, blocking, size, due dates
- **During execution**: unblock flow, reduce rework

Iteration assignment is the commitment signal. There is no single priority number.

See: `decision_staged-prioritization`

## 5. Ceremonies Serve Work, Not the Other Way Around

Empirical research found standups are valued mainly for information sharing and problem solving. They become counterproductive when they degrade into status reporting or run too long.

**Our practice**: `/morning` produces a plan (what to do today), not a status report (what I did yesterday). `/sync` is weekly and focuses on replenishment + blockers. We add or remove ceremonies based on whether they unblock work.

## 6. Cross-Functional Teams Over Handoff Chains

The strongest team-effectiveness research points to shared leadership, psychological safety, shared mental models, and transactive memory as key ingredients. Task management works better when the team can solve work without constant handoffs and approvals.

**Our practice**: Member profiles (`workspace/{name}/profile.md`) document each person's domains, repos, and agent capabilities. This makes expertise discoverable so the right person can be found quickly — by humans or AI agents.

## 7. Measure Flow, Not Busywork

DORA metrics (lead time, deployment frequency, failed deployment recovery time, change fail rate) are leading indicators for organizational performance and employee well-being. These are more defensible than "tasks closed" or "hours logged."

**Our practice** (planned): Track monthly:
- **Lead time** — time from `active` to `done`
- **Deployment frequency** — deploys per week
- **Iteration throughput** — tasks completed per iteration

## What We Explicitly Don't Do

- **Eisenhower matrix for backlog management** — research says don't over-trust it for teams
- **Single-number priority formulas** — evidence points away from treating them as objective truth
- **Pure Scrum ritual compliance** — optimize for coordination, not framework correctness
- **Velocity as main success metric** — flow metrics are more defensible
