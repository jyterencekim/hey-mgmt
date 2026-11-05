---
id: playbook_meeting-note-distillation
type: playbook
title: Meeting note distillation
created_at: '2026-06-18T00:00:00.000Z'
updated_at: '2026-10-22'
playbook_version: 1.1.0
area: Team
owner: team
status: active
tags:
  - Operations
  - Documentation
  - Automation
relations:
  - type: supports
    target: playbook_style-guide
  - type: supports
    target: playbook_style-guide-ko
  - type: mentions
    target: note_external-activity-integration-plan
sources:
  - kind: doc
    ref: content/notes/note_external-activity-integration-plan.md
    title: >-
      External Activity Integration Plan - meeting-note summary preservation
      rule
  - kind: doc
    ref: content/tasks/2026/04/task_fix-google-drive-collector-cov.md
    title: Drive collector coverage task - meeting-note summary preservation rule
---
## Purpose

Use this playbook when turning meeting transcripts, Gemini notes, Google Docs, pasted meeting text, or imported external meeting notes into `meeting` artifacts.

The goal is faithful distillation. Meeting notes preserve the meeting's important structure, thesis, decisions, and action items. They do not flatten high-signal source sections into generic discussion bullets.

## Core Rule

If the source contains an authored `Summary`, `요약`, `Action Items`, or structured headings such as `###`, the agent MUST preserve that structure unless it is clearly duplicate or malformed.

Do not re-summarize a source summary into a shorter agent summary when the source summary already carries the main thesis. Clean wording and normalize style, but keep the source's information architecture.

## Raw Context Preservation

Canonical meeting notes MUST preserve the maximum useful work context, not only the final summary.

- Save the full transcript or connector-extracted meeting body under `content/meetings/YYYY/MM/assets/<meeting-id>/` whenever the source can be stored safely.
- Prefer `transcript.txt` for a verbatim transcript and `source-gemini.txt` or `source-notion.txt` for machine-generated notes. Record the asset in `sources` and add a SHA-256 hash when practical.
- If the source contains personal, HR, medical, privileged, credential, personal-finance, or purely social material, create a near-verbatim sanitized source instead of dropping the entire body. Replace only the sensitive span with an explicit marker such as `[REDACTED: medical]` or `[REDACTED: privileged legal]`.
- Preserve work-related disagreement, alternatives, failed approaches, assumptions, numbers, qualifiers, speaker-attributed claims, decision status, and unresolved questions. Repetition and filler MAY be removed; context that changes interpretation MUST remain.
- The readable meeting artifact SHOULD contain a detailed discussion flow in addition to conclusions, decisions, open questions, and action items. The source asset remains the evidence layer when the readable artifact is condensed.
- A source URL by itself is not raw-context preservation. If connector access supplied the body during import, persist the approved and sanitized work context in the repo.
- Never convert a participant proposal into an approved decision. Attribute claims and retain uncertainty exactly where the source does.

## Required Flow

1. Read the full source text before writing the artifact.
2. Extract the source outline:
   - top-level sections,
   - `Summary` or `요약`,
   - action items,
   - decisions,
   - open questions,
   - named examples, metaphors, and product theses.
3. Create the `meeting` artifact with `./hey new --type meeting`.
4. Preserve source-summary sections in a dedicated section such as `## Source Summary`, `## Core Thesis`, or the original heading translated into repo style.
5. Add a concise `## Summary` only after preserving the source structure.
6. Add `## Topics Discussed`, `## Decisions`, `## Open Questions`, and `## Action Items` as needed.
7. Run a heading coverage check before finalizing.
8. Run `./hey validate`.

## Coverage Check

Before declaring the meeting note complete, compare source headings against the artifact.

- Every high-signal source heading MUST appear as an artifact heading or be explicitly represented by a same-meaning heading.
- Every source action item MUST appear in `## Action Items`, unless it is a duplicate.
- Every source decision-grade claim MUST appear in `## Decisions`, `## Core Thesis`, or `## Summary`.
- Named examples, analogies, and thesis phrases MUST NOT be dropped. Examples: "Goldman Sachs 2008", "source Summary", "원재료 + 효모".
- If a source section is intentionally omitted, add a short note in the artifact explaining why.

