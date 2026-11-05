# Fisher Machine Architecture

This document describes the **current intended production topology** for Fisher on Hermes on the office Mac Mini.

## Summary

Fisher is a Hermes-routed agent — not a standalone bot.

Authoritative ownership now looks like this:

- **Hermes Slack gateway** owns conversational ingress and reply delivery
- **Hermes scheduled jobs** own scheduled activity pipeline turns
- **`./hey activity *`** remains the only mutation/search pipeline surface
- the old full `activity-runtime` is retained as a **break-glass fallback**, not a normal production service

## Runtime Roles

| Layer | Owner | Purpose |
| --- | --- | --- |
| Slack DM + allowlisted mentions | Hermes Slack gateway | Conversational repo help, team-DM pre-approved writes, and moderation button handling |
| Scheduled activity runs | Hermes scheduled jobs | `poll -> prepare -> classify+reflect -> finalize-reflections` |
| Moderation actions | Hermes Slack gateway | Button-first reject/revoke/delete flow with CLI fallback |
| Search cache rebuild | Hermes scheduled jobs | Periodic `hey index build` + `hey db build` |

## Process Model

### Normal production

| Process manager | Process | Purpose |
| --- | --- | --- |
| launchd | Hermes gateway | Slack, scheduled jobs, hooks, agent routing |

All scheduling and transport is handled by Hermes. There are no other long-lived processes.

### Auto-launch requirement

The Hermes gateway **must start automatically on boot** so that Fisher's Slack connectivity and all scheduled pipelines are always available without manual intervention.

This should be achieved through the Hermes operator setup on the Mac Mini. Runtime secrets live in `~/.hermes/.env`; repo-local `.env` files are only for direct shell dry-runs.

## Conversational Slack Path

1. A DM or allowlisted-channel mention arrives in Slack.
2. Hermes routes the Slack event to the repo-scoped agent `hey-mgmt`.
3. That agent runs in the repo workspace `/Users/hey-mgmt/workspace/hey-mgmt`.
4. Read-only requests execute immediately.
5. Slack DMs from authenticated TeamOS team members are treated as already-confirmed intent, including ordinary writes to `content/` or `workspace/`.
6. Non-member DMs and allowlisted-channel writes still require **Strict Confirm** before mutation.
7. Explicit moderation actions are treated as already-confirmed intent. The primary UX is Slack buttons for reject, revoke, and delete, with CLI-backed text fallback only when buttons are unavailable.

## Three-Tier Activity Model

Fisher collects external activity through a three-tier model:

| Tier | Gate | Storage | Human role |
|------|------|---------|------------|
| Raw events | None (free collection) | Daily logs (`External Signals` section) | — |
| Observations | AI reflection (second pass) | `workspace/fisher/observations/{YYYY-MM-DD}.md` | Delete noise |
| Team knowledge | AI auto-promotion | `workspace/fisher/knowledge/{YYYY-MM}.jsonl` + `content/` artifacts | Revoke bad promotions |

### Ontology

- **Raw event**: Any signal collected from an external source (Slack message, Confluence edit, Drive update). Always recorded in daily logs. No gate.
- **Observation**: An event that passes a two-pass AI evaluation. First pass classifies (match/distill/skip). Second pass (reflection) evaluates against core principles, current iteration goals, signal strength, and duplication. Stored in daily markdown files for team browsing.
- **Team knowledge**: An observation that Fisher auto-promotes to the durable knowledge base. For `match` decisions, the target content artifact is auto-updated. For `distill` decisions, a new artifact is created. Knowledge entries are written to `workspace/fisher/knowledge/` and become searchable.
- **Revoke**: A human can revoke a promotion, which demotes the knowledge entry back to observation tier. Content artifact edits are not auto-rolled back.
- **Delete**: A human can delete an observation, which removes it from the staging file and marks the knowledge entry as rejected.

### Reflection Pass

The second AI pass evaluates each classified event against:

