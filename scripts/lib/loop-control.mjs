import { resolve } from 'node:path';
import { loadManifest } from './indexer.mjs';
import { currentIteration, nextIteration } from './iteration.mjs';
import { listInboxItems } from './inbox.mjs';
import { listScheduledActionPackets } from './scheduled-packets.mjs';
import { groupRunAttemptsByTask, listRunAttempts, summarizeRunAttempts } from './work-runs.mjs';

export const LOOP_LANES = [
  'Needs decision',
  'Needs unblock',
  'Needs review',
  'Needs attention',
  'In flight',
  'Ready queue',
  'Done since last brief',
  'Safe background',
];

function dateOnly(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : raw;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseToday(value) {
  return value ? new Date(`${dateOnly(value)}T00:00:00.000Z`) : new Date();
}

function includesDecisionSignal(item) {
  const text = `${item.title ?? ''} ${item.id ?? ''}`.toLowerCase();
  return /\b(decide|decision|approve|approval|sign-off|choose)\b/.test(text)
    || text.includes('결정')
    || text.includes('승인');
}

function activeBlockers(item, manifestById, terminalStates) {
  const blockers = (item.relations_out ?? []).filter((relation) => relation.type === 'blocked_by');
  return blockers.filter((blocker) => {
    const target = manifestById.get(blocker.target);
    if (!target) return true;
    return !terminalStates.has(target.status);
  });
}

function taskMatchesScope(item, member, iteration) {
  if (member && item.owner !== member && !(item.watchers ?? []).includes(member)) return false;
  if (iteration && item.iteration !== iteration) return false;
  return true;
}

function buildCard(item, options) {
  const {
    runs = [],
    manifestById,
    terminalStates,
    todayDate,
    doneSinceDate,
  } = options;

  const reasons = [];
  const blockers = activeBlockers(item, manifestById, terminalStates);
  const runSummary = summarizeRunAttempts(runs);
  const activeRuns = runs.filter((run) => run.status === 'in_progress');
  const dueDate = dateOnly(item.due_date);
  const updatedAt = dateOnly(item.updated_at);
  const phase = item.phase ?? null;
  let lane = 'Safe background';

  if (terminalStates.has(item.status)) {
    if (item.status === 'done' && updatedAt && updatedAt >= isoDate(doneSinceDate)) {
      lane = 'Done since last brief';
      reasons.push(`done since ${isoDate(doneSinceDate)}`);
    } else {
      lane = 'Safe background';
      reasons.push(`terminal status is ${item.status}`);
    }
  } else if (item.status === 'blocked' || blockers.length > 0) {
    lane = 'Needs unblock';
    if (item.status === 'blocked') reasons.push('status is blocked');
    for (const blocker of blockers) reasons.push(`blocked_by ${blocker.target}`);
  } else if (activeRuns.length > 1) {
    lane = 'Needs unblock';
    reasons.push('multiple active runs on one task');
  } else if (includesDecisionSignal(item)) {
    lane = 'Needs decision';
    reasons.push('decision signal in title or id');
  } else if (phase === 'awaiting_review' || phase === 'review') {
    lane = 'Needs review';
    reasons.push(`phase is ${phase}`);
  } else if (dueDate && dueDate < isoDate(todayDate) && !terminalStates.has(item.status)) {
    lane = 'Needs attention';
    reasons.push(`overdue since ${dueDate}`);
  } else if (item.status === 'doing' || activeRuns.length === 1) {
    lane = 'In flight';
    if (item.status === 'doing') reasons.push('status is doing');
    if (activeRuns.length === 1) reasons.push(`active run ${activeRuns[0].run_id}`);
  } else if (item.status === 'ready') {
    lane = 'Ready queue';
    reasons.push('status is ready');
  } else {
    reasons.push(`status is ${item.status ?? 'none'}`);
  }

  return {
    id: item.id,
    title: item.title,
    status: item.status,
    phase,
    owner: item.owner ?? null,
    area: item.area ?? null,
    priority: item.priority ?? null,
    due_date: dueDate,
    iteration: item.iteration ?? null,
    updated_at: item.updated_at ?? null,
    path: item.path,
    lane,
    reasons,
    blockers: blockers.map((blocker) => blocker.target),
    agent_runs: runSummary,
  };
}

export function buildLoopBoard(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const manifest = loadManifest(root);
  const member = options.member ?? null;
  const iteration = options.iteration ?? null;
  const todayDate = parseToday(options.today);
  const doneSinceDays = Number(options.doneSinceDays ?? 7);
  const doneSinceDate = addDays(todayDate, -doneSinceDays);
  const terminalStates = new Set(['done', 'archived']);
  const manifestById = new Map(manifest.map((item) => [item.id, item]));
  const allRuns = listRunAttempts(root, { limit: Number(options.runLimit ?? 200) });
  const runsByTask = groupRunAttemptsByTask(allRuns);

  const lanes = Object.fromEntries(LOOP_LANES.map((lane) => [lane, []]));

  const tasks = manifest
    .filter((item) => item.type === 'task')
    .filter((item) => taskMatchesScope(item, member, iteration))
    .filter((item) => item.status !== 'archived');

  for (const item of tasks) {
    const runs = runsByTask.get(item.id) ?? [];
    const card = buildCard(item, {
      runs,
      manifestById,
      terminalStates,
      todayDate,
      doneSinceDate,
    });
    lanes[card.lane].push(card);
  }

  for (const lane of LOOP_LANES) {
    lanes[lane].sort((a, b) => {
      const priorityOrder = { do: 0, plan: 1, routine: 2, drop: 3 };
      const left = priorityOrder[a.priority] ?? 99;
      const right = priorityOrder[b.priority] ?? 99;
      if (left !== right) return left - right;
      if ((a.due_date ?? '') !== (b.due_date ?? '')) return (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99');
      return a.id.localeCompare(b.id);
    });
  }

  return {
    generated_at: new Date().toISOString(),
    member,
    iteration,
    done_since: isoDate(doneSinceDate),
    lanes,
    counts: Object.fromEntries(LOOP_LANES.map((lane) => [lane, lanes[lane].length])),
    undated: summarizeUndated(tasks),
  };
}

/**
 * Count open tasks carrying no due date.
 *
 * A task without a due date can never become overdue, so it never reaches the
 * board's attention lanes or the horizon's dated buckets. Without this summary
 * a growing undated pile reads as a healthy backlog.
 */
export function summarizeUndated(tasks) {
  const terminal = new Set(['done', 'archived', 'cancelled']);
  const open = tasks.filter((item) => !terminal.has(item.status));
  const isUndated = (item) => !dateOnly(item.due_date);
  const byOwner = new Map();

  for (const item of open) {
    const owner = item.owner ?? '(unowned)';
    const entry = byOwner.get(owner) ?? { owner, open: 0, undated: 0 };
    entry.open += 1;
    if (isUndated(item)) entry.undated += 1;
    byOwner.set(owner, entry);
  }

  const ratio = (undated, total) => (total === 0 ? 0 : Number((undated / total).toFixed(4)));
  const undatedTotal = open.filter(isUndated).length;

  return {
    open_total: open.length,
    undated_total: undatedTotal,
    ratio: ratio(undatedTotal, open.length),
    by_owner: [...byOwner.values()]
      .map((entry) => ({ ...entry, ratio: ratio(entry.undated, entry.open) }))
      .sort((a, b) => b.undated - a.undated || a.owner.localeCompare(b.owner)),
  };
}

export function buildLoopBrief(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const member = options.member ?? null;
  const today = dateOnly(options.today ?? new Date().toISOString());
  const board = buildLoopBoard(root, options);
  const inbox_open = member
    ? listInboxItems({ repoRoot: root, workspace: member, status: 'open', includeAll: false })
    : [];
  const due_packets = listScheduledActionPackets(root, {
    member,
    dueBefore: today,
    status: 'active',
  });
  const active_runs = listRunAttempts(root, {
    status: 'in_progress',
    limit: Number(options.runLimit ?? 50),
  });

  const recommendations = [
    ...board.lanes['Needs decision'],
    ...board.lanes['Needs unblock'],
    ...board.lanes['Needs review'],
    ...board.lanes['Needs attention'],
  ].slice(0, Number(options.recommendationLimit ?? 10));

  return {
    generated_at: new Date().toISOString(),
    member,
    today,
    board_counts: board.counts,
    undated: board.undated,
    recommendations,
    inbox_open,
    due_packets,
    active_runs,
    lanes: board.lanes,
  };
}

export const HORIZON_BUCKETS = [
  'Planned today',
  'Today',
  'Rest of this week',
  'Next week',
  '+14d window',
  '+30d window',
  'Beyond 30d',
  'No due date',
];

function endOfIsoWeek(date) {
  // ISO week ends Sunday. getUTCDay(): Sun=0, Mon=1, ..., Sat=6.
  // Days until Sunday = (7 - day) % 7, where Sun->0.
  const day = date.getUTCDay();
  const offset = day === 0 ? 0 : 7 - day;
  return addDays(date, offset);
}

function bucketForDate(dueDate, todayDate) {
  if (!dueDate) return 'No due date';
  const todayIso = isoDate(todayDate);
  if (dueDate < todayIso) return null; // overdue handled by board, not horizon
  if (dueDate === todayIso) return 'Today';
  const endThisWeek = isoDate(endOfIsoWeek(todayDate));
  if (dueDate <= endThisWeek) return 'Rest of this week';
  const endNextWeek = isoDate(addDays(endOfIsoWeek(todayDate), 7));
  if (dueDate <= endNextWeek) return 'Next week';
  const fourteen = isoDate(addDays(todayDate, 14));
  if (dueDate <= fourteen) return '+14d window';
  const thirty = isoDate(addDays(todayDate, 30));
  if (dueDate <= thirty) return '+30d window';
  return 'Beyond 30d';
}

export function buildLoopHorizon(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const manifest = loadManifest(root);
  const member = options.member ?? null;
  const iteration = options.iteration ?? null;
  const todayDate = parseToday(options.today);
  const includeUndated = options.includeUndated !== false;
  const includeBeyond = options.includeBeyond !== false;
  const terminalStates = new Set(['done', 'archived', 'cancelled']);
  const manifestById = new Map(manifest.map((item) => [item.id, item]));

  const buckets = Object.fromEntries(HORIZON_BUCKETS.map((b) => [b, []]));

  const tasks = manifest
    .filter((item) => item.type === 'task')
    .filter((item) => taskMatchesScope(item, member, iteration))
    .filter((item) => !terminalStates.has(item.status));

  for (const item of tasks) {
    const dueDate = dateOnly(item.due_date);
    const plannedDate = dateOnly(item.planned_date);
    // `x_planned_date` is the schedule layer: what the member actually intends
    // to work on today. It leads the horizon, and it wins over the due-date
    // bucket — including over the overdue skip, since a hard deadline that is
    // also planned for today is exactly what should be visible today.
    //
    // Only *today's* plan gets this treatment. A past x_planned_date is NOT an
    // alarm — per decision_adr-three-layer-task-timeline a missed plan returns
    // to the iteration's unplanned pool — so it falls through to normal
    // due-date bucketing and never creates an overdue-like signal.
    const bucket = plannedDate === isoDate(todayDate)
      ? 'Planned today'
      : bucketForDate(dueDate, todayDate);
    if (!bucket) continue; // overdue — skip, surfaced by board
    if (bucket === 'No due date' && !includeUndated) continue;
    if (bucket === 'Beyond 30d' && !includeBeyond) continue;

    const card = buildCard(item, {
      runs: [],
      manifestById,
      terminalStates: new Set(['done', 'archived']),
      todayDate,
      doneSinceDate: todayDate,
    });
    buckets[bucket].push({
      kind: 'task',
      id: card.id,
      title: card.title,
      status: card.status,
      due_date: card.due_date,
      planned_date: dateOnly(item.planned_date),
      lane: card.lane,
      priority: card.priority,
      iteration: card.iteration,
      owner: card.owner,
    });
  }

  const packets = listScheduledActionPackets(root, {
    member,
    status: 'active',
  });
  for (const packet of packets) {
    const trigger = dateOnly(packet.trigger_date);
    const bucket = bucketForDate(trigger, todayDate);
    if (!bucket) continue;
    if (bucket === 'No due date' && !includeUndated) continue;
    if (bucket === 'Beyond 30d' && !includeBeyond) continue;
    buckets[bucket].push({
      kind: 'packet',
      id: packet.id,
      title: packet.title,
      due_date: trigger,
      owner: packet.owner ?? null,
    });
  }

  for (const bucket of HORIZON_BUCKETS) {
    buckets[bucket].sort((a, b) => {
      if ((a.due_date ?? '') !== (b.due_date ?? '')) {
        return (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99');
      }
      const priorityOrder = { do: 0, plan: 1, routine: 2, drop: 3 };
      const left = priorityOrder[a.priority] ?? 99;
      const right = priorityOrder[b.priority] ?? 99;
      if (left !== right) return left - right;
      return (a.id ?? '').localeCompare(b.id ?? '');
    });
  }

  return {
    generated_at: new Date().toISOString(),
    member,
    iteration,
    today: isoDate(todayDate),
    buckets,
    counts: Object.fromEntries(HORIZON_BUCKETS.map((b) => [b, buckets[b].length])),
    iteration_view: buildIterationView(tasks, todayDate),
  };
}

/**
 * Week-based commitment view alongside the due-date windows (P1, D1).
 *
 * The timeline unit humans track is the iteration, not the date: once
 * wish-dates are stripped to backlog, most open tasks have no due_date, and
 * without these buckets the forward view would go blank.
 */
function buildIterationView(tasks, todayDate) {
  // Local-noon construction keeps the ISO week stable in every timezone.
  const current = currentIteration(new Date(`${isoDate(todayDate)}T12:00:00`));
  const next = nextIteration(current);
  const buckets = { this_iteration: [], next_iteration: [], backlog: [] };

  for (const item of tasks) {
    const entry = {
      kind: 'task',
      id: item.id,
      title: item.title,
      status: item.status,
      due_date: dateOnly(item.due_date),
      planned_date: dateOnly(item.planned_date),
      priority: item.priority ?? null,
      iteration: item.iteration ?? null,
      owner: item.owner ?? null,
    };
    if (item.iteration === current) buckets.this_iteration.push(entry);
    else if (item.iteration === next) buckets.next_iteration.push(entry);
    else if (!item.iteration && !entry.due_date) buckets.backlog.push(entry);
  }

  for (const bucket of Object.values(buckets)) {
    bucket.sort((a, b) => {
      const left = a.planned_date ?? a.due_date ?? '9999-99-99';
      const right = b.planned_date ?? b.due_date ?? '9999-99-99';
      if (left !== right) return left.localeCompare(right);
      const priorityOrder = { do: 0, plan: 1, routine: 2, drop: 3 };
      const leftPriority = priorityOrder[a.priority] ?? 99;
      const rightPriority = priorityOrder[b.priority] ?? 99;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return a.id.localeCompare(b.id);
    });
  }

  return {
    current,
    next,
    buckets,
    counts: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.length])),
  };
}

