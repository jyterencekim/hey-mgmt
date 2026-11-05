---
id: playbook_loop-control-usage-guide
type: playbook
title: Loop Control Usage Guide
created_at: '2026-05-07'
updated_at: '2026-08-25'
playbook_version: 0.2.0
status: active
owner: team
area: Team
tags:
  - Operations
  - Documentation
  - Automation
sources:
  - kind: doc
    ref: workspace/charlie/ideas/2026-04-30-idea-loop-control-workflow-candidate.md
    title: Loop Control Workflow Candidate
  - kind: doc
    ref: workspace/charlie/ideas/2026-04-30-idea-scheduled-action-packets.md
    title: Scheduled Action Packets
  - kind: doc
    ref: content/initiatives/2026/05/initiative_harness-v1-execution-harness.md
    title: Harness V1 Execution Harness
  - kind: user_request
    ref: codex-2026-08-25-morning-hierarchy
    title: >-
      Charlie requested an exemplary large-topic, middle-topic, small-action
      morning log and team adoption
  - kind: doc
    ref: workspace/charlie/logs/2026-08-25.md
    title: Worked morning-log example and KST date-bound execution evidence
---

# Loop Control Usage Guide

## Purpose

Use the loop to drive many tasks, packets, and agent runs without reading every detail every time.

The loop is a projection over repo state. It is not a second task system.

## Core Rule

The human driver MUST track lanes and interventions, not every event.

The repo remains the ledger:

- Tasks hold committed work state.
- Notes and playbooks hold durable context.
- Inbox items hold raw intake and handoffs.
- Scheduled action packets hold time-triggered prompts.
- Mission packs hold task execution context for agents.
- Git commits hold validated change boundaries.

## Daily Shape

### Morning

Start from the control surface:

```bash
MORNING_DATE="$(TZ=Asia/Seoul date +%F)"
git pull --rebase --autostash origin main
./hey index build
./hey db build
./hey loop brief --member <member> --today "$MORNING_DATE"
./hey loop board --member <member> --today "$MORNING_DATE"
./hey loop horizon --member <member> --today "$MORNING_DATE"
```

Use `brief` for the short scan. Use `board` to choose focus.

The morning pass MUST bind every projection and log path to the same KST calendar date. Pass `--today` explicitly; do not let an early-morning UTC date choose the previous day's plan.

Morning focus SHOULD come from this order:

1. `Needs decision`
2. `Needs unblock`
3. `Needs review`
4. due scheduled action packets
5. active or failed agent runs
6. stale `Needs attention`
7. `Ready queue`

#### Daily Plan Hierarchy

The member-authored `## Plan` MUST use three semantic levels:

1. `###` — a large topic: one observable outcome for the day.
2. `####` — a middle topic: one decision, unblock, review, or execution stream.
3. A column-zero `- [ ]` line — a small topic: one atomic next action.

Use this shape:

```markdown
## Plan

### 1. Large Topic

**Today's outcome:** One observable result.

#### 1.1 Middle Topic

- [ ] **1.1.a Small action** (`task_id`, lane, priority) — Next: verb + object. Done: evidence or ledger state.
```

Apply these rules:

- Keep the plan to about three large topics and seven small actions. Add more only when a hard deadline or driver lane would otherwise disappear.
- A small action tied to tracked work MUST include its task ID. Use `[operating decision]` when no task exists.
- Include lane, priority, or hard deadline only when it changes execution order.
- State both the next action and the completion evidence on one line.
- Mention each task once. Other sections SHOULD reference the plan number instead of duplicating the task text.
- Do not put another `##` heading inside `## Plan`; `/snap` and log compaction treat the next level-two heading as the end of the plan.
- Preserve Fisher-owned marker regions exactly. Human-authored priorities MUST stay outside those regions.

See [`workspace/charlie/logs/2026-08-25.md`](../../workspace/charlie/logs/2026-08-25.md) for a worked example.

### Snap

Use `/snap` to record a control-state checkpoint:

```bash
./hey loop brief --member <member>
./hey loop board --member <member>
```

The snap should answer:

- What is in flight?
- What changed lanes?
- Did any packet become due or get handled?
- Did an agent run fail, finish, or need review?
- What should the next driver do?

If a task is ready for agent execution, compile the mission before handoff:

```bash
./hey mission compile --task <task_id>
```

### Night

Close the day from the loop board:

```bash
./hey loop brief --member <member>
./hey loop board --member <member>
./hey packet list --member <member> --include-future
```

Night reflection SHOULD convert open loop lanes into one of:

- tomorrow's priority
- blocker to unblock
- review item
- scheduled action packet
- task or note update
- safe background

## Agent Handoff

Before assigning a task to an AI agent, compile a mission:

```bash
./hey mission compile --task <task_id>
```

Give the agent the generated `mission.md` or `mission.json`.

The mission SHOULD define:

- task context
- definition of done
- related artifacts
- dependency obligations
- evidence checklist
- escalation boundary
- runtime targets

If multiple agents work on one task, keep one canonical task and split runs by role:

| Role | Scope |
| --- | --- |
| Explorer | read-only context mapping |
| Worker | scoped implementation |
| Reviewer | risks and findings |
| Verifier | validation evidence |

Same-task agents MUST have explicit write scopes before they modify files.

## Scheduled Packets

Create a packet when a future prompt should re-enter the loop:

```bash
./hey packet new \
  --workspace <member> \
  --title "Review loop control board" \
  --trigger-at 2026-05-13 \
  --audience <member> \
  --action "Review whether the board lanes changed today's driver decisions."
```

Use packets for:

- reminders
- lightweight checks
- review prompts
- small artifact updates with clear instructions
- agent-readable follow-ups

Do not use packets for substantial work. Create a task for substantial work and let the packet point to the task.

Packets are for genuine one-off reminders. Re-surfacing deferred tasks is the iteration carry mechanism's job, not a packet's ([`decision_adr-three-layer-task-timeline`](../decisions/decision_adr-three-layer-task-timeline.md)).

## Write-Back

Every loop pass should write back only the state that matters.

Use this handoff shape when closing a task, snap, or agent run:

```markdown
## Loop Handoff

- Changed:
- Why:
- Validation:
- Risk:
- Next:
```

Write it where the next reader will look:

| Situation | Write-back location |
| --- | --- |
| Canonical task state changed | task body |
| Personal continuity changed | `workspace/<member>/logs/` |
| Another member needs action | `./hey inbox send` |
| Future prompt is needed | `./hey packet new` |
| Agent needs execution context | `./hey mission compile` |

## What Not To Do

- Do not treat the board as source of truth.
- Do not create a packet when a task is needed.
- Do not list healthy background runs as driver work.
- Do not ask the human to read every run transcript.
- Do not let two writer agents edit the same files without explicit scope.
- Do not close a loop pass without updating the task, note, packet, log, or commit that carries the state forward.

## Troubleshooting

If the board feels noisy, look for stale task status, missing blockers, vague task titles, or old `updated_at` values.

If an agent is confused, compile or refresh the mission and check whether the task has a clear definition of done.

If a due packet keeps reappearing, either complete it, convert it to a task, change its trigger, or mark it stale in the packet note.

If two agents disagree, keep both results attached to the same task until the driver selects the canonical path.
