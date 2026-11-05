> **Format decision 2026-09-02 (alice):** the goal-anchored format below is the standing `/weekly-report` format. The goal/initiative-browser variant (charlie, 2026-08-20) is preserved at [`weekly-report.md.goal-browser.bak`](weekly-report.md.goal-browser.bak) for reference only. Reference implementation of this format: `workspace/alice/weekly-progress-2026-09-02.html`; builder used for it: [`workspace/alice/tools/weekly-report-build_ga.py`](../../workspace/alice/tools/weekly-report-build_ga.py) (rollup queries verbatim from §3, generated appendix, coverage check, external derivation).

Generate the Wednesday weekly progress report for team review, in the **goal-anchored** format (adopted 2026-08-14 per P7 of [`note_automated-initiative-task-hygiene-strategy`](../../content/notes/2026/08/note_automated-initiative-task-hygiene-strategy.md); evolves the Goal × Initiative format of 2026-07-15). One source, **two renderings**: internal (ids + links) and external (narrative only, no slug ids). Outputs a note artifact + HTML files.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). All output in this language. Committed artifacts are English regardless.

## Format — goal-anchored

The report leads with goals, and every goal answers four questions in order: **Why now → What moved → How → Next**. A task list answers "what", never "toward what"; the why/how must lead.