export function formatLoopHorizon(horizon) {
  const lines = ['', `Horizon${horizon.member ? ` for ${horizon.member}` : ''} (${horizon.today})`, ''];
  for (const bucket of HORIZON_BUCKETS) {
    const items = horizon.buckets[bucket] ?? [];
    if (items.length === 0) continue;
    lines.push(`${bucket} (${items.length})`);
    for (const item of items) {
      const due = item.due_date ? ` due:${item.due_date}` : '';
      const plan = item.planned_date ? ` plan:${item.planned_date}` : '';
      const tag = item.kind === 'packet' ? '[packet]' : `[${item.status ?? '-'}${item.lane && item.lane !== 'Ready queue' && item.lane !== 'In flight' && item.lane !== 'Safe background' ? ` ${item.lane}` : ''}]`;
      lines.push(`  - ${item.id} ${tag}${plan}${due} ${item.title}`);
    }
    lines.push('');
  }
  if (lines.length === 3) {
    lines.push('  (nothing in the date-window horizon — either no upcoming dates or filters excluded everything)');
    lines.push('');
  }

  const view = horizon.iteration_view;
  if (view) {
    const sections = [
      [`This iteration (${view.current})`, view.buckets.this_iteration],
      [`Next iteration (${view.next})`, view.buckets.next_iteration],
      ['Backlog (no due date, no iteration)', view.buckets.backlog],
    ];
    for (const [label, items] of sections) {
      lines.push(`${label} (${items.length})`);
      for (const item of items.slice(0, 20)) {
        const plan = item.planned_date ? ` plan:${item.planned_date}` : '';
        const due = item.due_date ? ` due:${item.due_date}` : '';
        lines.push(`  - ${item.id} [${item.status ?? '-'}]${plan}${due} ${item.title}`);
      }
      if (items.length > 20) lines.push(`  ... ${items.length - 20} more`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function formatLoopBoard(board) {
  const lines = ['', `Loop board${board.member ? ` for ${board.member}` : ''}`, ''];
  for (const lane of LOOP_LANES) {
    const cards = board.lanes[lane] ?? [];
    lines.push(`${lane} (${cards.length})`);
    for (const card of cards.slice(0, 20)) {
      const due = card.due_date ? ` due:${card.due_date}` : '';
      const runs = card.agent_runs.total ? ` runs:${card.agent_runs.total}` : '';
      lines.push(`  - ${card.id} [${card.status ?? '-'}${due}${runs}] ${card.title}`);
    }
    if (cards.length > 20) lines.push(`  ... ${cards.length - 20} more`);
    lines.push('');
  }
  lines.push(...formatUndatedLines(board.undated));
  return lines.join('\n');
}

export function formatUndatedLines(undated) {
  if (!undated || undated.open_total === 0) return [];
  const pct = (value) => `${Math.round(value * 100)}%`;
  const lines = [
    `No due date (${undated.undated_total} of ${undated.open_total} open, ${pct(undated.ratio)})`,
    '  Undated tasks never go overdue, so they never reach the lanes above.',
  ];
  if (undated.by_owner.length > 1) {
    for (const entry of undated.by_owner) {
      lines.push(`  - ${entry.owner}: ${entry.undated} / ${entry.open} (${pct(entry.ratio)})`);
    }
  }
  lines.push('');
  return lines;
}

export function formatLoopBrief(brief) {
  const lines = ['', `Loop brief${brief.member ? ` for ${brief.member}` : ''} (${brief.today})`, ''];
  lines.push('Counts');
  for (const lane of LOOP_LANES) {
    lines.push(`  - ${lane}: ${brief.board_counts[lane] ?? 0}`);
  }
  if (brief.undated?.open_total) {
    lines.push(`  - No due date: ${brief.undated.undated_total} of ${brief.undated.open_total} open (${Math.round(brief.undated.ratio * 100)}%)`);
  }
  lines.push('');

  lines.push(`Recommendations (${brief.recommendations.length})`);
  for (const card of brief.recommendations) {
    lines.push(`  - ${card.lane}: ${card.id} - ${card.title}`);
  }
  lines.push('');

  lines.push(`Open inbox (${brief.inbox_open.length})`);
  for (const item of brief.inbox_open.slice(0, 10)) {
    lines.push(`  - ${item.id}: ${item.title}`);
  }
  lines.push('');

  lines.push(`Due packets (${brief.due_packets.length})`);
  for (const packet of brief.due_packets.slice(0, 10)) {
    lines.push(`  - ${packet.id} [${packet.trigger_date ?? '-'}]: ${packet.title}`);
  }
  lines.push('');

  lines.push(`Active runs (${brief.active_runs.length})`);
  for (const run of brief.active_runs.slice(0, 10)) {
    lines.push(`  - ${run.run_id}: ${run.task_id} - ${run.title ?? ''}`);
  }
  lines.push('');
  return lines.join('\n');
}
