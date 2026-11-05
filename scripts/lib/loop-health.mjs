import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadManifest } from './indexer.mjs';
import { listMemberEntries } from './members.mjs';
import { currentIteration } from './iteration.mjs';
import { DIGEST_START } from './loop-digest.mjs';

/** Weekly commitment cap, per decision_adr-three-layer-task-timeline. */
export const ITERATION_CAP = 10;
/** Carry count at which a task blocks the iteration ceremony. */
export const SLIP_THRESHOLD = 3;

const OPEN_STATUSES = new Set(['plan', 'ready', 'doing', 'blocked']);

function kstToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

function shiftDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Date of the newest daily log that carries a scheduled-digest section, or null.
 *
 * The log is the heartbeat because it is the only *tracked* evidence the pass
 * ran. `.hey/loop-digest/<member>.json` is untracked, so it exists on whichever
 * machine the cron runs and nowhere else — a heartbeat nobody else can read is
 * not a heartbeat.
 */
export function hasDigestMarker(text) {
  // The marker counts only as a whole line. A substring search matches prose
  // that merely *mentions* the marker — a member documenting the mechanism, or
  // a log entry quoting it inline — and a heartbeat that can be satisfied by
  // writing about itself is worse than none: it reports healthy while the cron
  // is dead.
  return String(text ?? '')
    .split('\n')
    .some((line) => line.trim() === DIGEST_START);
}

export function lastDigestDate(repoRoot, member) {
  const logDir = resolve(repoRoot, 'workspace', member, 'logs');
  if (!existsSync(logDir)) return null;
  const dates = readdirSync(logDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort()
    .reverse();
  for (const name of dates) {
    if (hasDigestMarker(readFileSync(resolve(logDir, name), 'utf8'))) {
      return name.slice(0, 10);
    }
  }
  return null;
}

/**
 * Has the scheduled pass stalled for a member who opted into ceremony crons?
 *
 * The digest runs daily at 08:30 KST. Before 08:30 today's log legitimately
 * does not exist yet, so yesterday's is the newest acceptable heartbeat — this
 * is the 26h budget from the ceremony runbook, expressed in whole days so it
 * cannot flap around the cron minute.
 *
 * Members who never opted in are not reported: absence of a pass they never
 * enabled is not a failure.
 */
export function checkDigestHeartbeat(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const today = options.today ?? kstToday();
  const oldestAcceptable = shiftDays(today, -1);

  const stale = [];
  for (const entry of listMemberEntries(root)) {
    if (entry?.x_ceremony_cron !== true) continue;
    const last = lastDigestDate(root, entry.name);
    if (last === null) {
      stale.push({ member: entry.name, last_digest: null, days_stale: null });
    } else if (last < oldestAcceptable) {
      const days = Math.round(
        (new Date(`${today}T00:00:00Z`) - new Date(`${last}T00:00:00Z`)) / 86400000,
      );
      stale.push({ member: entry.name, last_digest: last, days_stale: days });
    }
  }
  return { today, oldest_acceptable: oldestAcceptable, stale };
}

/**
 * Backlog health under the three-layer model.
 *
 * The retired metric counted tasks with no `due_date`. That number measures
 * conformance to a model the ADR replaced — no-due-date is the *normal* backlog
 * state — so it fell when dates were stripped and rose when they were added,
 * telling you nothing about health either way.
 *
 * What can genuinely be unhealthy is the layer that now carries the work: the
 * weekly commitment. A member holding 69 tasks in one iteration against a cap
 * of 10 has not committed to anything, and the iteration view becomes
 * decorative. So the number to hold is **committed vs cap**.
 *
 * `x_planned_date` coverage is reported as a diagnostic and never as the
 * headline: the schedule layer is an optional override, and promoting it to the
 * metric would re-create exactly the pressure the ADR removed from `due_date`.
 */
export function buildBacklogHealth(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const iteration = options.iteration ?? currentIteration();
  const manifest = loadManifest(root);
  const members = options.member ? [{ name: options.member }] : listMemberEntries(root);

  const rows = [];
  for (const entry of members) {
    const mine = manifest.filter(
      (item) => item.type === 'task' && item.owner === entry.name && OPEN_STATUSES.has(item.status),
    );
    const committed = mine.filter((item) => item.iteration === iteration);
    const planned = committed.filter((item) => item.planned_date);
    const slipped = committed.filter((item) => Number(item.slip_count ?? 0) >= SLIP_THRESHOLD);
    rows.push({
      member: entry.name,
      committed: committed.length,
      cap: ITERATION_CAP,
      over_cap: Math.max(0, committed.length - ITERATION_CAP),
      within_cap: committed.length <= ITERATION_CAP,
      backlog: mine.length - committed.length,
      planned_coverage: committed.length === 0 ? null : planned.length / committed.length,
      slipped_at_threshold: slipped.length,
    });
  }

  rows.sort((a, b) => b.committed - a.committed);
  return {
    iteration,
    cap: ITERATION_CAP,
    rows: rows.filter((row) => row.committed > 0 || row.backlog > 0),
  };
}

/**
 * Prominent block for `hey validate`, or null when there is nothing to say.
 *
 * This rides the validator because the validator already runs unattended on
 * every file write via hook. A signal that waits for someone to run a checking
 * command is the ritual these checks exist to replace.
 */
export function formatHealthBanner({ heartbeat, health }) {
  const lines = [];

  if (heartbeat.stale.length > 0) {
    lines.push('!! NO SCHEDULED PASS ON RECORD');
    for (const row of heartbeat.stale) {
      lines.push(
        row.last_digest === null
          ? `   ${row.member}: no daily log has ever carried a digest section`
          : `   ${row.member}: last digest ${row.last_digest} (${row.days_stale}d ago, budget 1d)`,
      );
    }
    // State the observation, not the diagnosis. "The cron is down" is an
    // inference, and on 2026-08-19 it would have been wrong — the capability
    // being measured was seven hours old. Point at the runbook and let the
    // reader reach the conclusion with the evidence in front of them.
    lines.push('   Treat this as the automation not reporting, rather than a day being');
    lines.push('   skipped. Confirm on the cron host before concluding it is down:');
    lines.push('   workspace/fisher/ceremony-crons.md (hermes status, hermes cron list).');
  }

  const over = health.rows.filter((row) => !row.within_cap);
  if (over.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`!! ITERATION OVER CAP (${health.iteration}, cap ${health.cap})`);
    for (const row of over) {
      lines.push(`   ${row.member}: ${row.committed} committed, ${row.over_cap} over cap`);
    }
    lines.push('   A commitment this size is not a commitment. Carry or drop before it');
    lines.push('   reads as a plan.');
  }

  return lines.length > 0 ? lines.join('\n') : null;
}