```
h1  Team Weekly Progress (YYYY-MM-DD) — Goal-Anchored
    lead: format legend + Focus-chip provenance + "W{PREV} → W{CUR} in 4 lines"
h2  📋 Agenda for the weekly — TABLE (added 2026-09-02, alice): # · Topic ·
    Notes · Owner · Link. Rows come ONLY from workspace/$MEMBER/agenda/{TODAY}.json
    (topic, notes, owner, link) — member-raised items, in the member's own words
    and language. A linked document renders as a short underlined
    `link` anchor (href + title = the URL; 2026-09-23, alice — never the
    full URL or path as cell text); do NOT summarise it into the table or a note. 💬 items stay on their
    initiative cards and are NOT copied here. Both editions carry the table.
h2  🛠 AI skill share — engineer session (added 2026-09-23, alice; from the
    2026-09-23 weekly: every engineer reviews and revises one AI skill —
    prompt, rule set, harness — that others could use, registers it in this
    repo, walks the team through it at the weekly, and keeps it updated as
    its owner). Renders directly under the agenda table. TABLE: # · Engineer
    · Skill · What it does · Where it helps · Status · Link.
    WINDOW RULE (2026-10-14, alice): the table lists ONLY skills CREATED in
    this edition's week — first git commit of the SKILL.md between TODAY−7
    and TODAY inclusive (e.g. a 14th edition lists skills created 7th→14th).
    Earlier skills stay in the registry but are NOT re-listed week after
    week. One row per engineer in roster order (content/vocab/members.yml,
    role ending in -engineer; other members appear only if they created one
    this week; several new skills per owner = several rows). Rows come ONLY
    from the registry (Q-S, Step 3b): .claude/skills/<slug>/SKILL.md
    frontmatter owner / description / applies_to — never from conversation,
    memory, or Slack. Status chip: 🆕 new this week (+ created date) · ⏳ none
    this week (row still rendered with empty cells — the gap is the point).
    "What it does" and "Where it helps" are the owner's own frontmatter
    words: do NOT summarise the skill body, do NOT rate or rank skills. Both
    editions carry the table; the external edition drops the Link column
    and paths. The h2 sub-chip (internal) states new · pending · older-in-
    registry counts so the older skills stay discoverable without rows.
    NEW-PRODUCT WALKTHROUGH MARK (2026-10-14, alice): directly under the
    table, both editions carry one fixed `p.walkthrough` line: when an
    initiative shipped or is building a NEW product this week (e.g. the
    JPYC vault and its backend), the engineer session also holds a separate
    walkthrough of that product — "product · owner · session date", or
    "none this week". It is a marker the members fill in at the meeting
    (editable HTML), NOT an agent judgement: the agent never decides what
    counts as a new product or writes the product explanation into the
    report.
    Link cells use the same short underlined `link` anchor as the agenda.
h2  🎯 <Goal title> (one per content/goals/goal_*.md; goal id chip INTERNAL only)
    p.why    — WHY NOW: 1–2 sentences. Why this goal deserves attention this
               week (deadline proximity, market window, dependency). JUDGMENT:
               agent-drafted, member-reviewed before save.
    [goal progress line — financial goals ONLY: live value from the
     hey-mgmt-auditor MCP with its asOf stamped; see Rendering rules]
h3.track   grey subtitle = the 2H Focus map's intermediate objective
           (tracks are REPORT STRUCTURE, not artifacts — never create files)
h4  <status light> Initiative title  [owner chips] [🎯 Focus chip] [NEW INITIATIVE chip]
    ≤3 bullets  — WHAT MOVED: what shipped / what's blocked, with dates and
                  past-due flags. Fed by the Q-R rollup (Step 3), enriched by
                  Step 6 — never improvised membership.
    PRODUCT INITIATIVES ONLY (x_initiative_kind: product; added 2026-11-03,
    alice — decision_adr-product-initiative-kickoff), directly under the h4:
    p.kickoff   — PRD link · start → target ("target passed" when
                  x_timeline_end < TODAY) · per-component done/total
    p.redflag   — 🔴 every missing kickoff field by name (PRD, dates,
                  components, baseline) plus ONE task summary: "N open tasks
                  need fixes — X without component, Y without start/target
                  date, Z past target". Never dropped for length; the
                  per-task list goes to the appendix (Step 8), not the card.
    p.scope     — tasks added after x_kickoff_date and baseline tasks
                  removed/archived/unlinked, from Q-PI. Omitted when none.
    p.discuss   — 💬 sync-agenda item(s) that belong to THIS initiative
    p.how    — HOW (goal level, after the last initiative): 1–2 sentences on
               the approach connecting the initiatives. JUDGMENT: agent-drafted,
               member-reviewed.
    p.next   — NEXT (goal level): per-member next action
               ("Next — bob: … · charlie: … · dana: …"), with due dates.
h2  ⚠️ Not visibly serving any goal
    (a) initiatives with moved tasks but no contributes_to (Q-F) — each with an
        "→ unblocks <goal/initiative>" pointer where it gates one, or an honest
        "no goal linkage" if not
    (b) moved tasks under no initiative at all (Q-O) — grouped by owner
    This section is deliberately uncomfortable (P7): either the linkage is
    missing (propose the frontmatter fix — member confirms goal links, goals
    ADR) or the work genuinely serves no goal (a prioritization question for
    the sync). Never force-link to make the report look tidy.
div.flags  ⚠ Team-level flags (cross-initiative: decision queues, deadlines,
    member coverage, process gaps)
h2  📋 Appendix — collapsed details blocks (generated, Step 8; INTERNAL only)
```

Rendering rules:

- **Editable HTML (2026-09-02, alice).** Wrap the report body in `<div id="report">` and ship a fixed toolbar (✏️ Edit toggles `contenteditable` on `#report`; ＋ Agenda row appends a row to `table.agenda`; 💾 Save HTML downloads the edited page; ↺ Reset clears the browser draft). Edits autosave to `localStorage` per path; to persist, the member commits the downloaded file over the original. The toolbar and script live outside `#report` so a restored draft keeps working. Reference: `workspace/alice/tools/weekly-report-build_ga.py` (`TOOLBAR`, `agenda_table`).

