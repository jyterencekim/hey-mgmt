Promote personal ideas into canonical team artifacts in `content/`.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.

Usage: `/promote [optional idea filename, slug, or search term]`

1. Read `MEMBER` from `.env`. If not set, ask the user for their name.

2. Identify the source idea(s):
   - If `$ARGUMENTS` is provided, find matching ideas in `workspace/$MEMBER/ideas/` (match on filename, slug, or title)
   - If no arguments, list active ideas and ask which to promote:
     ```
     Active ideas:
     1. [concern] Liquidity risk on withdrawal surge (2026-04-03)
     2. [idea] Financial audit trail as taste (2026-04-06)
     3. [position] Roadmap philosophy (2026-04-06)
     Select one or more (comma-separated numbers):
     ```

3. Read the selected idea(s) fully. If multiple ideas are selected, synthesize them into a single artifact.

4. Determine the target location based on content:
   - **`content/tasks/`** — actionable work that should enter the shared backlog
     - Filename: `task_slug.md` or in a year/month subdir `content/tasks/YYYY/MM/task_slug.md`
     - Type: `task`
   - **`content/notes/`** — findings, reports, knowledge, analysis
     - Filename: `note_slug.md` or in a year/month subdir `content/notes/YYYY/MM/note_slug.md`
     - Type: `note`
   - **`content/playbooks/`** — reusable how-to's, runbooks, procedures
     - Filename: `playbook_slug.md` or in a subdir like `content/playbooks/operations/`
     - Type: `playbook`
   - **`content/decisions/`** — team commitments, rationale, ADRs
     - Filename: `decision_slug.md` or in a subdir like `content/decisions/operations/`
     - Type: `decision`

   If ambiguous, ask:
   ```
   This could be a [task/note/playbook/decision]. Which fits best?
   ```

5. Draft the artifact with proper frontmatter matching the target type's conventions:
   - Check existing files in the target directory for frontmatter patterns
   - Match the template for the chosen type (`docs/TEMPLATES.md`) and include type-specific fields such as `project`, `priority`, `iteration`, or `definition_of_done` when needed
   - Include `id`, `type`, `title`, `created_at`, `updated_at`, `owner`, `tags`, `relations`, and `sources` where appropriate
   - Add a relation back to the source idea with an allowed relation type: `{ type: links_to, target: [idea id] }`

6. Present the draft to the member for review:
   ```
   Draft [type]: "[title]"
   Target: content/[subdir]/[filename]

   [Show the full draft]

   Looks good? (y/edit/cancel)
   ```

7. On confirmation:
   - Write the artifact to `content/`
   - Update the source idea's status to `done` and add a note:
     ```
     > **Promoted 2026-04-06**: Promoted to `content/[path]`
     ```
   - Confirm:
     ```
     Promoted: "[title]" → content/[path]
     Source idea marked done.
     ```

8. On edit: incorporate feedback and re-present.
9. On cancel: abort, leave everything unchanged.

Rules:
- Always present the draft before writing — promotion is a deliberate act
- Follow existing frontmatter conventions in the target directory
- Use tags from the allowed vocabulary (check `content/vocab/` if available)
- A single promotion pass creates one artifact; multiple ideas can be synthesized into one
- The source idea is marked `done`, not deleted — it preserves the origin story
