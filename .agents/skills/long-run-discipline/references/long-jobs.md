# Long jobs: fail early, not hours in

A long job that fails at its last stage wastes all the time, tokens and paid
calls spent on the earlier stages. Most of those failures (a wrong type, an
empty view, a missing folder, too many connections) can be found in seconds
before the run starts.

## 1. Preflight: cheap checks before expensive work

Run these in order. Stop at the first failure, before spending any paid,
rate-limited or long-running work.

1. **Target schema.** Run the migration tool's list or status command against
   the exact target database. Resolve pending, missing or colliding
   migrations, comparing them by content, not by number. Check sequences
   against table maxima, and check that required reference rows exist.
2. **Real-shaped write.** Prepare or insert one real-shaped row per record kind
   inside a transaction you roll back. This catches type, constraint and
   column errors in seconds.
3. **Read path.** Exercise every table, view and endpoint the job reads with
   one real query each. Include materialized views (are they populated?) and
   any cache the job expects to be warm.
4. **Output layout.** Create and verify the complete output directory or
   object layout, its permissions and its free space before acquiring anything
   time-bounded.
5. **Resources.** Project output size, peak memory, wall time and connection
   count against the host's and the process's limits. Count connections for
   every concurrent worker plus the supervisor plus one spare, not for each
   worker alone.
6. **Inputs and config.** Required files exist and are readable. Check secret
   files for existence and length only; never print them. Confirm the config
   the job will actually load is the one you reviewed.

When a check fails, find every failure of the same kind before the next
attempt. Do not fix one and relaunch.

## 2. Rehearsal: a short run with the real shape

- Run the exact command, binary and config the full run will use, on a small
  but real-shaped slice: one shard or cell, one day, one page, a handful of
  entities. Use a sandbox: a disposable database migrated to head, a private
  copy of the store, an isolated output location. Never debug against
  production outputs.
- The rehearsal reaches the final stage. It writes the output, and the
  downstream consumer loads it. A rehearsal that stops after the first stage
  proves nothing about the last one.
- Shrink volume, not variety. Keep the real schema, every record kind, real
  value ranges and the edge cases: decimals, nulls, timestamp precision,
  empty pages.
- **Modeling sweeps:** run one cell end to end with the production config.
  Confirm its checkpoint is written, describes its own settings, and loads.
  Then launch the grid.
- **When scale itself is the risk** (memory, locks, connection pools, output
  size): rehearse at full volume in the sandbox, or measure on the slice and
  extrapolate explicitly, with headroom.
- Record the rehearsal's measured time and memory, and the planned
  parallelism, before the full run.

## 3. During the run: checkpoint and resume

- Producers are committed scripts, not one-off files in `/tmp`.
- Save progress in the smallest unit that is safe to repeat (a page, a day, a
  candidate, a cell), one checkpoint per unit. Resume skips units that already
  exist.
- A retry redoes only the failed units, and never re-fetches paid or
  rate-limited work that already completed.
- Every setting that varies between units is written inside the output, not
  only in its filename. Resume logic that keys on filenames alone will reuse
  wrong results silently.
- Never change output naming or meaning while units are in flight. If you
  must: stop or drain the producer, write an explicit old-to-new map, apply it
  once, have someone check the map, then rerun the gaps. Keep superseded
  outputs in a labelled folder instead of overwriting them.
- Logs live next to the outputs, not in `/tmp`, so a dead worker's history
  survives. Background jobs use absolute paths and set their working directory
  explicitly.
- Kill stragglers before relaunching. Never let two producers write the same
  checkpoint location.
- Shard with private copies of any single-writer store. Keep parallelism
  within the measured provider and host budget.
- Watch the job's real completion signal and exit code. A pipe that truncates
  output can hide a failure.

## 4. Limits come from measurements

- Every byte, row, time, memory or timeout limit names the measured value it
  was sized from (production, or the rehearsal), with at least 2× headroom.
- A test exercises a value above the old limit.
- No arbitrary constants.
- A number that contradicts an earlier one most likely means a broken
  instrument, not a changed world. Check the instrument and re-measure before
  reporting it.

## 5. Closeout

- A passing rehearsal or sandbox run is not acceptance.
- Report what ran (command, commit, inputs), its output and exit code, the
  checks you skipped, and what remains.
- State only measured numbers, with the command or file they came from.

## Why this exists

Real incidents, each of which a cheap check would have caught:

- A pipeline spent 30 min 55 s producing its inputs; the next reader then
  failed in 1.23 s because a materialized view it depended on had been created
  but never populated. (Preflight step 3.)
- An output folder was created without a required subfolder, so the final
  atomic rename failed after all the data had been acquired. It happened three
  times. (Step 4.)
- A daily history job's first production run failed 45 minutes in, at stage
  3, on a SQL type error. (Step 2.)
- Parallel workers exhausted a database's 7 usable connection slots, because
  preflight had tested each worker's connection alone. (Step 5.)
- A publisher read an entire 122 GB backup into memory. Projecting from two
  small controlled inputs showed it would need about 126 GB on a 16 GB host.
  (Step 5.)
