Bring this checkout up to spec — repo-wide, idempotent, safe to re-run anytime.

Complements `/setup`: `/setup` is the one-time first-clone onboarding (member
identity, language, profile scaffolding). `/upgrade` ensures the repo's
*capabilities* are present and current, and is the convenient way for the team
to adopt new features (like local semantic search) after they ship.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate
all output in this language.

The engine is `./hey upgrade`. Capabilities are defined in
`scripts/lib/capabilities.mjs`; rationale in
`decision_adr-repo-wide-capability-upgra`.

Run this flow:

1. Survey current state (read-only):
   ```bash
   ./hey upgrade --check
   ```

2. Present the result to the member with **recognition first, reminders after**
   (per `playbook_interaction-tone`):
   - Lead with what's already set up (the `✓` capabilities).
   - Then list what needs attention: missing **core** (`○`, will be applied),
     **diagnostic** warnings (`⚠`, e.g. `.env` → point to `/setup`), and
     **optional** capabilities that are off (`○`).

3. Apply missing **core** capabilities automatically (idempotent):
   ```bash
   ./hey upgrade --yes
   ```
   `--yes` applies core and deliberately leaves optional capabilities untouched.

4. For each **optional** capability that is off, explain the cost and benefit,
   then **ask the member** before enabling it. Do not enable silently. Example —
   local semantic search (qmd):
   - Benefit: natural-language + question search (hybrid BM25+vector); see
     `note_qmd-benchmark-2026-06-02`.
   - Cost: one-time ~318MB embedding model download + (macOS) `brew install
     sqlite`; the index is per-developer and gitignored.
   - On **yes**:
     ```bash
     ./hey upgrade --with-optional
     ```
   - On **no**: tell them they can enable it later with the same command (or
     `./hey index build --qmd`). Search keeps working on lexical meanwhile.

   Knowledge graph (`intelligence-graph`):
   - Benefit: the unified knowledge graph (mgmt artifacts, memories, Fisher
     knowledge, auditor facts, onchain-analysis, procedural playbooks) becomes
     queryable locally (`node ../hey-mgmt-intelligence/bin/kg.mjs neighborhood|
     search|guidance …`), and `./hey procedure check|gate` starts working. See
     `decision_adr-kg-v2-operating-decisions`.
   - Cost: clones the private `hey-mgmt-io/hey-mgmt-intelligence` repo beside
     this one (needs org access and `gh auth login` or git credentials), one
     `npm install` (two small deps), and a sub-second build. The built graph is
     local and gitignored there; rebuild after pulling mgmt with
     `node ../hey-mgmt-intelligence/bin/kg.mjs build`. Research nodes need
     `hey-mgmt-io/onchain-analysis` cloned beside as well (without it the
     build reports the auditor's citations to those docs as dangling).
   - On **yes**: `./hey upgrade --with-optional` (this also enables qmd; to take
     only the graph, run the three steps by hand: `gh repo clone
     hey-mgmt-io/hey-mgmt-intelligence ../hey-mgmt-intelligence && cd
     ../hey-mgmt-intelligence && npm install && node bin/kg.mjs build`).
   - On **no**: same command later; nothing else depends on it.

5. For **diagnostic** warnings (e.g. `.env` missing `MEMBER`), do not auto-fix —
   direct the member to `/setup`.

6. Summarize what changed and what is still optional, citing the capability ids
   and versions from the output. If anything failed, surface the exact error —
   do not report success if a capability failed (`✗`).

Notes:
- `./hey upgrade --changelog` prints what each capability version added.
- The command reads machine state every run, so it self-heals: if a feature's
  artifacts are later removed, the next `/upgrade` re-offers it.
