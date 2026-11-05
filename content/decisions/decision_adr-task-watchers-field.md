---
id: decision_adr-task-watchers-field
type: decision
title: 'ADR: Add a canonical `watchers` field for standing cc/notify association'
created_at: '2026-06-02'
updated_at: '2026-06-02'
decision_status: accepted
owners:
  - team
tags:
  - Operations
  - Engineering
  - Automation
  - General
area: Team
sources:
  - url: >-
      https://docs.github.com/en/account-and-profile/managing-subscriptions-and-notifications-on-github/setting-up-notifications/about-notifications
    title: >-
      GitHub — watching as a standing subscription that surfaces updates (the
      watchers metaphor)
  - url: 'https://en.wikipedia.org/wiki/Responsibility_assignment_matrix'
    title: >-
      RACI — Accountable (owner) vs Informed (watcher) are distinct roles, not
      the same person
relations:
  - type: mentions
    target: decision_adr-loop-control-driver-surface
owner: team
---

## Context

Artifacts have a single `owner` (the accountable person) and an event-based
notification mechanism, `./hey inbox send`, for telling another member about a
task once. Neither expresses a **standing association** — "person X is not the
owner, but should keep seeing this task until it closes."

This gap surfaced on `task_delete-or-repoint-dangling-adm`: Charlie owns the
DNS deletion, but Bob should stay looped in. The only options were (a) a
free-text "cc bob" prose line — invisible to tooling, or (b) a one-time
inbox send — which notifies once but never re-surfaces. A frontmatter field was
the missing primitive.

The schema (`scripts/lib/frontmatter-schema.mjs`) is a strict allowlist that
already permits `x_*` extension fields, so `x_cc` would validate with zero code.
But an association field that no tooling **surfaces** is a footgun: it looks
like the cc'd person is informed when nothing ever shows them the task. That is
strictly worse than an inbox send. If we add the field, the loop surface must
honor it.

## Decision

**Add a canonical `watchers` field** (array of member names) to the common
frontmatter schema, and **make the loop surface honor it**: a member sees a task
on their loop board/brief when they are its `owner` **or** listed in its
`watchers`.

Naming: `watchers` (the issue-tracker metaphor: a standing list that surfaces
updates), not `cc` (the email metaphor: a one-time copy). It reads correctly
next to the existing `owner` / `owners` / `attendees` member fields.

### Semantics

- `watchers` is a list of **member names**, validated against
  `content/vocab/members.yml` (a **warning**, like `owner`/`owners`/`attendees`,
  not a hard error — registries lag reality).
- A non-array value is a schema **error** (`watchers must be an array of
  non-empty strings`).
- **Ownership is unchanged.** A watcher is not accountable. Cards still display
  the real `owner`; `by_owner` indexing and ownership filters are untouched.
- **Notification is unchanged.** `watchers` is a standing association, not an
  event. To actively ping someone, still use `./hey inbox send`. The two
  compose (add to `watchers` *and* inbox-send on first add).

### v1 surfacing scope (deliberately minimal)

A watched task appears in the watcher's loop board in **its natural lane** (e.g.
a blocked watched task shows under "Needs unblock"), with the card showing the
real owner. We did **not** add a separate "Watching" lane. If watched tasks
prove noisy in a watcher's *actionable* lanes, a dedicated informational lane is
the documented next step — not a reason to block v1.

## Alternatives considered

- **`x_cc` extension field (no code).** Validates today, but inert — never
  surfaces to the cc'd member. Rejected: the footgun above.
- **Inbox send only.** Already exists; notifies once but does not persist or
  re-surface. Kept as the complementary *event* mechanism, not a replacement.
- **Name it `cc`.** Matches casual usage but implies one-time-copy semantics;
  `watchers` better matches the standing-surface behavior.
- **Separate "Watching" lane now.** More correct, more surface area (LOOP_LANES,
  renderers, brief). Deferred to keep v1 simple.

## Consequences

- New canonical field `watchers` allowed on any artifact type (it lives in
  `COMMON_FIELDS`); primarily meaningful on tasks.
- `scripts/lib/indexer.mjs` carries `watchers` into the manifest so loop-control
  can read it; `taskMatchesScope` matches owner-or-watcher.
- Member-validated via the existing `validateMembersArray` helper; covered by
  tests in `frontmatter-schema.test.mjs`.
- Tooling that lists "my tasks" by `owner` alone (e.g. overdue triage) is **not**
  changed — watchers intentionally do not inherit owner duties. Revisit per
  surface if watcher visibility is wanted there too.
