Create a task with guided Definition of Done coaching.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.

Usage: `/task [optional description]` or `/task --full [description]`

## Modes

- **Quick capture** (default): propose title + DoD from context, single confirmation
- **Full guided** (`--full`): step-by-step interview for all fields

## Quick Capture (default)

1. Read `MEMBER` from `.env`. If not set, ask the user for their name.

2. Determine the task context:
   - If `$ARGUMENTS` is provided (and not just `--full`), use as starting context
   - If invoked from passive task detection, use conversation context
   - If no context at all, ask: "What task do you need to create?"

3. Before proposing a priority, **read the rationale**:
   [`content/decisions/decision_adr-replace-p0-p3-priority-wit.md`](../../content/decisions/decision_adr-replace-p0-p3-priority-wit.md).
   Priority is an Eisenhower quadrant (`do` / `plan` / `routine` / `drop`),
   not an arbitrary urgency score. Default proposal is `plan` (important,
   not immediately urgent). Only propose `do` when the task visibly blocks
   revenue, users, or production today. Only propose `drop` when the task
   is explicitly low-value. If neither importance nor urgency is clear
   from context, propose `plan` **and flag the ambiguity** to the user
   in the block so they can override.

4. From the context, propose a **title** and **2-4 DoD items** in a single confirmation block:

   ```
   Task: "[proposed title]"
   Owner: [MEMBER] | Priority: plan    # do | plan | routine | drop — see ADR
   DoD:
     - [proposed criterion 1]
     - [proposed criterion 2]
     - [proposed criterion 3]

   Create? (y / edit / cancel)
   ```

   DoD coaching — each item must be a verifiable completion criterion:
   - Good: "Bridge monitoring alerts fire within 5 minutes of staleness"
   - Good: "All existing tests pass after migration"
   - Good: "Deployed to QA and manually verified happy path"
   - Bad: "Done" (not verifiable — reject)
   - Bad: "Works correctly" (too vague — reject)
   - Bad: "TODO: define later" (placeholder — reject)

4. On "y": proceed to creation (step 7 below)
5. On "edit": incorporate the member's feedback, re-present the block
6. On "cancel": abort

## Full Guided (`--full`)

1. Read `MEMBER` from `.env`. If not set, ask the user for their name.

2. Determine context from `$ARGUMENTS` (strip `--full` flag) or conversation. If no context, ask: "What task do you need to create?"

3. Propose a **title** (concise, actionable). Member confirms or edits.

4. Draft **context/background** from conversation — the "why does this task exist?" paragraph. This goes in the markdown body below frontmatter.

5. Guide **Definition of Done**:
   - Propose 2-4 items based on context
   - Ask member to confirm, edit, or add more
   - Apply the same coaching rules as quick capture (no placeholders, must be verifiable)
   - Do not accept empty DoD

6. Ask for optional fields:
   - **Due date**: "Does this have a deadline? (YYYY-MM-DD or skip)"
   - **Priority**: "Priority? `do` (important + urgent) / `plan` (important + not urgent, default) / `routine` (not important + urgent) / `drop` (neither)". Before asking, the agent MUST have read [`content/decisions/decision_adr-replace-p0-p3-priority-wit.md`](../../content/decisions/decision_adr-replace-p0-p3-priority-wit.md) so the proposed default is grounded in the Eisenhower rationale, not a guess. If the task's importance or urgency is genuinely unclear, ask the user the classification question directly rather than picking for them.
   - **Owner**: "Owner? (default: [MEMBER])"

7. Present full summary for confirmation, then proceed to creation (step 7 below)

## Creation (shared by both modes)

7. Build and run the creation command:

   ```bash
   ./hey new --type task \
     --title "[title]" \
     --owner [owner] \
     --priority [priority] \
     --field "definition_of_done=[criterion 1, criterion 2, criterion 3]" \
     [--due YYYY-MM-DD]
   ```

   **Important — YAML escaping rules for `--field`:**
   - Pass all DoD items as a **single YAML array** in one `--field` value
   - Do NOT use multiple `--field "definition_of_done=X"` calls — they overwrite each other
   - Items with commas: wrap in double quotes inside the array: `[item one, "item with, comma"]`
   - Items with colons: same quoting: `["Status: all tests pass", simple item]`
   - Keep items concise to minimize escaping needs

   **Product initiative tasks** ([`decision_adr-product-initiative-kickoff`](../../content/decisions/decision_adr-product-initiative-kickoff.md) D3): when the task belongs to an initiative with `x_initiative_kind: product`, it MUST be a component-level deliverable, not a sub-step (sub-steps go into an existing task's DoD). Ask which component from the initiative's `x_components` it builds and its start and target dates, then add:

   ```bash
     --field "relations=[{type: child_of, target: initiative_<id>}]" \
     --field "x_component=<component>" \
     --field "x_start_date=YYYY-MM-DD" \
     --field "x_target_date=YYYY-MM-DD"
   ```

   `x_target_date` is the planned finish; use `--due` only for an external commitment. If the initiative is already kicked off (`x_kickoff_date` set), tell the member the task will show as a scope change in the weekly.

8. Parse the JSON output for the created file path.

9. Edit the created file to add context/background in the markdown body (below the `---` frontmatter closer). Write a brief `## Objective` section summarizing the task purpose.

10. If the task was created from passive detection (conversation context), add `x_source: conversation` to the frontmatter for provenance tracking.

11. Run `./hey validate` on the created file path:
    - If validation **passes**: confirm with the line below
    - If validation **fails**: delete the created file, report the validation error to the member, and ask if they want to retry with corrections

12. Confirm with a single line:
    ```
    Created task: "[title]" -> [path]
    ```
