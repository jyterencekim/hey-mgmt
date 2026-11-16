# Delegating to subagents

Sessions have lost hours to three failures:
- agents that ended a turn waiting on a background job that never woke them;
- a revived agent that answered a stale message first and redid overtaken
  work;
- a merge that landed on an approval given for an older branch head.

## Before spawning

- Give each subagent one bounded goal: the exact files or scope, the non-goals,
  the command that proves it is done, and the point where it must stop.
- Name the branch and base commit it works from.
- A long job inside a subagent follows `long-jobs.md`: preflight and rehearsal
  first.

## A subagent never ends a turn waiting

A background job's result does not wake the agent that started it, and a
stalled turn looks identical to a finished one from outside. So a subagent:

- runs verification in the foreground, split into chunks that each fit under
  the tool timeout;
- reports every command's exit code and pass/fail counts as it goes, not only
  a final summary;
- if a step cannot finish in one turn, ends the turn after making and reporting
  real progress on a bounded next chunk, never parked on a promise that
  something else will finish it.

## The parent checks progress; it does not just wait

`wait` on a job handle only says whether that handle resolved. It says nothing
about whether the agent is still working, stuck, or has quietly stopped.
Before concluding an agent is stalled or done, check:

- the agent's transcript or history for what it actually did in its latest
  turns;
- `git log` and `git status` in the agent's own worktree. Real commits and an
  expected tree are the signal.

Verify an agent's claims yourself before relaying them to anyone else.

## Messages are self-contained; the newest wins

- Every message names the agent's branch and base commit, so the agent never
  has to reconstruct context from an earlier message.
- An agent that wakes to several queued messages reads them in order but acts
  only on the newest. Older messages are superseded; they are not re-executed,
  re-answered or treated as still pending.

## One reviewer per branch, across every round

- A branch keeps the same reviewer from its first round to its last. A handoff
  mid-review loses earlier context.
- Merge only on an approval given at the exact branch head being merged.
  Compare the head the approval names with `git rev-parse <branch>`. A fix
  after approval needs a short reconfirmation at the new head.

## Pausing

1. List the agents that are awake (running or idle) and message only those. A
   message to a parked agent revives it into more of the paused work.
2. Cancel the jobs of every agent you message.
3. Record, per agent: its branch head commit, any uncommitted changes in its
   worktree, and anything it left running or locked on a host. This record is
   what lets work resume exactly where it stopped.

## Resuming

Send each agent exactly one message with its current priorities. Do not send
catch-up batches or repeat the pause message. The agent acts only on its newest
message, so every extra one is a message it has to recognise as superseded.