- **Skill registry (2026-09-23, alice).** Shared AI skills live in this repo at `.claude/skills/<slug>/SKILL.md` — Claude Code's native skill location, so one clone makes every registered skill usable in every repo. Frontmatter the report reads: `name`, `description` (what it does, ≤25 words), `owner` (member id from `members.yml`), `applies_to` (list of repos or domains, ≤12 words joined), `updated` (`YYYY-MM-DD`). Owners submit via PR, present at the weekly, and keep the file current; the agent MUST NOT edit another member's skill body or write a skill on a member's behalf. The table is mechanics, not judgment: the Step 3b scan decides every cell. **Window rule (2026-10-14, alice):** only skills whose SKILL.md was first committed inside the edition's 7-day window (TODAY−7 → TODAY) are listed; older skills stay in the registry unlisted, and an engineer who created no skill this week renders as a ⏳ row. Ship a `＋ Skill row` toolbar button next to `＋ Agenda row` (appends a row to `table.skills`) so a late verbal submission can be typed in at the meeting; the owner still files the SKILL.md afterwards.
- **Status lights**: 🟢 on track · 🟡 moving with risk · 🔴 blocked / past due · ✅ done this week. An initiative with zero movement collapses into a one-line `p.quiet` "Quiet: A · B · C" at the end of its goal section — with an inline annotation when a quiet item still carries a decision (e.g. "task 34d past due — pause or commit?").
- **Product initiatives (2026-11-03, alice — [`decision_adr-product-initiative-kickoff`](../../content/decisions/decision_adr-product-initiative-kickoff.md)).** These lines are ADDED under the h4; the card's WHAT MOVED bullets, `p.discuss`, task list and the goal's why/how/next stay exactly as before — never replace narrative with the product lines. Every active initiative with `x_initiative_kind: product` renders `p.kickoff`, plus `p.redflag` and `p.scope` when Q-PI reports them, even when the initiative is otherwise quiet. A product initiative with red flags is never 🟢 and never collapses into `p.quiet`. Red flags and scope lines are mechanics from Q-PI, not judgment: do not soften, merge or drop them, and do not infer a date or PRD the file lacks. Builder helper: `product_block(ini_id, internal)` in `workspace/alice/tools/weekly-report-build_ga.py` reads `PI.json`. Business, marketing and ops initiatives keep the existing card until their own ADR lands. External edition keeps `p.kickoff` and `p.redflag` text without ids.
- **Placeholders**: a goal with zero contributing active initiatives (Q-P), or a focus-map node with no initiative, renders as an amber `p.placeholder` line so structural gaps stay visible week over week.
- **💬 agenda lives under the initiative it belongs to**, not in a separate agenda section. The flags box holds only genuinely cross-initiative items. The set of 💬 items IS the week's sync agenda.
- **Mechanics vs judgment**: the rollup (which task moved under which initiative under which goal) is deterministic — Step 3's queries decide it, not your judgment. The `p.why` / `p.how` narrative is judgment — agent-drafted, and the member reviews the draft before save (present the why/how lines for confirmation; on silence in a non-interactive run, mark them `(draft)`).
- **Initiative → goal mapping comes from the repo**: `contributes_to` in initiative frontmatter decides which h2 an initiative renders under; task↔initiative linkage is `parent_of` (initiative→task) UNION `child_of` (task→initiative) — both directions are live in the ledger (verified 2026-08-14: 364 vs 449 tasks; using only one undercounts). If mapping feels wrong, fix the initiative file (member confirms goal links — goals ADR), don't silently re-shelve in the report.
- **Financial goal progress is never hardcoded.** For any goal with a financial metric (e.g. `goal_tvl-growth`: TVL/custody NAV), pull the current value live from the `hey-mgmt-auditor` MCP at build time and stamp its `asOf` (member timezone) next to the figure. If the freshness verdict is `stale`, say so inline ("⚠ stale, older than its refresh budget") — never present a stale figure as current, never omit the stamp. Committed prose carries only the human-set TARGET.
- **Two renderings, one source.** Build the internal rendering first; derive the external from it:
  - **Internal**: full detail — slug id chips, repo links, appendix, flags, member-coverage internals.
  - **External**: why/how narrative only. NO slug ids anywhere (titles and plain prose only), no appendix, no flags box, no repo paths; keep goal sections, the auditor-sourced progress figures **with asOf stamps**, and the "Not visibly serving any goal" section compressed to one honest paragraph. Non-team readers must understand every line.
