Review all active roadmaps/plans and their progress.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


1. Rebuild indexes:
   ```bash
   ./hey index build
   ./hey db build
   ```

2. Find all plan artifacts:
   ```bash
   ./hey search "" --status plan
   ```

3. For each plan artifact found:
   a. Read the full artifact file
   b. Identify child tasks from `relations` (look for `blocks`, `implements` relations)
   c. Check the status of each child task:
      ```bash
      ./hey db query "SELECT id, title, status, owner, priority FROM items WHERE id IN ('task_child1', 'task_child2', ...);"
      ```
   d. Read the Progress Log section from the plan body

4. Present a **Roadmap Dashboard**:

   ```
   ## Roadmap Dashboard — YYYY-MM-DD

   ### Plan: <title> (owner: <owner>, project: <project>)
   **Progress**: X of Y child tasks done
   **Status**: On Track / At Risk / Slipping

   | Child Task | Status | Owner | Priority* |
   |------------|--------|-------|-----------|
   | task_id    | active | name  | plan      |
   | task_id    | done   | name  | do        |

   *Priority is an Eisenhower quadrant (`do` / `plan` / `routine` / `drop`). See [`decision_adr-replace-p0-p3-priority-wit`](../../content/decisions/decision_adr-replace-p0-p3-priority-wit.md) for the rationale before displaying or interpreting these labels.

   **Latest Progress**: <last entry from progress log>
   **Blockers**: <any blocked child tasks and what they're waiting on>

   ---
   (repeat for each plan)
   ```

5. Highlight risks:
   - Plans with no progress log updates in the last 7 days
   - Plans with blocked child tasks
   - Plans with overdue child tasks (past `due_date`)
   - Plans where > 50% of child tasks are not yet started

6. Offer actions:
   - Update a plan's progress log
   - Unblock a task
   - Reassign tasks
   - Create new child tasks for a plan
   - Archive completed plans

7. If any artifacts were changed, commit and push:
   - Stage only the relevant files per commit (no `git add -A`)
   - Use imperative mood commit messages matching the repo style
   - Push to remote after all commits:

     ```bash
     git push origin main
     ```
