Generate a standup summary for the current team member.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


1. Read the member identity from `.env` (the `MEMBER` variable). If not set, ask the user for their name.

2. Rebuild the index and database to ensure fresh data:
   ```bash
   ./hey index build
   ./hey db build
   ```

3. Gather data by running these commands:
   ```bash
   # Done since last standup
   ./hey search "" --type task --status done --owner $MEMBER

   # Currently ready
   ./hey search "" --type task --status ready --owner $MEMBER

   # Blocked items
   ./hey search "" --type task --status blocked --owner $MEMBER
   ```

4. Read any recently updated artifacts (check `updated_at` in the last 1-2 days) to understand progress context.

5. Present a formatted standup note:

   ```
   ## Standup — $MEMBER — YYYY-MM-DD

   ### Done
   - [task_id] Brief description of what was completed

   ### Doing
   - [task_id] Brief description + current progress

   ### Blocked
   - [task_id] Brief description — blocked by [dependency]
   ```

6. Offer to save the standup as a workspace note:
   ```bash
   ./hey new --workspace $MEMBER --type note --title "Standup YYYY-MM-DD"
   ```

7. If a standup note was created, commit and push:
   - Stage only the new file (no `git add -A`)
   - Commit with imperative mood (e.g., "Add standup note for MEMBER YYYY-MM-DD")
   - Push to remote:

     ```bash
     git push origin main
     ```