- **NEW INITIATIVE chip** on anything created/promoted/split since the last edition.
- **Compression altitude**: bullets read like project status, not code review — name what shipped, how many, when; no per-rule thresholds or commit-hash enumerations (those live in task files). Non-engineers must understand every line.
- **Hard length caps (2026-09-16, alice: "짧고 clear하고 명확하게")** — these are limits, not targets; the builder fails the run if exceeded:
  - "in 4 lines" summary: **one sentence per line, ≤30 words**, one number each.
  - `p.why` / `p.how`: **one sentence, ≤25 words**.
  - Initiative card: **≤3 bullets, ≤22 words each**, one fact per bullet. Evidence detail stays in the task file — link it, don't paste it.
  - `p.discuss`: **one question, ≤20 words**, owner in parentheses. Max 1 per card.
  - 🛠 skill share row: **"What it does" ≤25 words, "Where it helps" ≤12 words**, one skill per row. The builder never truncates — an over-cap frontmatter fails the run like any other cap (fix the SKILL.md, not the report).
  - `p.next`: **≤12 words per member**.
  - `p.quiet`: names only; one annotation ≤10 words per flagged item.
  - ⚠ section (b): **one line per theme** (`✅/🟡/🔴 Theme — N tasks, one fact`) + id chips.
  - Flags box: **≤6 items, ≤18 words each**.
  - Slack summary message: **≤1,200 characters**. Canvas ≤ 6,000 characters (appendix stays in the HTML).
- **Member coverage**: every internal member with owned work appears via a goal section or the unanchored section. Flag zero-task members in the flags box (ash/hayden are external onramp.to attendees — flag as roster question, not delinquency).

## Steps

### 1. Sync and rebuild

```bash
git stash && git pull --rebase && git stash pop   # worktree: upstream is origin/main
./hey index build && ./hey db build
```

### 2. Resolve member + ISO weeks

Read `MEMBER` from `.env`. `TODAY=$(date +%Y-%m-%d)`, `CUR=$(date +%V)`, `PREV=CUR-1`, year `$(date +%G)`, `WEEKAGO=$(date -v-7d +%Y-%m-%d)`. Watch for skipped iterations (W29 was never opened; the team ran two weeks against W28) — trust the `iteration` values actually present in the DB over arithmetic.

### 3. Rollup queries (deterministic — run verbatim, substitute placeholders)

"Moved this week" := done in W{PREV} or W{CUR}, OR open (`ready`/`doing`/`blocked`) and `updated_at >= {WEEKAGO}`. Task↔initiative membership is the UNION of both relation directions. Run these exactly; do not improvise the mapping.

