---
name: desk-weekly
description: Weekly iteration sync, iteration open/close/turn, roadmap review, and workspace/backlog hygiene. Triggers when the member asks to run weekly sync, open or close a week iteration, review the roadmap, or clean up stale/unowned artifacts.
---

# Weekly Desk Cadence (`sync` · `iteration` · `roadmap` · `clean`)

Manage weekly team/personal rhythm without requiring slash commands. Read `MEMBER` and `LANGUAGE` from `.env`.

## 1. Weekly Iteration Sync & Rotation

Triggers: "weekly sync", "close this week", "start next week's iteration", "주간 싱크", "이터레이션 마감/시작".

1. **Rebuild State:**
   ```bash
   ./hey index build && ./hey db build
   ```
2. **Prepackage & Survey:**
   - Run `./hey iteration prepackage` (optionally `--no-pr` offline) to collect merged PRs, finished tasks, and open carry-overs.
   - Check active roadmaps (`./hey search "" --status plan`), blocked tasks (`./hey search "" --type task --status blocked`), recently done tasks, and `./hey validate`.
3. **Close Outgoing Iteration Log (if active `YYYY-WNN` exists):**
   - Read `content/notes/**/note_iteration-log-*.md` for the outgoing week.
   - Summarize accomplishments against `## Goals`, list incomplete tasks (`carry_over` vs `drop`), capture retro observations, and update `status: done`.
4. **Capture Sync Meeting (team desks):**
   - Create meeting artifact via `./hey new --type meeting --title "Weekly sync YYYY-WNN"`, fill `attendees`, `start_at`, `end_at`, discussion notes, and action items, then notify team members (`./hey meeting notify <id>`).
5. **Open Next Iteration Log & Reassign Planned Tasks:**
   - Create `note_iteration-log-YYYY-WNN` (`tags: [IterationLog]`, `x_iteration: YYYY-WNN`, `status: active`) with carried-over goals and updated task `iteration` fields.
6. **Validate & Push:** Run `./hey validate`, stage only changed files by name, commit, and push.

## 2. Roadmap & Progress Assessment

Triggers: "review roadmap", "team progress", "로드맵 점검", "진행 현황".

- Run `./hey loop board --member $MEMBER`, `./hey loop health`, `./hey initiative check` / `./hey initiative alert`, and `./hey assess`.
- Highlight active initiatives, product kickoff gate gaps (`decision_adr-product-initiative-kickoff`), and overdue hard deadlines (`due_date`).

## 3. Weekly Hygiene Cleanup (`clean`)

Triggers: "hygiene check", "clean up backlog", "백로그 정리".

1. Run `./hey index build && ./hey db build && ./hey validate`.
2. Check:
   - Ready tasks without an owner (`./hey db query "SELECT id, title, area FROM items WHERE type='task' AND status='ready' AND (owner IS NULL OR owner = '')"`).
   - Blocked tasks missing `blocked_by` relations.
   - Stale hygiene signals (`./hey hygiene check`).
   - Change-contract candidates updated in the last 14 days (`ChangeImpact` / `x_change_contract`).
   - Repo registry drift against `content/vocab/repos.yml`.
3. Present findings, get explicit approval before mutating shared files, apply fixes, and re-run `./hey validate` before committing.
   - Note: Never auto-flip `done` tasks to `archived` based on age (`decision_adr-task-done-vs-archived-lif`).
