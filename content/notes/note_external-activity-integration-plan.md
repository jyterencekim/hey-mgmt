---
id: note_external-activity-integration-plan
type: note
title: External Activity Integration Plan
created_at: '2026-03-13T00:00:00.000Z'
updated_at: '2026-04-16'
status: active
owner: team
tags:
  - Operations
  - Integration
sources: []
area: Team
---
## Context

This note captures the implemented external activity integration baseline for `hey-mgmt`.

## Content

### What is implemented

- `hey activity ingest --file <events.json>` ingests normalized external events.
- External events are coalesced by `(source, object_id, KST date)` and written to each member's daily workspace log under `

## Pipeline behavior
<!-- candidate:reflection_4ce1a7f91e6dc75c -->
- 2026-04-09: Slack-facing explanation documented the current pipeline as poll → prepare-candidates → classify → finalize-reflections, with auto-promotion for high-confidence items and reject/revoke/delete as the moderation path.

## Operating model
<!-- candidate:reflection_76b76820652d6ddf -->
- 2026-04-09: Slack discussion clarified the active operating model for external activity. The pipeline remains poll -> prepare-candidates -> agent classification -> finalize-reflections, but the intended product behavior is autonomous promotion after reflection with humans acting mainly through reject, revoke, and delete controls rather than pre-approval. The thread also surfaced a remaining implementation gap: some runtime surfaces still show legacy candidate/open states that can make the current behavior look approval-based.
<!-- candidate:reflection_38c588c21d328000 -->
- 2026-04-09: Slack discussion clarified the operational flow as poll -> prepare-candidates -> agent classify (match, distill, skip) -> finalize-reflections -> digest notifications. It also clarified that strong matches can be auto-reflected, while new durable distill outputs are expected to remain as reviewable candidates rather than being blindly auto-published, and that secret or config changes require explicit human approval before execution.

## Progress
<!-- candidate:reflection_50b911c8a6ecab91 -->
- 2026-04-09: Slack-directed backlog catch-up work started after increasing max source-text read limits to 50k chars, with explicit instruction to auto-distill historical Google Drive and Confluence content and return long-text examples during processing.
<!-- candidate:reflection_0e718f8e3f0d3f0f -->
- 2026-04-09: Slack pipeline operations discussion confirmed the activity pipeline is centered on GitHub PR/issue activity rather than generic git commit ingestion, increased source_text handling limits from 3000 to 50000 characters in runtime code paths, and clarified that secret or config changes require impact explanation and approval before execution.
<!-- candidate:reflection_aec106d79e6c71aa -->
- 2026-04-09: Backlog catch-up plan documented, with 222 raw external documents and 864 open candidates requiring staged classification rather than a single recent-events pass.
<!-- candidate:reflection_2f2eb8f8bc636182 -->
- 2026-04-09: Identified a gap in recent polling cadence and documented that backlog catch-up needs a separate staged processing route beyond the default recent-event prepare flow.
<!-- candidate:reflection_96679b08d9135e58 -->
- 2026-04-10: Slack backlog catch-up work clarified current scale (288 open candidates after filtering), fixed Drive collector coverage for the specified My Drive folder, and established that meeting-note distillation SHOULD preserve the source Summary section rather than re-summarizing it.

## Operational Updates
<!-- candidate:reflection_5adbc4bdfcf77a50 -->
- 2026-04-09: Slack ops thread clarified backlog catch-up expectations for Confluence and Drive distillation, confirmed preference for auto-promotion with revoke/delete as the moderation path, requested meeting-note summaries to preserve source summaries when possible, and expanded source-text handling toward much longer excerpts for classification inputs.

## Implementation Notes
<!-- candidate:reflection_2c21663a48ea3119 -->
- 2026-04-09: Follow-up Slack discussion clarified that the intended operating model is auto-promotion with post-hoc revoke and delete moderation, not pre-approval. The same thread also recorded an operational preference for concise executive-summary responses, raised the source-text limit target from 3k toward 50k characters for distill inputs, and captured a correction that secret or config mutations should require explicit impact explanation and approval first.

## Decisions
<!-- candidate:reflection_346b6c978514d6db -->
- 2026-04-09: Slack clarification confirmed the intended operating model is autonomous collection and auto-promotion after reflection, with human moderation shifted to reject/revoke/delete after the fact rather than pre-approval. The thread also confirmed that Confluence and Drive distillation should use document body excerpts, not titles alone, while noting runtime traces of legacy candidate/open language still remain.

## Operational changes
<!-- candidate:reflection_1a5a7605fc0cf231 -->
- 2026-04-09: Operator instruction updated the backlog-distillation workflow to use a higher max text read limit of 50,000 characters when reading Drive and Confluence sources, and to continue auto-distilling historical files while surfacing representative max-text examples in-thread during execution.

## Runtime Gaps
<!-- candidate:reflection_987fd3f1e83beba2 -->
- 2026-04-09: Slack discussion noted that legacy `candidate/open` wording still appears in parts of the runtime even though the intended model is autonomous promotion with post-hoc revoke/delete controls.