```bash
# Q-R  goal → initiative → moved-task rollup (feeds every 🎯 section)
./hey db query "
WITH moved AS (
  SELECT id, title, owner, status, iteration, due_date, updated_at FROM items
  WHERE type='task' AND (
    (status='done' AND iteration IN ('{YYYY}-W{PREV}','{YYYY}-W{CUR}'))
    OR (status IN ('ready','doing','blocked') AND updated_at >= '{WEEKAGO}') )
),
task_ini AS (
  SELECT p.dst_id AS task_id, p.src_id AS ini_id FROM relations p WHERE p.rel_type='parent_of'
  UNION
  SELECT c.src_id, c.dst_id FROM relations c WHERE c.rel_type='child_of'
)
SELECT g.dst_id AS goal, ini.id AS initiative_id, ini.title AS initiative,
       m.id, m.title, m.owner, m.status, m.iteration, m.due_date, m.updated_at
FROM relations g
JOIN items ini ON ini.id=g.src_id AND ini.type='initiative' AND ini.status='active'
JOIN task_ini ti ON ti.ini_id=ini.id
JOIN moved m ON m.id=ti.task_id
WHERE g.rel_type='contributes_to' AND g.dst_id LIKE 'goal_%'
ORDER BY g.dst_id, ini.title, m.owner"

# Q-F  unanchored initiatives with movement (⚠ section part a)
./hey db query "
WITH task_ini AS (
  SELECT p.dst_id AS task_id, p.src_id AS ini_id FROM relations p WHERE p.rel_type='parent_of'
  UNION
  SELECT c.src_id, c.dst_id FROM relations c WHERE c.rel_type='child_of'
)
SELECT DISTINCT ini.id, ini.title, ini.owner FROM items ini
JOIN task_ini ti ON ti.ini_id=ini.id
JOIN items t ON t.id=ti.task_id AND t.type='task'
  AND ((t.status='done' AND t.iteration IN ('{YYYY}-W{PREV}','{YYYY}-W{CUR}'))
       OR (t.status IN ('ready','doing','blocked') AND t.updated_at >= '{WEEKAGO}'))
WHERE ini.type='initiative'
  AND NOT EXISTS (SELECT 1 FROM relations g WHERE g.src_id=ini.id
                  AND g.rel_type='contributes_to' AND g.dst_id LIKE 'goal_%')
ORDER BY ini.id"

# Q-O  moved tasks under no initiative at all (⚠ section part b)
./hey db query "
WITH task_ini AS (
  SELECT p.dst_id AS task_id FROM relations p WHERE p.rel_type='parent_of'
  UNION
  SELECT c.src_id FROM relations c JOIN items i ON i.id=c.dst_id AND i.type='initiative'
  WHERE c.rel_type='child_of'
)
SELECT t.id, t.title, t.owner, t.status, t.iteration, t.due_date FROM items t
WHERE t.type='task' AND t.id NOT IN (SELECT task_id FROM task_ini)
  AND ((t.status='done' AND t.iteration IN ('{YYYY}-W{PREV}','{YYYY}-W{CUR}'))
       OR (t.status IN ('ready','doing','blocked') AND t.updated_at >= '{WEEKAGO}'))
ORDER BY t.owner, t.id"

# Q-P  placeholder goals (zero active contributing initiatives)
./hey db query "
SELECT gl.id, gl.title FROM items gl
WHERE gl.type='goal' AND gl.status='active'
  AND NOT EXISTS (SELECT 1 FROM relations g JOIN items i ON i.id=g.src_id
                  AND i.type='initiative' AND i.status='active'
                  WHERE g.dst_id=gl.id AND g.rel_type='contributes_to')"

# Appendix inventories (Step 8)
# Q1  done in W{PREV}
./hey db query "SELECT id, title, owner, priority, status, iteration, due_date FROM items WHERE type='task' AND status='done' AND iteration='{YYYY}-W{PREV}' ORDER BY owner"
# Q1b done in W{CUR} so far (mid-week closes — skipping this lost 16 tasks once)
./hey db query "... status='done' AND iteration='{YYYY}-W{CUR}' ..."
# Q2  open (status names: ready/doing/blocked — renamed 2026-05-20)
./hey db query "SELECT id, title, owner, status, priority, due_date, iteration FROM items WHERE type='task' AND status IN ('ready','doing','blocked') ORDER BY owner"
```

Dump all results to the scratchpad as JSON — Step 8's appendix generation and coverage check run off it. Report the anchorage split in the final summary (`moved: N | goal-anchored: N | unanchored-initiative: N | no-initiative: N`).

### 3a. Product initiative check (deterministic — feeds p.kickoff / p.redflag / p.scope)

```bash
# Q-PI  kickoff gaps, task gaps (component, start/target dates, slips),
#       scope diff against x_baseline_tasks, per-component rollup
./hey initiative check --json > "$SCRATCH/PI.json"
```

`unclassified` lists active initiatives with no `x_initiative_kind`; put the count in the flags box ("N initiatives unclassified") until it reaches zero. Each entry in `products` renders under its goal per the Product initiatives rendering rule.

### 3b. Skill registry scan (deterministic — feeds the 🛠 AI skill share table)

Window rule (2026-10-14, alice): a skill is listed only if its SKILL.md was **first committed** between `TODAY−7` and `TODAY` inclusive (creation date = oldest `git log --diff-filter=A` commit; an uncommitted file counts as created today). Skills created earlier are counted as `older` and not re-listed.

