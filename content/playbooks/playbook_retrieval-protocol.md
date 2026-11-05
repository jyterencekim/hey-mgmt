---
id: playbook_retrieval-protocol
type: playbook
title: Retrieval Protocol
created_at: '2026-06-22'
updated_at: '2026-06-22'
status: active
playbook_version: 1.0.0
tags:
  - Operations
  - Documentation
  - Review
owner: team
relations:
  - type: supports
    target: playbook_codex-agent-compliance-guide
  - type: supports
    target: playbook_file-placement
sources:
  - kind: doc
    ref: content/playbooks/playbook_file-placement.md
    title: File placement and canonical artifact routing
  - kind: doc
    ref: workspace/fisher/README.md
    title: Fisher knowledge search surface
---

# Retrieval Protocol

## Purpose

Prevent agents from answering retrieval questions from the first plausible hit.
This playbook is the shared rule for humans, Codex, Claude Code, Hermes, and
Fisher whenever an answer depends on finding prior repo, git, knowledge, or
external-source context.

## Trigger

Retrieval Proof is REQUIRED when the request cannot be answered correctly
without locating an existing artifact, prior discussion, git history, Slack,
Drive, Gmail, Confluence, Fisher knowledge, attachment, or current repo state.

For ordinary generation, editing, implementation, or drafting work, Retrieval
Proof is only a soft reminder. Do not block the work on RP5 unless the request
or a subtask turns into retrieval.

Common trigger phrases include:

- `find`, `look up`, `what was`, `where is`, `link me`, `previous`, `latest`,
  `recent`, `context`
- `찾아봐`, `뭐였지`, `어디있지`, `링크 줘`, `불러와봐`, `예전에`,
  `저번주`, `최근`, `관련 context`
- `task`, `note`, `meeting`, `decision`, `playbook`, `doc`, `Slack`, `Drive`,
  `Gmail`, `Fisher search`

The trigger is intent-based, not keyword-based. If the user says "that D14 cap
thing" or "the Harvey-style page from yesterday", treat it as retrieval even if
no explicit search verb appears.

## Exception

If the user supplies an exact file path or artifact ID and only asks to edit,
summarize, or inspect that exact object, the agent MAY skip candidate-set and
disconfirmation work. The answer still SHOULD name the source it inspected.

## RP5 Procedure

### RP1. Parse Intent

Separate the retrieval target before searching:

- object type: task, note, meeting, decision, playbook, doc, Slack thread, file
- time window: today, yesterday, last week, current iteration, recent months
- owner or actor: alice, dana, charlie, bob, fisher, agent
- lifecycle: final, done, ready, current, draft, uploaded, attached
- semantic clues: domain terms, numbers, caps, APIs, filenames, partner names

Do not let one clue dominate the rest. Metadata such as `status: done` or
`created_at` is weaker than body text, attachments, and git-history evidence.

### RP2. Generate Candidates

Collect at least three plausible candidates before giving a definitive answer,
unless the exact-file exception applies or fewer than three candidates exist.

Use the narrowest useful source classes first:

1. user-supplied attachments, files, paths, and artifact IDs
2. canonical `content/` and `workspace/` artifacts
3. linked assets such as docx, pdf, html, CSV, screenshots, and meeting exports
4. git log and recent diffs for creation, attachment, closeout, and rename clues
5. Fisher knowledge and external activity index when Slack, Drive, Gmail,
   Confluence, or GitHub activity may contain the source
6. memory or prior-run summaries as hints, not proof
7. broad grep only after narrow sources fail

If fewer than three candidates exist, say why.

### RP3. Expand Terms

Search literal terms and semantic neighbors. Include inverse or adjacent terms
when the user's phrase may not match the artifact wording.

Examples:

| User wording | Expand to |
| --- | --- |
| `deposit cap` | `withdrawal cap`, `bridge cap`, `same-day cap`, `daily cap` |
| `final` | `done`, `ready`, `attached memo`, `updated last week`, `closeout` |
| `D7 외 D14` | `D14`, `14 day`, `liquidity gate`, `ALM`, `severe_d14` |
| `uploaded note` | `meeting`, `asset`, `docx`, `gmail`, `Drive`, `git log` |
| `this week task` | current iteration, owner task list, ready/doing/blocked |

### RP4. Disconfirm The Top Candidate

Before giving one winner, run at least two searches that could prove the top
candidate is wrong.

Examples:

- If a LINE NEXT liquidity memo wins, search `D14`, `5M`, `ALM`, and
  `withdrawal-control` before finalizing.
- If a task list wins, search linked notes, inbox sends, owner-specific work,
  and current-iteration status before saying something is absent.
- If a metric answer wins, search the competing metric names and source tables
  before treating one metric as authoritative.

If RP4 was not done, the agent MUST NOT present a single definitive answer.

### RP5. Answer With Compressed Proof

Always show a short Retrieval Proof. Keep it visible and compact.

Format:

```text
Retrieval proof: checked <N> candidates across <source classes>; disconfirmed
<wrong path or terms>.
Winner: <artifact/source> because <specific matching evidence>.
```

For medium confidence, show ranked candidates:

```text
Retrieval proof: checked <N> candidates across <source classes>; remaining
uncertainty is <gap>.
Best match: <candidate 1> because <evidence>.
Other plausible matches: <candidate 2>, <candidate 3>.
```

For low confidence, do not say "not found" as a blanket claim. Say what was
checked, what clue is missing, and what source should be searched next.

## Confidence Rules

- High confidence: RP2 candidate floor is met or waived with reason, RP4 is
  done, and one candidate has body or attachment evidence matching the user's
  semantic clues.
- Medium confidence: plausible winner exists, but wording, time window, owner,
  or lifecycle evidence conflicts.
- Low confidence: search scope is partial, candidate floor is not met, or
  disconfirmation was not run.

Agents MUST answer with ranked candidates instead of a single answer when
confidence is medium or low.

## Agent Adapters

### Codex

For retrieval-intent requests, Codex MUST follow RP5 before answering. The final
answer MUST include compressed Retrieval Proof.

### Claude Code

Claude Code commands and project prompts SHOULD include this adapter line:

```text
For retrieval-intent requests, follow content/playbooks/playbook_retrieval-protocol.md and show compressed Retrieval Proof.
```

### Hermes And Fisher

Fisher MUST apply RP5 to Slack retrieval questions. Use repo search and
knowledge search together when the source could live in both canonical artifacts
and external activity.

Fisher answers SHOULD keep the proof one or two lines long in Slack.

### Humans

When asking another person or agent to find prior context, expect a short proof:
sources checked, candidates considered, and why the winner is the winner.

## Anti-Patterns

- Answering from one plausible artifact without disconfirming it.
- Treating `done`/`final` metadata as stronger than body or attachment content.
- Searching broad grep first and drowning in noisy hits.
- Saying "not found" without naming checked sources and missing clues.
- Hiding uncertainty when two candidates are plausible.
