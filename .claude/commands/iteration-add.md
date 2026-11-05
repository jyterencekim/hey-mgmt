Append a team-level entry to the current iteration log.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


This is a **team-level** command. Use it to record milestones, blockers, decisions, and coordination notes that affect the whole team — not personal activity (use `/snap` for that).

Accepts an optional argument: the entry text. If not provided, ask the user what to log.

Run these steps in order:

1. Determine the current iteration (`YYYY-WNN`) from today's date using ISO 8601 week numbering.

2. Find the current iteration log:
   ```
   content/notes/**/note_iteration-log-*.md
   ```
   Match against the current `YYYY-WNN`. If no iteration log exists for this week, **stop with an error**:
   ```
   No iteration log found for YYYY-WNN. Run /iteration-open first.
   ```
   Do not auto-create the log — opening an iteration is an intentional team act.

3. Determine the entry category. If the user's text starts with a category prefix (`milestone:`, `blocker:`, `decision:`, `coordination:`), use it. Otherwise, infer the best category from the content:

   | Category | Use for |
   |----------|---------|
   | `[milestone]` | Task completions, deployments, shipped features, merged PRs |
   | `[blocker]` | Cross-team blockers, external dependencies, risks |
   | `[decision]` | Team decisions made (link to `decision_` artifact if one exists) |
   | `[coordination]` | Cross-member handoffs, sync points, external comms |

4. Append the entry to the `## Entries` section of the iteration log. Use this format:
   ```markdown
   - YYYY-MM-DD [category] Description (artifact_id if applicable)
   ```

   Example entries:
   ```markdown
   - 2026-03-10 [milestone] Bridge aggregator deployed to testnet (task_integrate-bridge-aggregator)
   - 2026-03-11 [blocker] Morpho deployment gated by KF hardfork — no ETA (task_kaia-morpho-integration)
   - 2026-03-11 [decision] Use Redstone oracle for Pendle markets (decision_oracle-choice)
   - 2026-03-12 [coordination] Synced with Partner Finance on EarnUSDT vault timeline
   ```

5. Update the `updated_at` field in the frontmatter to today's date.

6. Commit:
   ```bash
   git add content/notes/*/note_iteration-log-*.md
   git commit -m "Add iteration entry: [category] [short description]"
   ```

7. Confirm briefly:
   ```
   Added [category] entry to YYYY-WNN iteration log.
   ```