## Processing Rules
<!-- candidate:reflection_d1ec66a74eb9e721 -->
- 2026-04-09: For meeting notes, preserve the original `Summary`/`요약` section whenever possible and avoid adding a second layer of agent re-summarization unless cleanup is necessary.

## Updates
<!-- candidate:reflection_16be5e0d4225c2ca -->
- 2026-04-09: Slack backlog catch-up thread clarified and implemented the external-activity operating path, including Drive folder scoping for Alice's meeting-note folder, My Drive enumeration fixes, summary-first handling for meeting notes, temporary background catch-up execution, and removal of nonessential local changes before continuing the pipeline.

## External Signals`.
- Exact `x_external_refs` matches in `content/` create pending `content_update` candidates under `.hey/external-activity/candidates/`.
- High-signal external objects with no exact `x_external_refs` match can create `distill_review` candidates with an auto-distilled canonical draft that still requires human approval.
- Lower-signal non-matches fall back to an `unmatched_mapping` candidate or stay workspace-log-only depending on source policy.
- `hey activity candidates` lists pending candidates.
- `hey activity approve --id <candidateId>` applies a content update or materializes an approved distill draft into canonical content, then validates the repo.
- `hey activity reject --id <candidateId>` rejects the candidate without mutating canonical artifacts.

### Current scope

- Sources modeled in config: Slack, Jira, Confluence, Google Drive, GitHub.
- Runtime config lives at `content/policies/external-activity.yml`.
- Runtime state lives outside canonical content at `.hey/external-activity/`.
- Slack approval transport lives under `connectors/external-activity-runtime/` and stores delivery state under `.runtime/external-activity-runtime/`.
- Live collectors under `connectors/external-activity-runtime/` now poll Slack allowlist channels, Confluence pages/spaces, and Google Drive through Google APIs.
- Candidate supersession is keyed by `artifact/day` for matched artifacts and `source/object/day` for unmatched mappings.
- Decision candidates inherit `owners[]` as approvers and use `any_approver` approval semantics.
- Distill review candidates use signal scoring plus cached raw source text to draft canonical artifacts before approval.
- Live collector polling and Slack approval transport are runtime integrations layered on top of this repo contract.
- Google Drive currently uses `changes.list` polling plus Docs API, Sheets API, and Slides API for text extraction.
- Google Workspace Drive Events remains a later option once admin permissions, Pub/Sub setup, and preview access are available.

### Supported runtime

- Full `hey` CLI support requires Node `22.5+`
- Reason: `db` and `assess` commands depend on `node:sqlite`
- Core commands such as `validate`, `new`, `search`, and `activity` no longer eager-load the SQLite runtime

### `x_external_refs` convention

Use `x_external_refs` in frontmatter to link a canonical artifact to an external object.

Example:

```yaml
x_external_refs:
  - jira:SUPER-321
  - source: confluence
    object_id: "149783426"
  - github:hey-mgmt-io/core-service/pull/31
  - source: github
    object_id: "kaiachain/app-frontend/pull/268"
```

#### Shorthand vs structured form

Both forms are equivalent for all sources:

| Shorthand | Structured |
|-----------|-----------|
| `github:hey-mgmt-io/repo/pull/42` | `{ source: github, object_id: "hey-mgmt-io/repo/pull/42" }` |
| `github:hey-mgmt-io/repo/issues/7` | `{ source: github, object_id: "hey-mgmt-io/repo/issues/7" }` |
| `jira:SUPER-321` | `{ source: jira, object_id: "SUPER-321" }` |

#### GitHub `object_id` format

GitHub refs use the format `{owner}/{repo}/{type}/{number}`:

- **PRs**: `hey-mgmt-io/core-service/pull/31`
- **Issues**: `hey-mgmt-io/core-service/issues/7`

The `owner/repo` prefix matches the remote URL in `content/vocab/repos.yml` (with `https://github.com/` stripped). This makes cross-referencing between `gh-survey.sh` output and `x_external_refs` straightforward.

Exact matches create automatic `content_update` candidates.
High-signal non-matches can create `distill_review` candidates.
Other non-matches create `unmatched_mapping` candidates that require a manual link before shared content can be updated.

### GitHub collector

The GitHub collector (`workspace/fisher/external-activity-runtime/lib/github-collector.mjs`) polls GitHub repositories listed in `content/vocab/repos.yml` for PR and issue activity via the `gh` CLI.

**Event types:**

| object_type | Tracks |
|------------|--------|
| `github-pr` | PR opened, merged, closed, review state changes |
| `github-issue` | Issue opened, closed, commented |

**Member mapping:** GitHub logins are mapped to workspace owners in `workspace/fisher/config/external-activity.yml` under `github_collector.members`.

**Complementary to gh-survey.sh:** The Phase 1 `scripts/gh-survey.sh` is a read-only snapshot tool for daily commands (`/check`, `/morning`, etc.). The GitHub collector is the Phase 2 pipeline integration — it polls on a schedule, generates events, and feeds the candidate approval workflow for task-PR linking.
