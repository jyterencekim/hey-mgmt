Search artifacts using natural language. Translates intent into the right query and presents results with context.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


Usage: `/project:search <your question or topic>`

1. Parse the user's search intent from `$ARGUMENTS`. Examples:
   - "oracle adapter tasks" → search tasks about oracle adapter
   - "what decisions were made about risk engine" → search decisions about risk engine
   - "blocked items for charlie" → search blocked tasks owned by charlie
   - "everything about Core" → search all types for Core project

2. Ensure the index is fresh:
   ```bash
   ./hey index build
   ```

3. Translate intent to appropriate search commands. Use multiple searches if needed:
   ```bash
   # Text search
   ./hey search "<keywords>" --type <type> --status <status> --owner <owner> --project <project>

   # SQL for complex queries
   ./hey db build
   ./hey db query "<sql>"
   ```

4. Read the top matching artifacts to provide context (not just IDs and titles).

5. Present results grouped by type:
   ```
   ## Search Results: "<query>"

   ### Tasks (N found)
   - [task_id] Title — status, owner, project, priority

   ### Decisions (N found)
   - [decision_id] Title — decision_status, project

   ### Notes (N found)
   - [note_id] Title — owner, project
   ```

6. For each result, include a brief summary from the artifact body (first 1-2 sentences of the relevant section).

7. If the search seems decision-oriented, offer to compile a context pack:
   ```bash
   ./hey context compile --mode decide --intent "<topic>" --project <project>
   ```