- Core principles from the repo's style guide and playbooks
- Current iteration goals (what's active this week)
- Signal strength — source type, actor relevance, content depth
- Duplication — already captured in an existing artifact or recent observation
- Promotion threshold — high confidence + high relevance + actionable = promote; moderate = observe only

Configuration (`external-activity.yml`):
- `reflection.promotion_confidence_threshold`: 0.8 (auto-promote above this)
- `reflection.observation_confidence_threshold`: 0.5 (record as observation above this)

## Scheduled Activity Path

Hermes runs one isolated agent turn per source.

Each scheduled turn follows the same contract:

1. `node scripts/hey.mjs activity poll <source>`
2. `node scripts/hey.mjs activity prepare-candidates`
3. agent classifies unmatched events using the `hey-mgmt-activity` skill (includes reflection field)
4. `node scripts/hey.mjs activity finalize-reflections --data '{...}'`

The collectors still live in `workspace/fisher/external-activity-runtime/lib/`, but they are now reused through CLI entry points instead of being driven by an always-on custom scheduler.

## Digest Notifications

Fisher posts a batched digest to `#hey-mgmt-internal` twice daily (12:00 and 18:00 KST, configurable). Each digest shows:

- **Promoted items** with a `Revoke` button
- **Observations** with a `Delete` button
- **Pipeline health summary** (source freshness, knowledge counts, observation counts)

This replaces the old per-candidate approval DMs. No active approval is required — team members only intervene to reject, revoke, or delete.

## Status and Health

Fisher's pipeline health is available via:

- **CLI**: `./hey activity status` (human-readable) or `./hey activity status --json`
- **CLI + Slack**: `./hey activity post-status` (posts to configured channel)
- **DM**: type `status`, `health`, or `diagnose` to Fisher in Slack
- **Recurring**: appended to each twice-daily digest message

## Repo-Scoped Boundary

The Slack-exposed agent must be isolated from any general-purpose agent workspace.

Required boundary:

- agent id: `hey-mgmt`
- workspace: `/Users/hey-mgmt/workspace/hey-mgmt`
- Slack channel binding: `slack`
- Slack group policy: `allowlist`
- allowlisted team channels only:
  - `C0AC9CBPPJS` — `hey-mgmt-daily-weekly-sync`
  - `C0A8A1ELH9A` — `hey-mgmt-internal`
  - `C08RB11D5PE` — `hey-mgmt_dev`
  - `C08K28MAL3C` — `hey-mgmt_general`

DMs remain valid; non-allowlisted group/channel traffic must not reach the repo agent.

## Knowledge Base

Fisher writes to the knowledge base only after the reflection pass, and only when a source item has enough metadata to be useful: source, object id, title, date, and signature. Normal writes are append-only so concurrent agents do not rewrite the same monthly file. Git union merge is scoped to `workspace/fisher/knowledge/*.jsonl`, so concurrent appended rows are retained during rebase. Readers apply logical upsert by signature: filtered or observed items are `indexed`, and successful promotions are `linked`.

| Layer | Path | Git | Purpose |
|-------|------|-----|---------|
| Observations | `workspace/fisher/observations/YYYY-MM-DD.md` | tracked | Daily staging area, human-browsable |
| Durable index | `workspace/fisher/knowledge/YYYY-MM.jsonl` | tracked | Append-only pointer entries |
| Search cache | `.hey/catalog.sqlite` `knowledge` table | local | Rebuilt by `./hey db build`; search rebuilds it when tracked knowledge is newer and deduplicates by signature |

Knowledge entry statuses:

| Status | Meaning |
|--------|---------|
| `indexed` | Classified but not promoted (observed or filtered) |
| `linked` | Promoted — artifact updated, searchable |
| `revoked` | Human revoked promotion — demoted to observation |
| `rejected` | Human deleted observation |

Search is available to all team members via CLI (`./hey search --include-knowledge`) and Slack (via `search_knowledge` tool). Korean and English search are both supported.

Physical compaction is explicit maintenance, not part of the hot write path:

```bash
./hey activity compact-knowledge
./hey db build
```

Automatic compaction is a separate Hermes scheduled job, `hey-mgmt-knowledge-compaction`, scheduled at 03:15 KST:

```bash
./hey activity auto-compact-knowledge
```

The auto command pulls latest `main`, records compaction stats in local runtime state, and rewrites tracked knowledge JSONL only when configured thresholds are met. The default policy is at least 24 hours between compactions, with a threshold trigger at 500+ superseded rows and 20%+ garbage, plus a weekly periodic trigger when at least 50 superseded rows exist.

## File Map

```text
workspace/fisher/
  README.md
  ARCHITECTURE.md
  config/
    external-activity.yml
  observations/
    YYYY-MM-DD.md          # daily observation staging files (git-tracked)
  knowledge/
    YYYY-MM.jsonl          # durable knowledge pointer entries (git-tracked)
  skills/
    hey-mgmt-activity/
      SKILL.md
    hey-mgmt-slack-agent/
      SKILL.md
    hey-mgmt-design-system/
      SKILL.md          # shared PDF/HTML/Excel design-system entrypoint
  external-activity-runtime/
    README.md
    lib/
      activity-service.mjs
      collector-utils.mjs
      config.mjs
      confluence-collector.mjs
      drive-collector.mjs
      git-sync.mjs
      github-collector.mjs
      google-auth.mjs
      slack-collector.mjs
```

## Operational Checks

Use these to verify the repo state matches this document locally:

```bash
./hey validate
```

Live gateway, Slack allowlist, repo-scoped workspace, and scheduled-job checks happen on Hermes on the office Mac Mini.
