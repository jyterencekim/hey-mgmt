# Workflow Guide

Team ceremonies and coordination rituals for the hey-mgmt system.

> For creating and updating individual tasks, see your `workspace/{name}/README.md`.

## 1. Roadmap Management

### Create a Roadmap (Plan)

A roadmap is a task artifact with `status: plan` that links to child tasks via relations.

```bash
./hey new --type task --title "Plan: Oracle Adapter V2 Migration" --project Core --owner jared --field status=plan
```

Then edit the generated file to add child task relations:

```yaml
relations:
  - type: implements
    target: decision_oracle-adapter-v2
  - type: blocks
    target: task_adapter-data-layer
  - type: blocks
    target: task_adapter-integration
```

Add phases and milestones in the body:

```markdown
## Phases
1. Data layer migration (week 1)
2. Integration tests (week 2)
3. Production rollout (week 3)

## Progress Log
- YYYY-MM-DD: Plan created
```

### Update a Roadmap

When a child task is completed:

1. **Open the plan artifact** (the parent task with `status: plan`)
2. **Update the progress log** with the milestone
3. **When all child tasks are done**, set the plan's status to `done`

```markdown
## Progress Log
- 2026-03-04: Plan created
- 2026-03-07: Phase 1 complete — data layer migrated
- 2026-03-10: Phase 2 complete — integration tests passing
- 2026-03-12: All phases complete, plan done
```

## 2. Daily Standup

Run before the standup:

```bash
# What's ready to claim?
./hey search "" --type task --status ready --project Core

# What's doing (in progress)?
./hey search "" --type task --status doing --project Core

# What's blocked?
./hey search "" --type task --status blocked

# What got done recently?
./hey search "" --type task --status done
```

Share in standup:
- **Done**: tasks moved to `done` since last sync
- **Ready**: tasks in `ready`; these are committed but not currently being worked
- **Doing**: tasks in `doing`, with brief progress note
- **Blocked**: tasks in `blocked` status, what they're waiting on

If a task was assigned by someone else and you want an explicit receipt without changing status, run:

```bash
./hey task ack --task <task_id> --note "Acknowledged; starting after current blocker"
```

## 3. Weekly Iteration Sync

The sync ceremony is the **iteration boundary**. It closes the outgoing iteration log and opens the next one.

### Close the outgoing iteration

Run `/iteration-close` to process the current iteration log. This generates the retrospective summary and carry-forward items.

### Before the sync

```bash
# Active plans (roadmaps)
./hey search "" --status plan

# Stale items
./hey validate
```

### During the sync

1. **Review the iteration summary** — goals achieved, velocity, key observations from the closed iteration log
2. **Review each active plan** — check progress log, identify slipping phases
3. **Review blocked tasks** — decide on unblocking actions
4. **Archive completed work** — move `done` tasks to `archived` if no longer needed
5. **Capture decisions** — any decisions made during sync get a `decision_` artifact
6. **Update roadmap** — adjust phases and timelines based on discussion

### After the sync

```bash
# Create a meeting note
./hey new --type meeting --title "Weekly sync 2026-W10" --field "attendees=[jared, terence, oliver, eb]" --field "start_at=2026-03-07T10:00:00Z" --field "end_at=2026-03-07T11:00:00Z"
```

Edit the meeting artifact to capture:
- Key discussion points
- Decisions made (link to `decision_` artifacts)
- Action items with owners

### Open the next iteration

Run `/iteration-open` to scaffold the next iteration log with goals from the sync discussion and carry-forward items.

## 3.1 Iteration Log Lifecycle

The iteration log (`note_iteration-log-YYYY-wNN`) is a team-level artifact that accumulates throughout the week:

| When | Command | What happens |
|------|---------|--------------|
| Week start (via `/sync`) | `/iteration-open` | Scaffolds log with goals and carry-forward |
| During the week | `/iteration-add` | Appends `[milestone]`, `[blocker]`, `[decision]`, `[coordination]` entries |
| Week end (via `/sync`) | `/iteration-close` | Generates summary, carry-forward, sets `status: done` |

The iteration log is **upstream** — `/morning` reads its goals, `/assess` pulls its velocity data. Member ceremonies never write to it.

Use `/iteration-board` at any time to see a kanban view of the current iteration with workload, goals, activity timeline, and health indicators.

## 4. Team Hygiene Checklist

Run weekly:

- [ ] Archive stale `done` tasks older than 2 weeks
- [ ] Update `updated_at` on any artifact you touched
- [ ] Ensure every `ready` task has an `owner`
- [ ] Ensure every `blocked` task has a `blocked_by` relation
- [ ] Distill repeated hidden follow-ups into `content/notes/dependencies/` dependency notes
- [ ] Distill repeated lessons into `content/playbooks/`
- [ ] Run `./hey log compact --all` to add workspace summaries without touching raw logs
- [ ] Run `./hey validate` — zero errors before merging

## 5. Meeting Note Imports

For Gemini/Gmail and Notion-driven meeting sync:

```bash
./hey meeting import-gmail --dry-run --limit 5
./hey meeting import-notion --dry-run --limit 5
./hey meeting import-all --limit 10
```

Rules:
- Gmail is the discovery layer for Gemini notification emails; the canonical body comes from the linked Google Doc when fetch succeeds.
- If required `meeting` fields are missing, the importer creates a `note` stub instead of an invalid `meeting`.
- Notion is authoritative when both Gmail/Google Docs and Notion refer to the same meeting.

## Quick Reference

| What you want | Command |
|---------------|---------|
| Find active plans | `./hey search "" --status plan` |
| Find ready tasks | `./hey search "" --type task --status ready` |
| Find doing tasks | `./hey search "" --type task --status doing` |
| Find blocked tasks | `./hey search "" --type task --status blocked` |
| Acknowledge an assigned task | `./hey task ack --task <task_id>` |
| Show log volume | `./hey log stats` |
| Compact workspace logs | `./hey log compact --all` |
| Validate everything | `./hey validate` |
| Build/refresh local semantic index | `./hey index build --qmd` |
| Force semantic search backend | `./hey search "..." --backend qmd` |
| Create meeting note | `./hey new --type meeting --title "..."` |
| Record a decision | `./hey new --type decision --title "ADR: ..."` |
| Iteration kanban board | `/iteration-board` |
| Open iteration log | `/iteration-open` |
| Add iteration entry | `/iteration-add` |
| Close iteration log | `/iteration-close` |
| Import Gmail meeting notes | `./hey meeting import-gmail` |
| Import Notion meeting notes | `./hey meeting import-notion` |
| Import all meeting notes | `./hey meeting import-all` |
