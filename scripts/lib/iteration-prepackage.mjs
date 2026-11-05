import { resolve } from 'node:path';
import { loadManifest } from './indexer.mjs';
import { currentIteration, nextIteration } from './iteration.mjs';
import { buildCarryPlan, formatCarryPlan } from './iteration-carry.mjs';
import { buildHygieneReport, formatHygieneReport } from './hygiene.mjs';

// D4 (note_automated-initiative-task-hygiene-strategy): weekly commitment is
// capped per member; the cap applies to iteration membership.
export const WEEKLY_COMMITMENT_CAP = 10;

const OPEN_STATUSES = new Set(['plan', 'ready', 'doing', 'blocked']);
const CLOSED_STATUSES = new Set(['done', 'archived']);

function dateOnly(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function kstToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

/**
 * Precompute everything mechanical the iteration-turn ceremony needs (P3):
 * carry candidates with slip counts (dry plan — nothing written), the hygiene
 * batch, the closing week's done/archived list, and per-member commitment
 * counts against the weekly cap. The ceremony is reduced to decisions.
 */
export async function buildIterationPrepackage(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const today = dateOnly(options.today) ?? kstToday();
  const closing = options.closing ?? currentIteration(new Date(`${today}T12:00:00`));
  const next = nextIteration(closing);
  if (!next) throw new Error(`--closing must use YYYY-WNN format (got: ${closing})`);

  const carry = buildCarryPlan(root, { to: next, from: closing, today });

  const hygiene = await buildHygieneReport(root, {
    today,
    pr: options.pr,
    concurrency: options.concurrency,
    prReport: options.prReport,
    fetcher: options.fetcher,
  });

  const tasks = loadManifest(root).filter((item) => item.type === 'task');

  const closed = tasks
    .filter((item) => item.iteration === closing && CLOSED_STATUSES.has(item.status))
    .map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      owner: item.owner ?? '(unowned)',
    }))
    .sort((a, b) => a.owner.localeCompare(b.owner) || a.id.localeCompare(b.id));

  const committedNext = new Map();
  for (const item of tasks) {
    if (item.iteration !== next || !OPEN_STATUSES.has(item.status)) continue;
    const owner = item.owner ?? '(unowned)';
    committedNext.set(owner, (committedNext.get(owner) ?? 0) + 1);
  }
  const carryIncoming = new Map();
  for (const entry of carry.carried) {
    const owner = entry.owner ?? '(unowned)';
    carryIncoming.set(owner, (carryIncoming.get(owner) ?? 0) + 1);
  }

  const owners = [...new Set([...committedNext.keys(), ...carryIncoming.keys()])].sort();
  const capacity = owners.map((owner) => {
    const committed = committedNext.get(owner) ?? 0;
    const incoming = carryIncoming.get(owner) ?? 0;
    const projected = committed + incoming;
    return {
      owner,
      committed_next: committed,
      carry_incoming: incoming,
      projected,
      cap: WEEKLY_COMMITMENT_CAP,
      over_cap: projected > WEEKLY_COMMITMENT_CAP,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    today,
    closing,
    next,
    carry,
    hygiene,
    closed,
    capacity,
  };
}

export function formatIterationPrepackage(pkg) {
  const lines = [
    '',
    `Iteration prepackage — closing ${pkg.closing} → ${pkg.next} (${pkg.today})`,
    'Read-only pre-computation for the iteration-turn ceremony. Nothing below is applied.',
  ];

  lines.push(formatCarryPlan(pkg.carry, { dryRun: true }).trimEnd(), '');
  lines.push(formatHygieneReport(pkg.hygiene).trimEnd(), '');

  lines.push(`Done or archived in ${pkg.closing} (${pkg.closed.length})`);
  for (const task of pkg.closed) {
    lines.push(`  - ${task.title} (${task.id}, ${task.status}, ${task.owner})`);
  }
  if (pkg.closed.length === 0) lines.push(`  (nothing closed on iteration ${pkg.closing})`);
  lines.push('');

  lines.push(`Capacity for ${pkg.next} (cap ${WEEKLY_COMMITMENT_CAP} per member)`);
  for (const row of pkg.capacity) {
    const flag = row.over_cap ? ` — OVER CAP by ${row.projected - row.cap}` : '';
    lines.push(`  - ${row.owner}: ${row.committed_next} committed + ${row.carry_incoming} carry incoming = ${row.projected}${flag}`);
  }
  if (pkg.capacity.length === 0) lines.push('  (no commitments or carry candidates)');
  lines.push('');

  return lines.join('\n');
}
