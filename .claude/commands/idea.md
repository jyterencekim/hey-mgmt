Capture an idea — concern, proposal, observation, or position — to your workspace.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.

Usage: `/idea [optional free text]`

1. Read `MEMBER` from `.env`. If not set, ask the user for their name.

2. Determine the idea content:
   - If `$ARGUMENTS` is provided, use it as the idea body
   - If no arguments, ask: "What's on your mind?"

3. Classify `x_kind` from the content:
   - **concern**: risk language — "risk", "worry", "what if", "could break", "vulnerable", downside scenarios
   - **idea**: proposal language — "we should", "what about", "could we", "opportunity", improvement suggestions
   - **observation**: patterns, reflections, connections — "I noticed", "it seems like", "interesting that", seeing/noticing/connecting
   - **position**: standing beliefs, philosophies, frameworks — "I believe", "our approach to", "how we think about", "our philosophy on"

4. Generate a slug from the core topic (lowercase, hyphenated, max 6 words). Example: "withdrawal surge could drain reserves" → `withdrawal-surge-drain-reserves`

5. Ensure the directory exists:
   - If `workspace/$MEMBER/ideas/` does not exist, create it
   - If `workspace/$MEMBER/ideas/README.md` does not exist, create it with:
     ```markdown
     # Ideas

     Personal capture space for concerns, ideas, observations, and positions.

     ## Ontology

     Each file: `YYYY-MM-DD-[kind]-slug.md` with frontmatter:

     ```yaml
     ---
     id: note_YYYY-MM-DD-[slug]
     type: note
     status: active | done | archived
     created_at: YYYY-MM-DD
     updated_at: YYYY-MM-DD
     x_kind: concern | idea | observation | position
     ---
     ```

     ## Kinds

     | Kind | What it captures |
     |------|-----------------|
     | `concern` | Risk, worry, downside scenario |
     | `idea` | Proposal, suggestion, improvement |
     | `observation` | Pattern noticed, reflection, connection |
     | `position` | Standing belief, philosophy, framework |

     ## Usage

     - One idea per file, keep it short
     - `status`: `active` (open), `done` (resolved/acted on), `archived` (parked)
     - When an idea matures into a team artifact, use `/promote` to promote it to `content/`
     ```

6. Write the idea file to `workspace/$MEMBER/ideas/YYYY-MM-DD-[kind]-slug.md`:

   ```markdown
   ---
   id: note_YYYY-MM-DD-[slug]
   type: note
   status: active
   created_at: YYYY-MM-DD
   updated_at: YYYY-MM-DD
   x_kind: [concern|idea|observation|position]
   ---

   # [Title derived from content]

   [The idea body — keep it concise. Expand on the core insight, risk, or proposal. If the user provided a long explanation, distill it.]
   ```

   Rules:
   - Today's date for `created_at` and `updated_at`
   - `id` includes the date: `note_YYYY-MM-DD-slug`
   - Kind prefix in filename: `YYYY-MM-DD-[kind]-slug.md`
   - Slugs must still be unique per day regardless of kind; if the same topic already exists for today, update that idea instead of creating a second file with the same slug
   - One idea per file
   - Keep it short — capture the essence, not a full essay

7. Confirm with a single line:
   ```
   Captured [x_kind]: "[title]" → workspace/$MEMBER/ideas/YYYY-MM-DD-[kind]-slug.md
   ```
