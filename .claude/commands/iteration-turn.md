Turn the iteration: close the previous, open the new — unified ceremony.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


This is a **team-level** command. It combines `/iteration-close` and `/iteration-open` into a single unified ceremony so that carry-forward items flow directly from one iteration to the next without manual transfer.

Principles:
- **Unified ceremony**: Close + open is one flow. Carry-forward never gets lost between separate commands.
- **Backward compatible**: `/iteration-close` and `/iteration-open` still work standalone for edge cases.
- **Date-aware**: Close logic uses the target iteration's date range, not today's date.

Run these steps in order:

1. Determine the current iteration (`YYYY-WNN`) from today's date using ISO 8601 week numbering.

2. Check if the current week's iteration log already exists:
   ```
   content/notes/**/note_iteration-log-YYYY-wNN.md
   ```
   Note whether it exists — this determines the flow in step 5.

3. Find **all** iteration logs with `status: active` that are from **previous** weeks (i.e., `x_iteration` < current `YYYY-WNN`). Sort by `x_iteration` chronologically (oldest first).

   If no unclosed previous iterations exist **and** the current week's log already exists, tell the user:
   ```
   Iteration YYYY-WNN is already open and no previous iterations need closing. Nothing to do.
   ```
   Stop here.

4. **Close each unclosed previous iteration** (oldest first). For each one:

   a) Read the iteration log fully. Parse `## Goals` and `## Entries`.

   b) Gather completion data **scoped to that iteration's date range**:
      - Compute the ISO week's Monday and Sunday dates from `x_iteration` (e.g., `2026-W11` → `2026-03-09` to `2026-03-15`).
      - Tasks completed in that period:
        ```bash
        ./hey task list --iteration YYYY-WNN --status done
        ```
      - Tasks still open (ready/blocked/doing) for that iteration:
        ```bash
        ./hey task list --iteration YYYY-WNN --status ready
        ./hey task list --iteration YYYY-WNN --status blocked
        ./hey task list --iteration YYYY-WNN --status doing
        ```
        If `--iteration` filtering is not available, read task files and match `iteration:` frontmatter manually.
      - Decisions made during that iteration:
        ```bash
        git log --oneline --since="YYYY-MM-DD" --until="YYYY-MM-DD" --name-only -- 'content/decisions/'
        ```
        Use absolute dates derived from the iteration's week span.

   c) Populate `## Carry-Forward`:
      - Unresolved `[blocker]` entries from `## Entries`
      - Goals from `## Goals` that were **not** achieved (cross-reference with completed tasks)
      - Ready/doing/blocked tasks from that iteration that did not reach `done`

      ```markdown
      ## Carry-Forward
      - [ ] [Goal or blocker description] (task_xxx) — reason it carried over
      ```

   d) Populate `## Summary`:
      ```markdown
      ## Summary

      ### Delivered
      - [Milestone or goal achieved] (task_xxx)

      ### Velocity
      - Goals: X/Y achieved
      - Tasks completed: N

      ### Key Observations
      - [1–3 team-level insights]

      ### Carried Forward
      - N items → next iteration
      ```

   e) Update frontmatter: set `status: done`, update `updated_at` to today.

   f) Run validation:
      ```bash
      ./hey validate
      ```

   g) Commit:
      ```bash
      git add content/notes/*/note_iteration-log-*.md
      git commit -m "Close iteration log for YYYY-WNN"
      ```

5. **Carry task metadata forward mechanically** for all iterations closed in step 4:

   Carry-forward is **automatic** — no per-batch approval (decision D3, ratified 2026-08-14 in `note_automated-initiative-task-hygiene-strategy`). It rewrites `iteration:` on every carried task, increments `x_slip_count` (never hand-written), and updates `updated_at`. Without it, tasks keep stale `iteration` tags and `./hey task list --iteration` returns incomplete results.

   a) Preview, then apply, for each closed iteration (oldest first):
      ```bash
      ./hey iteration carry --to NEW-YYYY-WNN --from CLOSED-YYYY-WNN --dry-run
      ./hey iteration carry --to NEW-YYYY-WNN --from CLOSED-YYYY-WNN
      ```
      The auto-commit hooks pick up the task-file edits; no manual `git add` of `content/tasks/` is needed.

   b) **Surface the FORCED DECISIONS section verbatim.** Any task at `x_slip_count >= 3` has been carried, but the ceremony must not close until the member picks one action per task:
      - **re-scope** — split or shrink it so it can land this iteration
      - **re-commit with a reason** — state why this time is different (log it in the iteration note)
      - **archive** — set `status: archived` (closed without completion)

   c) Run `./hey hygiene check` and present the batch (stale doing/ready tasks, resolved blockers, wish-dates, merged-PR close candidates) for one batch-level decision. The check is read-only; apply only what the member approves, in one commit.

   d) **Offer to distribute the new week's commitments across weekdays** (optional, per the strategy note). For tasks committed to the new iteration (target ≤ ~10 per member, per D4 — ≈ 2/day), the member may pick which weekday each lands on; set `x_planned_date: YYYY-MM-DD` (a date inside the new iteration's Monday–Sunday). A missed planned date has no overdue semantics — only `due_date` alarms; `x_planned_date` is a schedule, cheap to move.

6. **Open or merge into the current week's iteration**:

   **If the current week's log does NOT exist**: Run the `/iteration-open` workflow for the current `YYYY-WNN`. It will read carry-forward from the most recently closed iteration.

   **If the current week's log already exists**: Merge carry-forward items into the existing log:
   - Read the carry-forward items from the most recently closed iteration (step 4)
   - Read the existing iteration log's `## Goals` section
   - Append any carry-forward items that are not already present in goals (deduplicate by task ID)
   - Mark appended items with `(carried from WNN)` annotation
   - Run validation and commit:
     ```bash
     ./hey validate
     git add content/notes/*/note_iteration-log-*.md
     git commit -m "Merge carry-forward from YYYY-WNN into YYYY-WNN"
     ```

7. Present a combined summary:

   ```
   Iteration turn complete.
   Closed: YYYY-WNN — X/Y goals delivered, N tasks completed, M items carried forward
   Carried: N tasks (slips incremented), F forced decisions resolved, H hygiene actions applied
   Opened/Updated: YYYY-WNN — G goals (C carried forward)
   ```

   If partial failure occurred (close succeeded but open/merge failed), report:
   ```
   Previous iteration YYYY-WNN closed successfully.
   Failed to open/merge current iteration — run /iteration-open or merge carry-forward manually.
   ```