```bash
# Q-S  skills created this week + engineer roster → scratchpad/QS.json
python3 - <<'PY' > "$SCRATCH/QS.json"
import json, pathlib, subprocess, yaml, datetime
TODAY = "{TODAY}"
window_start = (datetime.date.fromisoformat(TODAY) - datetime.timedelta(days=7)).isoformat()
roster = [m["name"] for m in yaml.safe_load(open("content/vocab/members.yml"))["members"]
          if str(m.get("role","")).endswith("-engineer")]
rows, older = [], 0
for p in sorted(pathlib.Path(".claude/skills").glob("*/SKILL.md")):
    fm = yaml.safe_load(p.read_text().split("---")[1]) or {}
    if not fm.get("owner"): continue                        # vendored/tooling skills carry no owner
    first = subprocess.run(["git","log","--diff-filter=A","--format=%cs","--",str(p)],capture_output=True,text=True).stdout.strip().splitlines()
    created = first[-1] if first else TODAY                 # uncommitted = created now
    if not (window_start <= created <= TODAY): older += 1; continue
    rows.append({"owner": fm["owner"], "name": fm.get("name", p.parent.name),
                 "description": fm.get("description",""), "applies_to": fm.get("applies_to",[]),
                 "created": created, "path": str(p), "status": "new"})
for m in roster:
    if not any(r["owner"]==m for r in rows):
        rows.append({"owner": m, "status": "pending"})
order = {m:i for i,m in enumerate(roster)}
rows.sort(key=lambda r: (order.get(r["owner"], 99), r.get("name","")))
print(json.dumps({"window": [window_start, TODAY], "older": older, "rows": rows}, ensure_ascii=False, indent=1))
PY
```

Roster order comes from `members.yml`; owners outside the engineer roster (e.g. alice) sort last. Report the split in the final summary (`skills: new this week N | older in registry N | pending: <names>`).

### 4. Focus-chip sources (in priority order)

1. **Monday weekly sync meeting note** `content/meetings/{YYYY}/{MM}/meeting_weekly-*-{MON_DATE}.md` — `## Action Items` + `## Decisions`; also pull `relations:` task ids regardless of status (a `plan`-status task the meeting referenced is in-scope).
2. **If no meeting note exists** (it happened in W30): fall back to the current iteration log `note_iteration-log-{YYYY}-w{NN}.md` `## Goals`, and **flag the missing Monday note in the report's flags box** — the fallback is a symptom worth surfacing.
3. Never invent Focus from your own ranking. 4–8 chips per report.

### 5. Live goal-progress figures (financial goals)

For each goal whose `metric` is financial (today: `goal_tvl-growth` — TVL / custody NAV), fetch the current value via the `hey-mgmt-auditor` MCP (`get_analysis` / the appropriate read tool), record the value + `asOf` + freshness verdict to the scratchpad JSON. Both renderings print the figure with its asOf stamp; a `stale` verdict is surfaced inline, never silently. Non-financial goal progress (partner counts etc.) comes from the goal's own frontmatter target vs what the rollup shows — no invented numbers.

### 6. Enrich via parallel research agents

Spawn ~4 read-only Explore agents by cluster (backend/protocol · accounting+product misc · risk/research (dana) · GTM/vault-ops/partners). Each reads: the scratchpad rollup table (Q-R/Q-F/Q-O — membership is already decided; agents enrich, they do not re-map), its members' daily logs for the window (`workspace/{member}/logs/`), and the task files of milestone-looking done items. Each returns per-initiative: STATUS light + reason, SHIPPED (≤4 dated one-liners), MOVING/BLOCKED (past-due flags vs today), NEXT per member, DISCUSS (0–2 genuine decisions), DONE_IDS — plus per-goal WHY-NOW and HOW draft sentences (1–2 each) for the member to review.

**Known failure mode**: Explore agents are read-only (no Write; Bash redirects blocked) and their final message can be swallowed by stop-hook chains, returning only "Done." If that happens, recover the report from the subagent transcript jsonl under `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl` (largest assistant text block containing `## initiative_`) — do not re-run blind, and never fabricate.