## Anti-Patterns

- Do not collapse a structured source summary into one-line `Topics Discussed` bullets.
- Do not treat `Summary` or `요약` as raw material when it is the author's main synthesis.
- Do not replace concrete thesis language with generic labels such as "business potential" unless the concrete claims remain nearby.
- Do not invent owners for action items. Use `team` when the source does not assign an owner.
- Do not copy rough transcript wording when a clean paraphrase preserves meaning better.

## Time Handling

If the meeting date is known but the exact time is unknown:

- set `start_at` and `end_at` to a validation-safe placeholder on that date;
- add `x_time_unknown: true`;
- state the uncertainty only if it affects interpretation.

## Sources

Use a stable source reference when available, such as a Drive URL, Slack thread, or canonical artifact id. If the source is a local paste without a stable repo path, use a descriptive `sources.ref` such as `user-provided pasted transcript, YYYY-MM-DD`.

## Action Item Assignment
<!-- candidate:candidate_meeting_action_assignment_20261022_playbook_meeting-note-distillation -->
Effective for meetings registered or re-synced from 2026-10-22, under [Jared's standing instruction](../../workspace/jared/inbox/meeting-action-assignment-policy-2026-10-22.json). This extends the Required Flow: meeting registration is incomplete until the action-to-task coverage check below passes.

1. Agents MUST extract each genuine agreed action, its stated owner, deliverable, and any stated due date from the reviewed source. Suggestions, possible next steps, and external counterpart promises MUST retain that status; source text does not authorize executing the work. Private-source approval and protected-information rules still apply before canonical promotion.
2. Agents MUST resolve owners against `content/vocab/members.yml`, using speaker/name context to resolve aliases and transcription errors. Every actionable item with an unambiguous mapped owner MUST become a task assigned to that person, or link to an existing task for the same deliverable. Search existing tasks before creating one; a re-import or repeated follow-up MUST NOT create another task.
3. Use repo-approved CLI paths such as `./hey new --type task --owner <member>` or inbox promotion. New tasks MUST record the meeting and source in `sources`, link to the meeting through `relations`, and define a concrete completion test. The meeting MUST link back through `relations` and show the task wiki-link beside the action. Split independent deliverables when they have different accountable owners or exceed three acceptance criteria; do not invent a lead for a jointly owned item.
4. Preserve stated deadlines and commitments. An agreed, assigned action starts `ready`; a proposal remains `plan` if tracked, with its uncertainty explicit. A verified dependency can make work `blocked`. Registration alone MUST NOT mark work `doing` or `done`, reset an existing task's lifecycle, assign an invented deadline/iteration, or silently choose a priority. Bound execution to a weekly iteration when scheduling is agreed; larger work MUST be split.
5. If ownership is absent, ambiguous, unmapped, or shared without clear accountability, record `담당 확인 필요` in the meeting and send the unresolved assignment to the importing member's inbox for clarification. The existing `team` fallback is a holding label, not a completed personal assignment. Do not default to Jared or create an internal member for an external participant. Track an internal liaison's follow-up only when that person's responsibility is explicit.
6. Agents MUST notify every newly assigned owner through `./hey inbox send --to <member> --task <task-id>`, including the originating member when this automated import is their first assignment notice. Include the deliverable, stated due date or unknown date, and meeting link. For reassignment, notify the new owner; for unchanged existing tasks, reuse recorded notification evidence and do not repeat notices on every sync. These task notices are separate from the mandatory all-team `./hey meeting notify <meeting-id>` read notice.
7. Before reporting registration complete, account for every in-scope source action with a task ID, an existing-task match, or an explicit disposition such as proposal-only, owner clarification, or protected/out-of-scope exclusion. Record the source action key, owner, task ID, source version, and notification result in the intake/meeting record. Reuse stable action identity across edits; substantive changes update the existing deliverable rather than duplicating it. Failed task creation, linkage, or notification remains incomplete with a recorded retry, never silently complete.

Apply this policy to future registrations and source updates. Historical backfill requires its own requested scope. User approval of a private meeting also authorizes registering its clearly owned agreed actions under this policy; it does not authorize external messages, fund movements, deployment, or other execution.
