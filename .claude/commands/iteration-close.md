Close the current iteration log with a synthesized retrospective.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


This is a **team-level** command. It processes the raw entries accumulated during the iteration into actionable carry-forward items and a distilled summary.

Run these steps in order:

1. Determine the current iteration (`YYYY-WNN`) from today's date using ISO 8601 week numbering.

2. Find the current iteration log:
   ```
   content/notes/**/note_iteration-log-*.md
   ```
   Match against the current `YYYY-WNN`. If no iteration log exists, **stop with an error**:
   ```
   No iteration log found for YYYY-WNN. Nothing to close.
   ```

3. Read the iteration log fully. Parse:
   - `## Goals` — the iteration's stated objectives
   - `## Entries` — all entries logged during the iteration

4. Gather completion data:
   ```bash
   # Tasks completed this iteration
   ./hey search "" --type task --status done

   # Tasks still open for this iteration
   ./hey search "" --type task --status ready
   ./hey search "" --type task --status blocked
   ./hey search "" --type task --status doing

   # Decisions made this iteration
   git log --oneline --since="7 days ago" --name-only -- 'content/decisions/'
   ```
   Filter tasks by `iteration: YYYY-WNN` where applicable.

5. Populate the `## Carry-Forward` section with:
   - Unresolved `[blocker]` entries from `## Entries`
   - Goals from `## Goals` that were **not** achieved (cross-reference with completed tasks)
   - Ready/doing/blocked tasks that did not reach `done` this iteration

   Format each carry-forward item clearly:
   ```markdown
   ## Carry-Forward
   - [ ] [Goal or blocker description] (task_xxx) — reason it carried over
   - [ ] [Unresolved item] — context for next iteration
   ```

6. Populate the `## Summary` section with a synthesized retrospective:

   ```markdown
   ## Summary

   ### Delivered
   - [Milestone or goal achieved] (task_xxx)
   - [Another delivered item]

   ### Velocity
   - Goals: X/Y achieved
   - Tasks completed: N (list by project if >5)
   - Decisions made: N

   ### Key Observations
   - [1–3 team-level insights — patterns, process improvements, risks]
   - [Focus on reusable knowledge, not activity restating]

   ### Carried Forward
   - N items → next iteration (see ## Carry-Forward above)
   ```

   Rules:
   - The summary should **synthesize**, not restate. Don't just list entries — distill patterns.
   - Cite artifact IDs as evidence for every claim.
   - Keep it scannable: headers, bullets, one line per item.
   - Omit any subsection that has nothing to report.

7. Update frontmatter:
   - Set `status: done`
   - Update `updated_at` to today's date

8. Check if a weekly sync meeting artifact exists for this iteration:
   ```
   content/meetings/**/meeting_weekly-sync-*.md
   ```
   If found, add a `relations` entry linking the iteration log to the meeting:
   ```yaml
   relations:
     - type: links_to
       target: meeting_weekly-sync-YYYY-wNN
   ```

9. Run validation:
   ```bash
   ./hey validate
   ```

10. Commit:
    ```bash
    git add content/notes/*/note_iteration-log-*.md
    git commit -m "Close iteration log for YYYY-WNN"
    ```

11. Present the summary to the user and confirm:
    ```
    Iteration YYYY-WNN closed.
    Delivered: X/Y goals, N tasks completed
    Carried forward: M items → next iteration
    ```
