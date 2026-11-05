---
id: decision_adr-display-task-titles-not-ids
type: decision
title: 'ADR: Display task titles on member-facing surfaces, not IDs'
created_at: '2026-04-17'
updated_at: '2026-04-17'
decision_status: accepted
owners:
  - team
tags:
  - Operations
  - Documentation
  - General
sources:
  - url: 'https://www.nngroup.com/articles/how-users-read-on-the-web/'
    title: How Users Read on the Web — scanning over reading (Nielsen Norman Group)
  - url: 'https://en.wikipedia.org/wiki/Intention-revealing_interface'
    title: >-
      Intention-Revealing Interface — names should reveal purpose, not
      implementation (Fowler / domain-driven design)
area: Team
owner: team
---

## Context

Tasks live in `content/tasks/**/task_*.md`. Each task has a slug `id` (e.g.
`task_switch-backend-appconfig-to-su`) derived from the filename, and a
human-readable `title` (e.g. "Switch backend app.config to subgraph v0.5.5
and roll out").

In day-to-day output — daily plans, standups, morning routines, search
summaries, inbox listings, conversational responses — the slug id leaks into
presentation layers even when a human is the reader. The id is:

- Truncated at ~33 chars by repo convention, so it often ends mid-word
  (`...to-su`, `...fol`) and loses meaning.
- Optimized for filenames, URLs, and cross-references — not for scanning.
- Opaque to anyone who didn't file the task themselves.

When a member reads "task_switch-backend-appconfig-to-su (`do`, due …)",
they have to translate the slug back to what the task actually is. This is
friction the repo creates for itself.

## Decision

**On member-facing surfaces, lead with the task `title`. Include the `id`
only when needed for disambiguation or navigation, and when included, put
it in backticks after the title.**

### Preferred format

```
- Switch backend app.config to subgraph v0.5.5 and roll out
  (`task_switch-backend-appconfig-to-su`, `do`, due 2026-04-15)
```

### Not acceptable

```
- task_switch-backend-appconfig-to-su (`do`, due 2026-04-15)  ← title missing
```

### Applies to

- Daily plans (`workspace/{member}/logs/YYYY-MM-DD.md` Plan section)
- Morning / night / snap / standup output
- `/whatnext`, `/check`, `/assess`, `/search` human-readable summaries
- Inbox listings that reference tasks
- Slack-ready blocks produced by any command
- Conversational responses citing a task

### Does NOT apply to

- Mechanical machine output: `./hey db query` JSON, `./hey search` raw
  JSON, validator errors, test logs. These naturally key on `id`.
- Cross-artifact references inside committed files where the `id` is the
  link target (frontmatter `relations:`, `depends_on:`, inline
  `task_…` tokens used as identifiers).
- Commit messages, which are governed by the style guide and may cite
  `id` directly for grep-ability.

## Consequences

### Positive

- Members don't have to translate slugs back into intent on every surface
  they scan. Scanning a daily plan becomes cheaper.
- Titles evolve (tasks get renamed, scope shifts); display that tracks
  `title` stays current automatically.
- Ids remain present for grep/link, just demoted to secondary.

### Negative

- Longer lines. A title can be 60–100 chars where the id is ~33. Daily
  plans get denser.
- Commands that currently dump ids must be updated to fetch and render
  `title` too. One-line changes in most cases (`./hey db query` already
  selects `title`), but every human-facing formatter needs a pass.
- Titles aren't unique; if two tasks have similar titles, the id in
  parens is what disambiguates.

## Alternatives Considered

1. **Display id + title together, always** — verbose. Rejected: the id
   is rarely useful on a first scan. Putting it in parens after the
   title is the right default.
2. **Display title only, never id** — breaks navigation. You can't
   `./hey search` for a task you only know the title of without
   round-tripping through fuzzy search. Rejected.
3. **Leave it to per-command discretion** — status quo, which is how
   we ended up with id-first displays everywhere. Rejected: needs a
   repo-level rule to stick.
