Run the weekly iteration sync ceremony. This guides the team through plan review, blockers, and captures outputs.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


## Close the Previous Iteration

0. **Close the outgoing iteration log** (if one exists):

   Determine the current iteration (`YYYY-WNN`) and look for an active iteration log:
   ```
   content/notes/**/note_iteration-log-*.md
   ```
   If an active (not `done`) iteration log exists for the current or previous week, run the `/iteration-close` workflow on it before proceeding. This generates the retrospective summary and carry-forward items that feed into the sync discussion.

   If no iteration log exists, skip this step.

## Before the Sync

1. Rebuild indexes:
   ```bash
   ./hey index build
   ./hey db build
   ```

2. Gather data:
   ```bash
   # Active roadmaps/plans
   ./hey search "" --status plan

   # Validation check
   ./hey validate

   # Blocked tasks
   ./hey search "" --type task --status blocked

   # Recently completed
   ./hey search "" --type task --status done
   ```

3. Present a **Sync Prep Report**:
   - **Active Plans**: list each plan with its progress log summary
   - **Blocked Tasks**: list with blockers and suggested actions
   - **Completed Since Last Sync**: list of done tasks
   - **Validation Errors**: any structural issues to address

## During the Sync

4. For each active plan, read its artifact file and summarize:
   - Current phase and progress
   - Whether it's on track or slipping
   - Child tasks status

5. Ask the team about:
   - Unblocking actions for blocked tasks
   - Any new decisions to capture
   - Timeline adjustments needed

## After the Sync

6. Create a meeting artifact (replace placeholders with actual values):
   ```bash
   ./hey new --type meeting --title "Weekly sync YYYY-WNN"
   ```

   Then edit the generated file to add `attendees`, `start_at`, and `end_at` fields in the frontmatter.

7. Edit the meeting artifact to capture:
   - Discussion points
   - Decisions made (link to `decision_` artifacts if created)
   - Action items with owners

8. If any decisions were made during sync, offer to create `decision_` artifacts for each one using `/project:new-decision`.

9. Run validation to confirm everything is clean:
   ```bash
   ./hey validate
   ```

## Open the Next Iteration

10. **Open the next iteration log**:

    Run the `/iteration-open` workflow to scaffold the iteration log for the upcoming week. This uses the carry-forward items from the just-closed iteration and the planned tasks discussed during sync to set the new iteration's goals.

    If the next iteration log already exists, skip this step.

## Commit and Push

11. Commit and push all new/changed artifacts:
    - Stage only the relevant files per commit (no `git add -A`)
    - Use imperative mood commit messages (e.g., "Add weekly sync meeting note YYYY-WNN")
    - Push to remote after all commits:

      ```bash
      git push origin main
      ```
