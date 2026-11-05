# CHANGELOG

## 2026-03-13

- Added external activity integration baseline: policy config, event/state/candidate runtime, `hey activity` CLI, and tests for ingest/coalescing/apply flow.
- Added canonical plan note for external activity integration and documented `x_external_refs` usage.

## 2026-03-16

- Added unmatched mapping candidates, artifact/day candidate supersession, and any-owner decision approval semantics for external activity ingestion.
- Added meeting candidate matching tests for recurring instances, reschedules, cancellations, and same-title same-day disambiguation.
- Declared Node `22.5+` as the supported full CLI runtime and removed eager `assess` imports from core startup.
- Added `connectors/slack-activity-bot/` so Slack approval transport lives outside canonical markdown while still routing through `./hey`.

## 2026-03-17

- Added live Confluence collector support under `connectors/slack-activity-bot/` with allowlisted page and space polling into the existing `./hey activity` pipeline.
- Replaced the Google Drive Apps Script path with a Google API collector that uses service-account auth, `changes.list` polling, and Docs/Sheets/Slides APIs for text extraction.
- Added connector tests for Confluence and Drive collectors and documented remaining rollout work in a shared todo note.

## 2026-03-19

- Added approval-gated `distill_review` candidates so high-signal unmatched external activity can be auto-distilled into canonical artifacts with a final human confirm step.
- Kept low-signal Slack and Jira events in the signal lane by default instead of opening noisy unmatched mapping candidates.
- Added confluence/drive reference mirror materialization during distill approval and covered the new candidate flow with tests.

## 2026-03-23

- Audited repo state for Gmail/Gemini, Notion meeting logs, Confluence, and git auto-save. Verified live code/config for Confluence collector + activity candidate pipeline + Claude git sync hooks; found only planning/matching artifacts for meeting automation and no repo-side Notion runtime integration.
- Compared external "context layer" vendors for a markdown-first content indexer use case. Verified the repo already has a canonical markdown -> derived index -> local sqlite stack plus lexical/context-pack retrieval, and concluded `supermemory` is the best-fit external layer to evaluate first because it adds connectors, managed hybrid retrieval, and agent-facing memory without replacing the repo's canonical contract.
- Renamed the connector runtime to `external-activity-runtime`, added background meeting sync loop support, and introduced Anthropic-backed Slack DM conversational agent support with session state, draft write confirmation, and bounded repo tool execution.

## 2026-04-01

- Added `content/notes/2026/04/note_hermes-slack-cutover-follow.md` as a follow-up to the Hermes cutover evaluator handoff note, recording that repo validation now passes and that live operator-state checks still need a shell with `pm2` and `hermes`.
- Updated `content/tasks/2026/04/task_review-hermes-cutover-diff-n.md` to link the new follow-up note and record the current review status.
