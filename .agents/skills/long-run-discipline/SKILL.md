---
name: long-run-discipline
description: Rehearse long jobs on real-shaped input before the full run, checkpoint their progress, and keep delegated subagents accountable, so runs don't fail hours in.
owner: dana
applies_to: [acquisition, backfills, model sweeps, migrations, subagents]
updated: 2026-09-29
---

# Long-run discipline

Long jobs and delegated agents tend to fail late and quietly, after the
expensive part is already spent. This skill makes them fail early and cheaply.

## When to use

- Before launching any job expected to run longer than about 15 minutes or to
  spend paid or rate-limited calls: data acquisition, backfills, migrations,
  model training, parameter sweeps, bulk exports.
- Before spawning, checking on, messaging, reviewing or pausing a subagent.

## Index

- Long jobs (preflight, rehearsal, checkpointing, limits, closeout):
  `references/long-jobs.md`.
- Subagents (proving progress without `wait`, message supersession, reviewer
  continuity, pause and resume): `references/delegation.md`.

Read the reference for the situation at hand. This file is an index, not a
procedure.

## The rules on one screen

1. Run cheap checks before expensive work, and stop at the first failure.
2. Rehearse on real-shaped input through the final stage before the full run.
3. Checkpoint the smallest repeatable unit; a retry redoes only what failed.
4. Size every limit from a measurement, with at least 2× headroom.
5. A subagent proves progress in the foreground; the parent verifies it with
   the agent's history and git, not with `wait`.
