Migrate team-shareable memories from local Claude project memories to the team repo.

Scans `~/.claude/projects/` for memories accumulated while working in other hey-mgmt repos,
filters for team-relevant content, and writes them to `workspace/$MEMBER/memory/`.

## Arguments

- `--dry-run`: Report what would be migrated without writing files. This is the **default when invoked from another command** (e.g., `/night`, `/clean`).
- No flag or any other argument: perform the actual migration.

## Steps

1. **Identify member**: Read `MEMBER` from `.env`. If not set, ask.

2. **Discover local memories**:
   - Glob all dirs matching `~/.claude/projects/-*-Documents-hey-mgmt-*/memory/`
   - **Skip `hey-mgmt`** — its local Claude memories redirect to the team memory store (circular).
   - For each remaining dir:
     - Extract the repo name from the directory suffix (e.g., `-Documents-hey-mgmt-core-usdt-miniapp` → `core-usdt-miniapp`)
     - Ignore worktree variant dirs (contain `--claude-worktrees-`) — they duplicate the parent repo's memories and dedup handles them anyway
     - Cross-reference `workspace/$MEMBER/repos.yml` for validation. If a repo is not listed, warn but **still process** — use the extracted dir name as `source_repo`.
   - List all `.md` files in each memory dir
   - Read `MEMORY.md` files **as content sources** (they often contain architecture summaries, key patterns, and rules that are the richest team-shareable material). Do NOT skip them.
   - Read individual memory files (frontmatter: `name`, `description`, `type`)

3. **Read existing team memories**:
   - Read `workspace/$MEMBER/memory/MEMORY.md` (the team index)
   - Read all `.md` files in `workspace/$MEMBER/memory/` to know what's already present

4. **Triage each candidate** (local memory file or MEMORY.md section):

   For each piece of content, decide one of:

   - **Skip** if:
     - A team memory with the same `name` already exists AND has equivalent content
     - Content is code-derivable (patterns visible from reading the code)
     - Content is ephemeral (in-progress feature details, debugging sessions)
     - Content is local-only (file paths, IDE config, tooling preferences specific to one machine)

   - **Update** if:
     - A team memory with the same `name` exists but the local version has newer or richer information
     - Merge intelligently: preserve existing team content, incorporate new details from the local version

   - **Create** if:
     - No existing team memory matches by `name`
     - Content passes the shareability filter (step 5)

5. **Shareability filter**:

   ✅ Team-shareable:
   - QA/deploy workflows, environment endpoints, branch models
   - Architecture summaries, API shapes, integration patterns
   - Critical rules (e.g., "never hardcode contract addresses")
   - Incident learnings, post-mortems
   - Auth patterns, config conventions, DI patterns

   ❌ Not team-shareable:
   - Local tooling preferences, IDE config
   - In-progress feature details (ephemeral)
   - Code patterns derivable from reading the current code
   - Debugging session notes
   - Repo-specific coding conventions that only matter inside that repo (e.g., "no 'use client' in Vite SPA")

6. **Execute based on mode**:

   **Dry-run mode** (default when sub-invoked, or when `--dry-run` is in arguments):
   - Report what would be migrated/updated/skipped in a summary table
   - Do NOT write any files
   - Suggest: "Run `/upload-memory` to apply these changes."

   **Normal mode** (explicit `/upload-memory` with no `--dry-run`):
   - Write each new/updated memory file to `workspace/$MEMBER/memory/`
   - Use descriptive filenames: `{type}_{topic}.md` (e.g., `reference_qa_environments.md`)
   - Include `source_repo` in frontmatter for attribution:
     ```yaml
     ---
     name: QA Environment Endpoints
     description: QA backend URLs; QA is effective production
     type: reference
     source_repo: core-usdt-miniapp
     ---
     ```
   - Update `workspace/$MEMBER/memory/MEMORY.md`:
     - Add entries under `## Cross-Repo Knowledge` section
     - Follow existing format: `- **[Title]**: Description. See [filename.md](filename.md).`
   - Existing hooks (content-edit-post.sh) auto-commit and push writes to `workspace/` paths. No manual commit needed.

7. **Report**:

   Print a summary:
   ```
   ## Memory Upload Summary

   | Action  | Repo                         | Memory                    | Reason           |
   |---------|------------------------------|---------------------------|------------------|
   | Created | core-usdt-miniapp            | QA Deploy Workflow        | New, team-useful |
   | Updated | core-usdt-miniapp-frontend   | Repo Architecture         | Richer info      |
   | Skipped | core-usdt-miniapp-frontend   | No Use Client Directive   | Repo-specific    |
   | Skipped | core-usdt-miniapp            | NestJS Module Pattern     | Code-derivable   |
   ```

   **Idempotency**: This command is safe to re-run. Dedup-by-name prevents duplicate writes. Running twice on the same inputs produces no changes on the second run.
