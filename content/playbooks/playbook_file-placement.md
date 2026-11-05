---
id: playbook_file-placement
type: playbook
title: 'File Placement: How Artifacts Find Their Home'
created_at: '2026-04-08'
updated_at: '2026-10-26'
playbook_version: 1.1.0
owner: team
status: active
tags:
  - Operations
  - Documentation
relations:
  - type: supports
    target: playbook_operating-philosophy
  - type: supports
    target: playbook_golden-principles
  - type: mentions
    target: playbook_governing-artifact-maintenance
  - type: supports
    target: decision_no-separate-kb-dir
  - type: supports
    target: decision_ideas-and-promote-workflow
sources:
  - kind: doc
    ref: AGENTS.md
    title: Agent routing rules and knowledge placement table
  - kind: doc
    ref: ARCHITECTURE.md
    title: Architecture directory map and knowledge placement guidance
  - kind: doc
    ref: docs/OPERATING_GUIDE.md
    title: Operating guide workspace and content governance
  - kind: doc
    ref: content/decisions/decision_no-separate-kb-dir.md
    title: 'Decision: no separate knowledge-base directory'
  - kind: doc
    ref: content/decisions/decision_ideas-and-promote-workflow.md
    title: 'Decision: ideas plus promote two-stage workflow'
---

# File Placement: How Artifacts Find Their Home

## Purpose

Give humans and agents one canonical routing policy for where new information belongs. This playbook is the placement map. Dynamic search and repo exploration happen after the policy answers the class of artifact.

## Rule

Agents MUST consult this routing policy first, then explore the repo dynamically for nearby precedent, related artifacts, and existing IDs before writing anything.

Policy decides the class. Exploration decides the exact file and relations.

If a change updates this routing policy in practice, this playbook MUST be updated in the same work. See `playbook_governing-artifact-maintenance`.

## Routing Table

| What you have | Put it here | Why |
| --- | --- | --- |
| Shared actionable work | `content/tasks/YYYY/MM/` | Tasks are the shared execution ledger |
| Shared decision and rationale | `content/decisions/` | Decisions capture commitments and trade-offs |
| Shared spec, finding, report, analysis, or idea | `content/notes/` | Notes are the catch-all knowledge artifact |
| Reusable procedure, runbook, convention, or team know-how | `content/playbooks/` | Playbooks hold repeatable operating knowledge |
| External protocol or vendor reference material | `docs/references/` | Reference docs are not team-authored canonical artifacts |
| Docs about how `hey-mgmt` itself works | `docs/` | Repo-operating documentation for this system |
| Personal draft, scratch work, or individual progress | `workspace/{name}/` | Personal work area before promotion |
| Raw intake not yet classified | `workspace/{name}/inbox/` | Inbox-first chaos containment |
| Personal continuity log | `workspace/{name}/logs/` | Daily continuity layer, not indexed artifacts |
| Derived output or runtime state | `index/`, `.hey/`, `.runtime/` | Derived or local-only, never canonical |

## Decision Procedure

1. Ask whether the information is personal or shared.
2. If it is personal, put it in `workspace/{name}/` unless it is raw intake or a daily log.
3. If it is shared, ask whether it is work, rationale, knowledge, or reusable instruction.
4. Route to `task`, `decision`, `note`, or `playbook` accordingly.
5. Only after choosing the class, search the repo for related artifacts, existing IDs, and vocabulary.

## Agent Procedure

Agents SHOULD follow this order:

1. Read this playbook for placement policy.
2. Use `./hey search` or `./hey context compile` to find nearby artifacts and prior work.
3. Inspect the local directory only as needed to resolve edge cases.
4. Link to existing artifacts with `relations` instead of copying content.

This avoids two failure modes:

- Pure exploration with no policy, which produces inconsistent placement.
- Giant hand-maintained indexes, which become stale and duplicate the repo structure.

## Space Mirror

Every member and agent MUST follow Codex Space Mirror after creating, updating, renaming, archiving, or removing eligible shared content. Publish one document per Page, maintain linked indexes, and preserve mgmt as canonical. If publication is unavailable, record pending paths, responsible member, and reason in a tracked workspace receipt. Source completion and mirror completion MUST be reported separately.

Reports is a cross-topic reading view. Reports stored as notes keep their canonical note type and location; Reports links to their existing document Pages. Personal workspaces and raw assets are excluded unless explicitly included. These rules do not install unattended synchronization.

## Placement Hooks

Use these hooks for placement-related changes:

### Input Hook

Before implementing a change, ask whether it changes where something belongs, what artifact type should be used, or how agents should route information.

If yes, this playbook is part of the intended write set.

### Output Hook

Before declaring the work complete, ask whether the actual routing rule changed.

If yes, this playbook MUST describe the new rule in the same change.

## Promotion Rule

If something starts as a personal draft but becomes team-relevant, promote it into `content/` rather than expanding the workspace into a parallel knowledge base.

Use these promotion targets:

| Draft matures into | Promote to |
| --- | --- |
| Shared backlog item | `content/tasks/` |
| Shared report or finding | `content/notes/` |
| Reusable instruction or convention | `content/playbooks/` |
| Team commitment or architecture choice | `content/decisions/` |

## Anti-Patterns

- Do not create a new top-level knowledge directory.
- Do not store shared evergreen knowledge only in a member workspace.
- Do not put cross-repo team conventions in root docs when they belong in `content/playbooks/`.
- Do not use `docs/` as a second canonical artifact graph.
- Do not hand-edit derived state under `index/`, `.hey/`, or `.runtime/`.

## Heuristics

- If the team needs to coordinate on it, review it, or cite it later, it belongs in `content/`.
- If the value is in repeated reuse, it is probably a `playbook`.
- If the value is in explaining what is true, it is probably a `note`.
- If the value is in deciding what we will do, it is probably a `decision`.
- If the value is in getting work done next, it is probably a `task`.

## Scalability

This model scales because the placement map stays short and stable while discovery stays dynamic:

- The map is hand-maintained policy.
- The repo index is derived discovery.
- Search and context compilation are on-demand lookup tools.

Keep the policy small. Let the index do the exhaustive work.