### 7. Re-pull before writing

Re-run Q-R/Q-F/Q-O and Q1/Q1b/Q2 immediately before assembling the HTML (enrichment takes minutes; same-day task churn is real). Diff; enrich any delta. Also intersect Q2 with Q1b — anything in both renders as done only, never as open.

### 8. Build the two renderings + generated Appendix

**Internal first.** Write the hand-authored body (format above) with the `<!-- AGENDA_TABLE -->` and `<!-- SKILL_SHARE -->` markers, in that order, right after the "in 4 lines" block (the builder substitutes them from `agenda/{TODAY}.json` and `QS.json`), ending with `<h2>📋 Appendix — task lineage</h2><!-- APPENDIX_GENERATED -->`. Then generate the appendix from the scratchpad JSON as four collapsed `details.task-list` blocks:

1. ✅ W{PREV} Done — raw list by owner
2. ✅ W{CUR} Done so far — raw list by owner
3. ⏰ Past-due open tasks — burndown inventory (every open task with `due_date < TODAY`, due chip per row)
4. 🔵 Full open-task inventory by owner (ready/doing/blocked)

This is what satisfies coverage and past-due verification without bloating the standup view. Raw task lists live ONLY here — never in goal sections.

**External second, derived from the internal body**: strip every slug id, id chip, repo link, the appendix, the flags box, and member-coverage internals; keep goal sections (Why now / What moved / How / Next), auditor figures with asOf stamps, and a one-paragraph honest summary of unanchored work. Re-read it once as an outsider: any line that needs repo context to parse gets rewritten or cut.

**Coverage check (mandatory, internal rendering, before saving)**: every task id from Q1+Q1b+Q2 appears somewhere in the internal HTML (body or appendix), and every task id from Q-R/Q-O appears in a goal section or the ⚠ section. `MISSING` must be ∅ — loop until it is, and print the result (`DB: N | report: N | MISSING: 0`) in the final summary. Past-due check: every past-due open task appears — the appendix inventory covers this structurally; the ones that matter at standup also get explicit `past-due` chips in body digests.

**CSS**: reuse the canonical stylesheet from the reference implementation verbatim (`workspace/alice/weekly-progress-2026-07-23.html`) — white background, `h3.track`, `p.next`, `p.discuss`, `p.placeholder`, `p.quiet`, `.flags`, chips, `details.task-list`. Add `p.why` / `p.how` styled like `p.next` (grey, indented) if absent.

### 9. Save

