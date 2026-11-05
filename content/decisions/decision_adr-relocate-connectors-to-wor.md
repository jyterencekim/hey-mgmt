---
id: decision_adr-relocate-connectors-to-wor
type: decision
title: 'ADR: Relocate connectors to workspace/fisher — AI agent team member'
created_at: '2026-03-27T00:00:00.000Z'
updated_at: '2026-03-27'
status: active
decision_status: accepted
owners:
  - team
tags:
  - Operations
relations:
  - type: supports
    target: decision_no-separate-kb-dir
  - type: mentions
    target: decision_deflate-ontology
sources:
  - kind: doc
    ref: ARCHITECTURE.md
    title: Portable core architecture — optional runtime guideline
  - kind: artifact
    ref: decision_no-separate-kb-dir
    title: No separate knowledge-base directory — route through existing paths
area: Team
owner: team
---
## Context

The `connectors/` top-level directory has grown to ~3,500 LOC of production runtime code: a Slack Socket Mode bot, three data collectors (Slack, Confluence, Google Drive), a tool registry, an AI agent chat service, and approval workflow management. This code:

1. **Only runs on one machine** — the Mac Mini that serves as the team's persistent local environment.
2. **Is not part of the portable core** — no other team member needs it checked out or running to contribute.
3. **Is growing in complexity** — approaching standalone-application scale while living inside a team-ops repo.

ARCHITECTURE.md states: *"Prefer improving markdown contracts/policies over adding new services. Only add optional runtime components when repeated team pain justifies them, and keep them separable from the portable core."*

The runtime is justified (it captures external signals from Slack/Confluence/Drive and routes them for human approval). But its current location as a top-level `connectors/` directory gives it equal architectural weight to `content/`, `scripts/`, and `workspace/` — which misrepresents its role.

## Decision

**Introduce `fisher` as an AI agent team member and relocate the external-activity runtime into `workspace/fisher/`.**

Specifically:

| What | From | To |
|------|------|----|
| Runtime code | `connectors/external-activity-runtime/` | `workspace/fisher/external-activity-runtime/` |
| Runtime config | `connectors/config/external-activity.yml` | `workspace/fisher/config/external-activity.yml` |
| Connectors README | `connectors/README.md` | `workspace/fisher/README.md` (rewritten as Fisher's workspace guide) |
| Top-level `connectors/` | Exists | Removed |

**What stays unchanged:**

- `content/policies/external-activity.yml` — the canonical policy artifact remains in `content/` where the team governs it.
- `scripts/lib/hermes-client.mjs`, `activity-candidates.mjs`, `activity-distill.mjs`, `activity-runner.mjs` — shared pipeline logic stays in `scripts/lib/` since it's called by `./hey activity` and is part of the CLI contract.
- `content/vocab/members.yml` — `fisher` is added as a member with `role: agent-runtime`.

**Fisher as a team member:**

- Fisher is the operational identity for the Mac Mini's always-on runtime.
- Fisher gets a workspace (`workspace/fisher/`) with the same structure as human members: README, profile, logs.
- Fisher's daily logs record collector runs, approval deliveries, and runtime events — the same pattern human members use for their work logs.
- The `agent` member in `members.yml` remains for general automation; `fisher` is specifically the runtime host identity.

## Consequences

**Positive:**

- **Repo root is cleaner** — no `connectors/` competing with the portable core directories.
- **Follows existing patterns** — `workspace/{name}/` is already the designated place for per-member infrastructure that doesn't need to be in `content/`.
- **Runtime growth is contained** — adding new collectors, tools, or services is Fisher's workspace concern, not a shared architecture decision.
- **Precedent for agent members** — establishes the pattern that AI agents are team members with workspaces, not special infrastructure.

**Trade-offs:**

- `workspace/fisher/` will be the largest workspace directory. This is acceptable — human workspaces are small because humans use external tools; Fisher's workspace is large because the runtime _is_ its tool.
- Team members who want to modify the runtime code need to know it's in `workspace/fisher/`, not a top-level directory. The ARCHITECTURE.md directory map will be updated.

**Follow-up work:**

- Update ARCHITECTURE.md directory map to reflect the move.
- Update any hardcoded paths in scripts that reference `connectors/`.
- Update `.gitignore` if needed for Fisher-specific runtime state.

## Alternatives Considered

- **Keep `connectors/` as-is**: Rejected — it gives runtime code top-level architectural weight it doesn't deserve, and the directory will only grow.
- **Move to a separate repository**: Rejected — the runtime reads `content/` and calls `./hey` directly. Splitting repos would require an API layer or git submodule, adding complexity for no gain. The runtime's value is its tight integration with the knowledge base.
- **Put runtime in `.hey/` or `.runtime/`**: Rejected — dotfile directories are for derived/ephemeral state, not tracked source code. The runtime code should be version-controlled and reviewable.

## Notes
<!-- candidate:candidate_01kmpy8552nmab8zms8y1r4qfg -->
- The Slack DM agent presented Fisher publicly as an **AI agent team member** and described the relocation ADR as already **accepted**.
- It associated the work with project **Infra**, status **active**, and owners **charlie** and **alice**.
