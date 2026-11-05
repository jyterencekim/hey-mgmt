Run validation and help fix any issues found.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


1. Run validation:
   ```bash
   ./hey validate
   ```

2. If there are errors, categorize them:
   - **Missing required fields**: `id`, `type`, `created_at`, `updated_at`
   - **Invalid ID format**: slug doesn't match expected pattern
   - **Invalid vocabulary**: owner/project/tag/entity not in `content/vocab/`
   - **Broken relations**: `target` points to non-existent artifact
   - **Missing sources**: decisions without minimum 2 sources
   - **Date format**: non-ISO8601 dates

3. For each error, read the affected artifact file and determine the fix.

4. Present a fix plan:
   ```
   ## Validation Report

   ### Errors (N)
   1. [file] Error description → Proposed fix
   2. [file] Error description → Proposed fix

   ### Warnings (N)
   1. [file] Warning description → Suggestion
   ```

5. Ask the user which fixes to apply.

6. Apply the approved fixes by editing the artifact frontmatter.

7. Re-run validation to confirm all issues are resolved:
   ```bash
   ./hey validate
   ```

8. If new errors appeared (e.g., fixing one revealed another), repeat the fix cycle.

9. If any files were changed, commit and push each logical fix separately:
    - Use imperative mood commit messages matching the repo style (e.g., "Fix validation errors in decision frontmatter")
    - Stage only the relevant files per commit (no `git add -A`)
    - Push to remote after all commits:

      ```bash
      git push origin main
      ```