- Internal HTML → `workspace/$MEMBER/weekly-progress-{TODAY}.html` (the PostToolUse hook renders it in the preview panel).
- External HTML → `workspace/$MEMBER/weekly-progress-{TODAY}-external.html`.
- Board: both files show up in the board's **Weekly** tab (`/weekly/`) with no extra step; the board serves the files as written and links each known id chip to its board page. Keep the file names above so the tab finds them.
- Note → overwrite the **monthly** note `content/notes/{YYYY}/{MM}/note_weekly-progress-report-{YYYY}-{MM}.md` (stable id `note_weekly-progress-report-{YYYY}-{MM}`): update `title` to `Weekly Progress Report {TODAY}` and `updated_at`, replace the body with the markdown mirror of the **internal** rendering (same structure, compressed; link both HTML companions; state coverage numbers + anchorage split; prior editions live in git history). First report of a new month creates the note via `./hey new`.
- Copy both HTML files to `~/Downloads/` (alice's standing preference).

### 10. Commit and report back — SAFELY

The content-sync hook auto-commits each write with junk messages and its push fails in worktrees (upstream mismatch). Cleaning that up caused a **production incident on 2026-07-29**: `git reset --soft origin/main` was run while the working tree was six days stale, which staged the deletion of every file the team had added since — and the commit was pushed, wiping ~20k lines from main (recovered by immediate revert). The rules that prevent a repeat:

1. **Sync first, always**: `git stash && git pull --rebase && git stash pop` and confirm `git log origin/main..HEAD` lists ONLY your own hook auto-commits before any history surgery.
2. **Never `reset --soft` against a tree that might be stale.** Prefer committing forward: `git add <exact files you changed>` then commit.
3. **Inspect what is staged before committing**: `git diff --cached --stat` must show only your files with plausible line counts. Unexpected deletions = STOP.
4. Push with `git push origin HEAD:main`, then **verify on origin** (`git show origin/main:<file>`) — hook rebase autostashes have silently dropped edits before; trust only what origin shows.

Report back: note path, both HTML paths, Downloads copies, coverage result, the anchorage split, the 💬 agenda list (it doubles as the sync agenda), the skill-share split (new this week / older in registry / pending names), zero-task members, whether the why/how drafts were member-reviewed or remain `(draft)`, and anything the Focus fallback surfaced.

## Reference implementations

- **Structural canon (pre-P7)**: [`workspace/alice/weekly-progress-2026-07-23.html`](../../workspace/alice/weekly-progress-2026-07-23.html) — first full-cycle Goal × Initiative edition (tracks, Next lines, 💬 agenda, flags, generated appendix). The goal-anchored format keeps its CSS and section machinery, adds Why/How/Next per goal + the ⚠ unanchored section + the external rendering.
- First draft of the goal-first format: `workspace/alice/weekly-progress-2026-07-15-goal-first.html`.
- Historical (superseded): the Sector × Initiative editions `weekly-progress-2026-05-27.html` … `2026-07-15.html` — structural reference only, NOT the template.

## Forbidden patterns (accumulated regressions — keep honoring them)

- Organizing by sector or by member at the top level — goals first, always.
- Leading a goal section with a task list — Why now leads; raw lists live only in the appendix.
- Improvising task→initiative or initiative→goal membership instead of running Step 3's queries verbatim; using only one relation direction (`parent_of` alone undercounts — union with `child_of`).
- Creating artifacts for tracks, or force-linking unanchored initiatives to goals to tidy the report. Goal links change only via initiative frontmatter with member confirmation.
- Omitting or softening the "Not visibly serving any goal" section — its discomfort is the point (P7).
- Slug ids, repo paths, or appendix content leaking into the external rendering.
- Hardcoding a financial goal-progress figure, or printing one without its auditor `asOf` stamp — the report footer must carry the re-source disclaimer.
- Assigning Focus chips from your own ranking, or silently proceeding when the Monday sync note is missing instead of flagging it.
- Skipping Q1b (mid-week closes), rendering a task as open that closed mid-run, or classifying by iteration without checking status.
- Stale DB between enrichment and write — always re-pull (Step 7).
- **`git reset --soft` on a stale working tree** (the 2026-07-29 incident) — follow Step 10's safety rules exactly.
- Long task-ID lists or per-task tables in the body; drop/dormant tasks rendered as live work.
- **Multi-sentence bullets, paragraph-length summary lines, or any card over the hard length caps** (2026-09-16 regression: every card was 3 bullets × 4 sentences).
- Past-due signals swallowed by compression — the appendix inventory plus body chips are both required.
- Saving with a non-empty coverage MISSING list.
- Presenting a subagent's lost output as "no findings" — recover from transcripts (Step 6) or state the loss.
- Black-background HTML; bare `(N sub-tasks)` umbrella rows; generic notes with no artifact/date substance.
- Reusing a generic initiative name across consecutive weeks for sequential-stage work — disambiguate the stage in the title.
- Presenting agent-drafted why/how narrative as member-reviewed when it was not.
- Filling a 🛠 skill-share row from memory, chat, or Slack instead of the registry file; paraphrasing a skill body into its row; ranking or grading skills; dropping a ⏳ pending engineer to make the table look complete; re-listing a skill created before the edition's 7-day window (window rule 2026-10-14); the agent filling the 🧭 new-product walkthrough mark itself or dropping it; the agent authoring a SKILL.md on a member's behalf.
