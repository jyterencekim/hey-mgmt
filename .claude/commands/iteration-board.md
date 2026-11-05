Team iteration kanban and progress dashboard. Shows the current iteration's state at a glance.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


This is an **informational-only** command — it reads state but never executes work or modifies files.

Accepts an optional argument: a specific iteration identifier (e.g., `2026-W10`). Defaults to the current week.

Run these steps in order:

1. Determine the target iteration (`YYYY-WNN`) from the argument or today's date using ISO 8601 week numbering.

2. Gather all data in parallel:

   **a) Tasks for this iteration:**
   ```bash
   ./hey search "" --type task --status ready
   ./hey search "" --type task --status doing
   ./hey search "" --type task --status blocked
   ./hey search "" --type task --status done
   ./hey search "" --type task --status plan
   ```
   Read each task file and filter to those with `iteration: YYYY-WNN` matching the target. Collect: id, title, status, owner, priority, project.

   **b) Iteration log** (if it exists):
   ```
   content/notes/**/note_iteration-log-*.md
   ```
   Match the target `YYYY-WNN`. If found, read the full file — extract Goals, Entries, Carry-Forward, and Summary sections.

   **c) Members list:**
   Read `content/vocab/members.yml` for the full team roster.

3. Present the **Iteration Board** using this layout:

   ```markdown
   ## Iteration Board — YYYY-WNN

   ### Kanban

   | Plan | Ready | Doing | Blocked | Done |
   |------|--------|-------------|---------|------|
   | `task_id` title (owner, pri) | ... | ... | ... | ... |

   ```

   Rules for the kanban table:
   - Each cell shows: task title, owner, and priority badge
   - Format each task as a compact line: `title (owner, do)`
   - Sort within each column by priority (`do` first, then `plan`, `routine`, `drop`). Priority rationale: [`decision_adr-replace-p0-p3-priority-wit`](../../content/decisions/decision_adr-replace-p0-p3-priority-wit.md)
   - Use one row per task — leave other columns empty. This makes vertical scanning easy
   - If a column is empty, show `—` in its first row
   - Cap at 20 tasks per column. If more, show count: `... and N more`

   Example:
   ```markdown
   | Plan | Ready | Doing | Blocked | Done |
   |------|--------|-------------|---------|------|
   | — | Bridge aggregator (terence, do) | | | |
   | | Risk monitoring (eb, plan) | | | |
   | | Landing page SEO (jared, plan) | | Morpho integration (oliver, routine) | |
   ```

4. Present **Workload by Member**:

   ```markdown
   ### Workload

   | Member | Plan | Ready | Doing | Blocked | Done | Total |
   |--------|------|--------|-------------|---------|------|-------|
   | terence | 0 | 2 | 1 | 0 | 3 | 6 |
   | jared | 0 | 3 | 0 | 0 | 1 | 4 |
   | oliver | 0 | 2 | 0 | 1 | 0 | 3 |
   | eb | 0 | 1 | 0 | 0 | 0 | 1 |
   | team | 0 | 4 | 0 | 0 | 0 | 4 |
   | **Total** | **0** | **12** | **1** | **1** | **4** | **18** |
   ```

   - Include a row for `team`-owned tasks
   - Bold the totals row
   - Flag imbalance: if any member has 2x+ more active tasks than the average, note it

5. Present **Iteration Progress** (only if iteration log exists):

   ```markdown
   ### Goals

   - [x] Goal achieved (linked task done)
   - [ ] Goal not yet achieved (task_xxx — ready)
   - [ ] Goal not yet achieved (task_xxx — blocked)

   Progress: X/Y goals achieved
   ```

   Cross-reference each goal with task status. Check if the linked task ID has reached `done`.

6. Present **Activity Timeline** (only if iteration log has entries):

   ```markdown
   ### Activity

   - 2026-03-10 [milestone] Bridge aggregator deployed to testnet
   - 2026-03-11 [blocker] Morpho deployment gated by KF hardfork
   - 2026-03-12 [decision] Use Redstone oracle for Pendle markets
   ```

   Show the most recent 10 entries from `## Entries`. If more exist, show count: `(N total entries, showing latest 10)`

7. Present **Health Indicators**:

   ```markdown
   ### Health

   - Blockers: N task(s) blocked — [list with reasons if available]
   - Overdue: N task(s) past due_date — [list]
   - Unassigned: N task(s) with owner=team still open
   - Velocity: N tasks completed this iteration so far
   ```

   Omit any indicator that has nothing to report. If everything is healthy, say: `All clear — no blockers, no overdue items.`

8. If the iteration log does not exist, add a nudge at the bottom:
   ```
   💡 No iteration log for YYYY-WNN. Run /iteration-open to start tracking team goals.
   ```

9. If viewing a past (closed) iteration, show the Summary section from the iteration log instead of the kanban (since tasks may have moved to different iterations since then). Present it under `### Retrospective`.
