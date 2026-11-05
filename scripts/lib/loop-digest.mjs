import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadManifest } from './indexer.mjs';
import { buildLoopBrief, buildLoopHorizon } from './loop-control.mjs';
import { parseArtifact, writeArtifact } from './content-io.mjs';
import { assertKnownMember } from './members.mjs';
import { applyMarkedSection } from './log-scaffold.mjs';

const OPEN_STATUSES = new Set(['plan', 'ready', 'doing', 'blocked']);
const ALARM_STATUSES = new Set(['ready', 'doing', 'blocked']);

function dateOnly(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function kstToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

function kstStamp(iso) {
  const date = iso ? new Date(iso) : new Date();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
  return `${day} ${time} KST`;
}

function readInputsAsOf(root) {
  let gitHead = null;
  try {
    gitHead = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch { /* not a git checkout — stamp stays null, rendered as unknown */ }
  let manifestBuiltAt = null;
  const manifestPath = resolve(root, 'index', 'manifest.jsonl');
  if (existsSync(manifestPath)) {
    manifestBuiltAt = statSync(manifestPath).mtime.toISOString();
  }
  return { git_head: gitHead, manifest_built_at: manifestBuiltAt };
}

function statePath(root, member) {
  return resolve(root, '.hey', 'loop-digest', `${member}.json`);
}

function loadDigestState(root, member) {
  try {
    return JSON.parse(readFileSync(statePath(root, member), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Compose the morning digest for one member (P3, D2 charlie pilot).
 *
 * Pure read: the digest leads with today's planned set (D1 — x_planned_date is
 * a schedule, not a deadline), keeps hard-deadline overdue as the only alarm
 * section, and treats a missed planned date as "back to the pool", never
 * "overdue". Inbox delta is computed against the last --record run's state.
 */
export function buildLoopDigest(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const member = options.member;
  if (!member) throw new Error('loop digest requires --member');
  assertKnownMember(root, member);
  const today = dateOnly(options.today) ?? kstToday();

  const brief = buildLoopBrief(root, { member, today });
  const horizon = buildLoopHorizon(root, { member, today });
  const manifest = loadManifest(root);

  const mine = manifest
    .filter((item) => item.type === 'task' && item.owner === member)
    .filter((item) => OPEN_STATUSES.has(item.status));

  const asRow = (item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority ?? null,
    due_date: dateOnly(item.due_date),
    planned_date: dateOnly(item.planned_date),
    iteration: item.iteration ?? null,
  });

  const plannedToday = mine
    .filter((item) => dateOnly(item.planned_date) === today)
    .map(asRow);
  const missedPlans = mine
    .filter((item) => {
      const planned = dateOnly(item.planned_date);
      return planned && planned < today;
    })
    .map(asRow);
  const overdue = mine
    .filter((item) => ALARM_STATUSES.has(item.status))
    .filter((item) => {
      const due = dateOnly(item.due_date);
      return due && due < today;
    })
    .map(asRow)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));

  const state = loadDigestState(root, member);
  const lastSeen = new Set(state?.last_seen_inbox_ids ?? []);
  const inboxItems = brief.inbox_open.map((item) => ({
    id: item.id,
    title: item.title,
    is_new: !lastSeen.has(item.id),
  }));

  // Packets already surfaced by an earlier digest stay out — that is the
  // "consumed" half of the P4 loop restore.
  const duePackets = brief.due_packets.filter((packet) => !packet.surfaced_at);

  return {
    generated_at: new Date().toISOString(),
    today,
    member,
    inputs: readInputsAsOf(root),
    planned_today: plannedToday,
    missed_plans: missedPlans,
    overdue,
    recommendations: brief.recommendations,
    board_counts: brief.board_counts,
    iteration_view: horizon.iteration_view,
    inbox: {
      open: inboxItems,
      new_count: inboxItems.filter((item) => item.is_new).length,
      last_digest_at: state?.last_run_at ?? null,
    },
    due_packets: duePackets,
    active_runs: brief.active_runs.map((run) => ({
      run_id: run.run_id,
      task_id: run.task_id ?? null,
      status: run.status ?? null,
    })),
  };
}

function renderTaskRow(row, { due = false } = {}) {
  const meta = [`\`${row.id}\``, row.status];
  if (row.priority) meta.push(row.priority);
  if (due && row.due_date) meta.push(`due ${row.due_date}`);
  return `- ${row.title} (${meta.join(', ')})`;
}

export function formatLoopDigest(digest) {
  const inputs = digest.inputs ?? {};
  const asOf = [
    inputs.git_head ? `git ${inputs.git_head}` : 'git unknown',
    inputs.manifest_built_at ? `index built ${kstStamp(inputs.manifest_built_at)}` : 'index build time unknown',
  ].join(' · ');

  const lines = [
    `# Digest — ${digest.member} — ${digest.today}`,
    '',
    `Generated at ${kstStamp(digest.generated_at)} — inputs as of ${asOf}.`,
    '',
    `## Planned today (${digest.planned_today.length})`,
    '',
  ];

  if (digest.planned_today.length === 0) {
    lines.push('Nothing scheduled for today. Pick from "This iteration" below.');
  }
  for (const row of digest.planned_today) lines.push(renderTaskRow(row));
  lines.push('');

  if (digest.missed_plans.length > 0) {
    lines.push(`## Missed plans (${digest.missed_plans.length})`, '');
    lines.push('Planned days that passed. No alarm — each returns to the unplanned pool. Re-plan or leave for the week.');
    for (const row of digest.missed_plans) {
      lines.push(`- ${row.title} (\`${row.id}\`, ${row.status}, was planned ${row.planned_date})`);
    }
    lines.push('');
  }

  lines.push(`## Hard-deadline overdue (${digest.overdue.length})`, '');
  if (digest.overdue.length === 0) {
    lines.push('None. This is the only alarm section.');
  } else {
    for (const row of digest.overdue) lines.push(renderTaskRow(row, { due: true }));
  }
  lines.push('');

  if (digest.recommendations.length > 0) {
    lines.push(`## Attention (${digest.recommendations.length})`, '');
    for (const card of digest.recommendations) {
      lines.push(`- ${card.lane}: ${card.title} (\`${card.id}\`)`);
    }
    lines.push('');
  }

  const view = digest.iteration_view;
  if (view) {
    lines.push('## Iteration', '');
    lines.push(`- This iteration ${view.current}: ${view.counts.this_iteration} committed`);
    lines.push(`- Next iteration ${view.next}: ${view.counts.next_iteration}`);
    lines.push(`- Backlog: ${view.counts.backlog}`);
    const top = view.buckets.this_iteration.slice(0, 10);
    if (top.length > 0) {
      lines.push('', 'This iteration, planned-date first:');
      for (const item of top) {
        const plan = item.planned_date ? `, plan ${item.planned_date}` : '';
        lines.push(`- ${item.title} (\`${item.id}\`, ${item.status}${plan})`);
      }
      if (view.buckets.this_iteration.length > top.length) {
        lines.push(`- … ${view.buckets.this_iteration.length - top.length} more`);
      }
    }
    lines.push('');
  }

  lines.push(`## Inbox (${digest.inbox.open.length} open, ${digest.inbox.new_count} new)`, '');
  if (digest.inbox.last_digest_at) {
    lines.push(`New means: not seen by the last digest (${kstStamp(digest.inbox.last_digest_at)}).`);
  }
  for (const item of digest.inbox.open.slice(0, 15)) {
    lines.push(`- ${item.title} (\`${item.id}\`)${item.is_new ? ' — new' : ''}`);
  }
  if (digest.inbox.open.length > 15) lines.push(`- … ${digest.inbox.open.length - 15} more`);
  lines.push('');

  lines.push(`## Due packets (${digest.due_packets.length})`, '');
  if (digest.due_packets.length === 0) {
    lines.push('None due.');
  } else {
    for (const packet of digest.due_packets) {
      lines.push(`- ${packet.title} (\`${packet.id}\`, trigger ${packet.trigger_date ?? '-'})`);
    }
    lines.push('', 'Each packet above is marked surfaced on --record and stops re-listing.');
  }
  lines.push('');

  return lines.join('\n');
}

export const DIGEST_START = '<!-- fisher:digest:start -->';
export const DIGEST_END = '<!-- fisher:digest:end -->';

/**
 * Render the digest as a marker-scoped section of the member's daily log.
 *
 * The digest's own `#`/`##` headings are demoted so they nest under the log's
 * date heading instead of competing with it.
 *
 * This section deliberately contains **no `## Plan`**. A plan is a commitment,
 * and commitments are member-authored — Fisher does not make them. So a log
 * carrying this section but no `## Plan` is not a broken log: it is an accurate
 * statement that the scheduled pass ran and the member has not yet committed to
 * a day. The 21:30 double-check reads exactly that distinction.
 */
export function buildDigestLogSection(digest) {
  const body = formatLoopDigest(digest)
    .split('\n')
    .filter((line) => !line.startsWith('# Digest — '))
    .map((line) => (line.startsWith('## ') ? `#${line}` : line))
    .join('\n')
    .trim();

  return [
    DIGEST_START,
    `## Loop Control — auto (${kstStamp(digest.generated_at)})`,
    '<!-- Written by the scheduled loop-digest pass. Forward-looking projection, not a commitment. -->',
    '<!-- Machine-owned: edits inside these markers are overwritten on the next run. -->',
    '',
    body,
    DIGEST_END,
  ].join('\n');
}

/**
 * Record the stateful effects of the digest: the daily log section, the
 * inbox-delta state, and the surfaced marker on every due packet it listed.
 *
 * The log is where this lands because it is the only durable record of a
 * member's day — there is no `digests/` directory. A pass whose sole output was
 * an ephemeral delivery left the repo unable to answer "did management run
 * today?", which is the question the whole ceremony exists to keep answerable.
 */
export function recordLoopDigest(repoRoot, digest) {
  const root = resolve(repoRoot ?? process.cwd());

  const log = applyMarkedSection(root, {
    member: digest.member,
    date: digest.today,
    section: buildDigestLogSection(digest),
    startMarker: DIGEST_START,
    endMarker: DIGEST_END,
    label: 'digest',
  });

  const stateFile = statePath(root, digest.member);
  mkdirSync(resolve(root, '.hey', 'loop-digest'), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify({
    member: digest.member,
    last_run_at: digest.generated_at,
    last_seen_inbox_ids: digest.inbox.open.map((item) => item.id),
  }, null, 2)}\n`, 'utf8');

  const marked = [];
  for (const packet of digest.due_packets) {
    const filePath = resolve(root, packet.path);
    if (!existsSync(filePath)) continue;
    const artifact = parseArtifact(filePath, resolve(root, 'content'));
    if (artifact.frontmatter.x_surfaced_at) continue; // already consumed
    artifact.frontmatter.x_surfaced_at = digest.today;
    const markerLine = `\n> Surfaced ${digest.today} in ${digest.member}'s digest. Act on it or close it; it will not re-list.\n`;
    writeArtifact(filePath, artifact.frontmatter, `${artifact.body.trimEnd()}\n${markerLine}`);
    marked.push(packet.id);
  }

  return {
    log_path: log.path,
    log_created: log.created,
    log_replaced: log.replaced,
    state_path: stateFile,
    packets_marked: marked,
  };
}
