Set up this repo for a new team member. Run this once after cloning.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Check if `.env` exists:
   ```bash
   cat .env 2>/dev/null
   ```

3. If `.env` is missing or `MEMBER` is still `your-name`, ask the user to pick their name from the team roster. Read the valid members:
   ```bash
   cat content/vocab/members.yml
   ```
   Only offer human members (alice, charlie, bob, dana) — not `team` or `agent`.

4. Ask the user for their preferred language for AI responses and generated content. Offer common options:
   - `en` — English
   - `ko` — Korean (한국어)
   - `ja` — Japanese (日本語)
   - `zh` — Chinese (中文)
   - Or any other ISO 639-1 code

   Default to `en` if they don't have a preference.

5. Create or update `.env` with the chosen member name and language:
   ```bash
   printf "MEMBER=<chosen-name>\nLANGUAGE=<chosen-language>\n" > .env
   ```

6. Configure git hooks (shared hooks in `.githooks/`):
   ```bash
   git config core.hooksPath .githooks
   ```

7. Build the index, local semantic search (qmd), database, and knowledge graph:
   ```bash
   ./hey index build --qmd
   ./hey db build
   ./hey graph build
   ```

8. Validate the repo is healthy:
   ```bash
   ./hey validate
   ```

9. Confirm the workspace directory exists for this member:
   ```bash
   ls workspace/$MEMBER/
   ```

10. Scaffold personal capture directories for the member:
    ```bash
    mkdir -p workspace/$MEMBER/ideas
    ```
    Create `workspace/$MEMBER/ideas/README.md` if it doesn't exist:
    ```markdown
    # Ideas

    Personal capture space for concerns, ideas, observations, and positions.

    ## Ontology

    Each file: `YYYY-MM-DD-[kind]-slug.md` with frontmatter:

    ```yaml
    ---
    id: note_YYYY-MM-DD-[slug]
    type: note
    status: active | done | archived  # artifact lifecycle (notes), NOT task status
    created_at: YYYY-MM-DD
    updated_at: YYYY-MM-DD
    x_kind: concern | idea | observation | position
    ---
    ```

    ## Usage

    - `x_kind`: the actual flavor — `concern`, `idea`, `observation`, or `position`
    - `status`: lifecycle — `active` (open), `archived` (parked/not now), `done` (resolved)
    - One idea per file, keep it short
    - Use `/promote` when an idea should become a shared team artifact
    ```

11. Print a welcome message listing all available commands (in the user's chosen language):
    ```
    Setup complete! Here are your available commands:

    Daily workflow:
      /morning          — Start of day: sync, review, daily plan
      /check            — Quick status check
      /snap             — Snapshot progress, commit and push
      /search <query>   — Natural-language artifact search
      /whatnext         — Claim and start the next task
      /standup          — Generate standup summary
      /night            — End of day: reflect, distill, prepare tomorrow

    Weekly workflow:
      /sync             — Run weekly iteration sync ceremony
      /clean            — Execute hygiene checklist + auto-fix
      /review-roadmap   — Review active plans and progress
      /assess           — Team progress assessment
      /iteration-board  — Kanban view of current iteration

    Capture:
      /idea             — Capture a concern, idea, observation, or position
      /promote          — Promote a mature idea into a shared content artifact

    Creating artifacts:
      /decide           — Create an Architecture Decision Record
      /validate         — Validate repo + fix errors

    Agent tasks:
      /task-status      — Show task queue and workspace status
      /whatnext         — Claim and execute next agent task
    ```

12. Remind the member to complete their workspace setup:
    - Fill in `workspace/$MEMBER/profile.md` with their domains, repos, skills, and MCPs. Use `workspace/charlie/profile.md` as a reference.
    - Create `workspace/$MEMBER/repos.yml` listing local paths to their working repos. Use `workspace/charlie/repos.yml` as the format example. This enables the `/night` command to survey activity across all repos.
    - Read `docs/ONBOARDING.md` for the full onboarding checklist.

13. Enable local semantic search (optional). Tell the member this step is
    **optional** and the default is to **skip** it. They can run it now or any
    time later:
    ```bash
    ./hey index build --qmd
    ```
    This builds a per-developer local semantic index for `./hey search`. First
    run does a one-time ~318 MB embedding-model download to `~/.cache/qmd/` and,
    on macOS, requires `brew install sqlite`. Skipping it just keeps lexical
    search — everything else works identically. See
    `decision_adr-qmd-local-retrieval-backend` for details.
