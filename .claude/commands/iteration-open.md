Open a new iteration log. Creates a `note` artifact that serves as the team-level record for the iteration.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


This is a **team-level** command. The iteration log is upstream of member-level ceremonies (`/morning`, `/night`, `/snap`). Those read from it; this creates it.

Run these steps in order:

1. Determine the current iteration:
   - Use ISO week format: `YYYY-WNN` (e.g., `2026-W10`)
   - Calculate from today's date using ISO 8601 week numbering

2. Check if an iteration log already exists for this week:
   ```bash
   ./hey search "iteration-log" --type note
   ```
   Also glob for the file directly:
   ```
   content/notes/**/note_iteration-log-*.md
   ```
   If a log matching the current `YYYY-WNN` already exists, tell the user and stop. Do not overwrite.

   **Nudge**: If no log exists for the current week, also check for any previous iteration logs with `status: active` (unclosed). If found, warn the user:

   > Previous iteration **YYYY-WNN** is still open. Consider running `/iteration-turn` to close it first and carry forward items. Proceed with open-only?

   If the user wants to proceed with open-only, continue. If they want to switch to `/iteration-turn`, stop and let them invoke it.

3. Check if the previous iteration's log exists and has a `## Carry-Forward` section. If so, read the carry-forward items to include in the new log's goals.

4. Gather planned work for this iteration:
   ```bash
   ./hey search "" --type task --status ready
   ./hey search "" --type task --status blocked
   ./hey search "" --type task --status doing
   ```
   Filter to tasks whose `iteration` field matches the current `YYYY-WNN`. Group by owner.

5. Create the iteration log artifact:
   ```bash
   ./hey new --type note --title "Iteration Log YYYY-WNN" --owner team --project Core --field "x_iteration=YYYY-WNN" --field "tags=[IterationLog]"
   ```

6. Edit the generated file to replace the default body with this structure:

   ```markdown
   ## Goals
   <!-- Team-level goals for this iteration. Linked to task IDs where applicable. -->
   - [ ] [Goal from planned tasks or carry-forward] (task_xxx)
   - [ ] [Goal from planned tasks or carry-forward] (task_xxx)

   ## Entries
   <!-- Appended by /iteration-add. Each entry is date-stamped and categorized. -->
   <!-- Categories: [milestone], [blocker], [decision], [coordination] -->

   ## Carry-Forward
   <!-- Populated by /iteration-close. Items that did not complete this iteration. -->

   ## Summary
   <!-- Populated by /iteration-close. Synthesized retrospective. -->
   ```

   Fill in the `## Goals` section with:
   - Carry-forward items from the previous iteration (if any)
   - Key objectives inferred from the planned tasks for this iteration (group by project/theme, not by individual task)
   - Keep goals to 3–6 items — team-level outcomes, not individual task restating

7. Run validation:
   ```bash
   ./hey validate
   ```

8. Commit the new artifact:
   ```bash
   git add content/notes/*/note_iteration-log-*.md
   git commit -m "Open iteration log for YYYY-WNN"
   ```

9. Confirm to the user:
   ```
   Iteration log opened: note_iteration-log-YYYY-wNN
   Goals: [count] items ([count] carried forward)
   Planned tasks: [count] across [count] members
   ```
