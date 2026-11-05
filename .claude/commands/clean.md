Execute the weekly hygiene checklist. Identify issues and help fix them.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


1. Rebuild indexes:
   ```bash
   ./hey index build
   ./hey db build
   ```

2. Run the full checklist:

   **a) Ready tasks without owners**:
   ```bash
   ./hey db query "SELECT id, title, area FROM items WHERE type='task' AND status='ready' AND (owner IS NULL OR owner = '') ORDER BY area;"
   ```
   → List them and ask who should own each.

   **b) Blocked tasks without `blocked_by` relations**:
   ```bash
   ./hey db query "SELECT id, title, owner FROM items WHERE type='task' AND status='blocked' ORDER BY updated_at;"
   ```
   → For each, check if it has a `blocked_by` relation in its frontmatter. Flag any that don't.

   **c) Validation errors**:
   ```bash
   ./hey validate
   ```
   → List all errors and offer to fix them.

   **d) Memory upload** (dry-run):
   Run `/upload-memory --dry-run` to check for new cross-repo memories worth sharing.
   Report any candidates found. User can run `/upload-memory` to apply.

   **e) Change-contract distillation** (see [`decision_adr-kb-wide-change-contracts`](../../content/decisions/decision_adr-kb-wide-change-contracts.md)):
   ```bash
   ./hey db query "SELECT id, path, type FROM items WHERE type IN ('decision','playbook','note') AND status='active' AND updated_at >= date('now','-14 days')"
   ```
   → Read each listed artifact and look for obligation-bearing content that is NOT yet encoded as a contract: "Required Follow-Ups" / "Verification" sections, decision Consequences that mandate follow-up work in other repos, playbook checklists tied to a change surface. For each candidate, propose `ChangeImpact` tag + `x_change_contract` frontmatter (triggers from the repos/paths/areas the artifact names; obligations from its own checklist; leave `terms`/`intents` empty unless a precision phrase is clearly needed) as a diff for the user to review. Also flag artifacts where validation warns `x_change_contract present but tag 'ChangeImpact' missing`, and overlapping contracts covering the same change surface (propose merging). Never apply contract changes without explicit approval.

   **f) Repo registry drift** (see [`decision_adr-kg-v2-operating-decisions`](../../content/decisions/decision_adr-kg-v2-operating-decisions.md) D6):
   ```bash
   comm -3 <(gh repo list hey-mgmt-io --limit 200 --json name --jq '.[].name' | sort) <(grep -E '^  - name:' content/vocab/repos.yml | sed 's/.*name: //' | sort)
   ```
   → Left column = org repos missing from `content/vocab/repos.yml` (add a row with `org`, `status`, description); right column = registry rows with no org repo (expected for `kaiachain`/`onrampto`/local entries — flag only `hey-mgmt-io` rows, which may be renamed or deleted). Also flag registry rows whose GitHub repo is archived (`gh repo view hey-mgmt-io/<name> --json isArchived`) but whose `status` is not `archive`.

   **Note on `done` tasks.** Do NOT propose flipping `done` tasks to
   `archived` based on age. `done` and `archived` are distinct lifecycle
   outcomes (see [`decision_adr-task-done-vs-archived-lif`](../../content/decisions/decision_adr-task-done-vs-archived-lif.md)):
   `done` means DoDs were met; `archived` means closed without completion.
   No tool treats them differently for terminal tasks, so age-based
   relabeling is a no-op that conflates outcomes.

3. Present a **Hygiene Report**:
   - Unowned ready tasks: count and list
   - Blocked tasks missing relations: count and list
   - Validation errors: count and details

4. Ask the user which issues to fix, then apply the changes:
   - Add missing owners
   - Add missing `blocked_by` relations
   - Fix validation errors

5. Re-run validation after fixes:
   ```bash
   ./hey validate
   ```

6. If any files were changed, commit and push each logical fix separately:
   - Use imperative mood commit messages matching the repo style (e.g., "Archive stale done tasks", "Fix validation errors in task frontmatter")
   - Stage only the relevant files per commit (no `git add -A`)
   - Push to remote after all commits:

     ```bash
     git push origin main
     ```
