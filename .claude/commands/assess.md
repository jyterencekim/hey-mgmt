Team progress assessment. Show what happened, what's current, and what's ahead.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


Accepts an optional argument for time period: `daily`, `weekly` (default), `monthly`, or `quarterly`.

Run these steps in order:

1. Rebuild indexes and database:
   ```bash
   ./hey index build
   ./hey db build
   ```

2. Run the assessment for the requested period (default: weekly):
   ```bash
   ./hey assess --period $PERIOD --json
   ```

3. Present a **Team Assessment** report in this format:

   **Progress (past N days)**
   - Tasks completed: count, listed with owners
   - New artifacts created: count by type
   - Decisions made: list with titles

   **Current State**
   - Active work by team member (table: member, task count, top priority)
   - Blocked items with reasons
   - Overdue items flagged with how many days overdue

   **What's Ahead**
   - Upcoming deadlines in next period
   - Work distribution by project (table: project, active count)
   - Unassigned tasks that need owners

   **Iteration Log** (if available)
   - Current iteration: YYYY-WNN
   - Goals: list from iteration log `## Goals` section with completion status
   - Entries this iteration: count by category ([milestone], [blocker], [decision], [coordination])
   - If a closed iteration log exists for the assessed period, include velocity from its `## Summary`

   **Health**
   - Validation status

   Rules:
   - Omit any section that has nothing to report
   - Use tables for structured data (members, projects)
   - Flag risks: overdue tasks, blocked items without resolution, unbalanced workload
   - Keep it scannable — headers, bullets, tables. No long paragraphs.
   - For quarterly reports, add a trend narrative: are things improving or degrading?
