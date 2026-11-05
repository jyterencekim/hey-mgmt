---
id: decision_workspace-log-compaction
type: decision
title: Workspace log compaction without raw-data loss
created_at: '2026-03-27'
updated_at: '2026-03-27'
decision_status: proposed
owners:
  - team
tags:
  - Operations
  - Infrastructure
relations:
  - type: mentions
    target: decision_no-separate-kb-dir
  - type: mentions
    target: note_external-activity-integration-plan
sources:
  - url: ARCHITECTURE.md
    title: Architecture directory map and workspace/logs role
  - url: scripts/lib/repository-artifacts.mjs
    title: Workspace artifact loading excludes logs without artifact types
  - url: scripts/lib/retrieval.mjs
    title: Search and context compile operate on the manifest index only
  - url: .claude/commands/morning.md
    title: Morning routine reads yesterday's daily log directly
  - url: .claude/commands/check.md
    title: Check routine reads today's daily log directly
  - url: scripts/lib/activity-log.mjs
    title: External activity appends verbose raw signals into workspace daily logs
area: Team
owner: team
---

## Context

Workspace daily logs are accumulating steadily under `workspace/{member}/logs/`. The concern is valid: if agents ingest them indiscriminately, verbose daily entries and `## External Signals` could bloat context and make retrieval noisy.

The current design is more efficient than it looks:

- Daily logs are plain markdown files without artifact frontmatter, so they are not loaded into the indexed manifest.
- `./hey search` and `./hey context compile` rank only indexed artifacts, not raw daily logs.
- The default agent ceremonies read logs directly by file path and only in narrow windows: `/morning` reads yesterday, `/check` reads today, `/night` reads today, and `/snap` updates today.

So the immediate problem is not "default agent context is clogged by all historical logs." The real problem is historical lookup efficiency and maintainability when a human or agent needs longer-range continuity.

## Decision

Keep raw workspace daily logs as an unindexed continuity layer, and compact history additively with summary files.

### Decision Drivers
1. The portable core should stay markdown-first and git-native.
2. Raw logs preserve provenance and should remain available for future reference.
3. Historical lookups need denser representations than daily raw logs, especially where `## External Signals` is verbose.
4. Default daily routines are already efficient and should not be disrupted.

### Policy

1. `workspace/{member}/logs/YYYY-MM-DD.md` remains the raw daily record. Do not delete or rewrite past logs as part of compaction.
2. Daily logs remain outside the manifest index. They are continuity files, not canonical retrieval artifacts.
3. Historical compaction should create additive monthly summaries such as `workspace/{member}/logs/summary-YYYY-MM.md`.
4. Summary files should condense:
   - repeated task references and carry-over themes
   - major blockers and decisions
   - reflection highlights
   - external signals into terse provenance lines such as date, source, title, and count
5. Agent workflows should continue to read only today or yesterday by default, and prefer monthly summaries only when they need older history.
6. Compaction should be manual and idempotent, not an always-on background process.

## Consequences

### Positive

- Current day-to-day routines stay fast because they keep the same narrow file reads.
- Historical context becomes cheaper to load without losing raw evidence.
- The repo avoids a second storage system, archive tree, or database for logs.
- External-signal verbosity remains available in raw logs but no longer needs to dominate historical review.

### Negative

- Summary files add another artifact class in practice, even if they are still plain workspace markdown.
- Summary quality depends on extraction heuristics until a richer summarizer is built.
- A summary can become stale if someone edits an old raw log after compaction.

## Alternatives Considered

- **Move old logs into an archive subfolder**: Rejected. It changes paths and git history but does not reduce how much raw text must be read.
- **Index daily logs into `search` and `context compile`**: Rejected. That would pollute the main retrieval path with verbose personal continuity data.
- **Delete or truncate old raw logs after summarizing**: Rejected. Raw history is still useful as provenance and for detailed retrospective work.

## Follow-ups

- Add a manual `./hey log compact` command that generates monthly summaries for completed months.
- Add a `./hey log stats` view so members can see raw-log and summary volume by workspace.
- Teach historical workflows to prefer `summary-YYYY-MM.md` before drilling into raw daily files.
- Treat `.omc/` and `.hey/` cleanup as a separate maintenance concern from workspace log compaction.
