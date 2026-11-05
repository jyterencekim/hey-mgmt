Create a well-structured Architecture Decision Record (ADR) with guided input.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


Decisions require at minimum 2 sources (enforced by the validator). This command ensures quality.

1. Ask the user for:
   - **Title**: What was decided? (will be prefixed with "ADR: ")
   - **Project**: Which project? (must be from `content/vocab/projects.yml`)
   - **Owner(s)**: Who owns this decision? (must be from `content/vocab/members.yml`)

2. Compile context to inform the decision:
   ```bash
   ./hey context compile --mode decide --intent "<user's decision topic>" --project <project>
   ```

3. Present the compiled context to the user and ask for:
   - **Context**: What problem or question triggered this decision?
   - **Decision**: What did we decide and why?
   - **Consequences**: Trade-offs, risks, follow-up work
   - **Alternatives Considered**: What options were rejected and why?
   - **Sources**: At least 2 references (URLs, docs, artifact IDs). Suggest relevant sources from the context pack.

4. Create the decision artifact:
   ```bash
   ./hey new --type decision --title "ADR: <title>" --project <project>
   ```

5. Edit the generated file to populate:
   - All frontmatter fields (`owners`, `decision_status: accepted`, `sources`, `tags`, `relations`)
   - Body sections: Context, Decision, Consequences, Alternatives Considered

6. Check for related tasks that should link to this decision:
   ```bash
   ./hey search "<topic keywords>" --type task
   ```
   → Offer to add `implements` or `informed_by` relations to related tasks.

7. Validate the new artifact:
   ```bash
   ./hey validate
   ```

8. Commit and push the new decision artifact:
   - Stage only the new/changed files (no `git add -A`)
   - Use imperative mood commit message (e.g., "Add ADR: <title>")
   - Push to remote:

     ```bash
     git push origin main
     ```

9. Confirm the decision record is complete and well-structured.
