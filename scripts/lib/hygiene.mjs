import { resolve } from 'node:path';
import { loadManifest } from './indexer.mjs';
import { STALE_DAYS } from './validate.mjs';
import { iterationWeekRange } from './iteration.mjs';
import { buildPrCheck } from './pr-status.mjs';
import { evaluateProductInitiatives } from './product-initiative.mjs';

// D4 (note_automated-initiative-task-hygiene-strategy): a task sitting in
// `doing` for two weeks without a touch is not being done.
export const DOING_DEMOTION_DAYS = 14;

const OPEN_STATUSES = new Set(['plan', 'ready', 'doing', 'blocked']);
const TERMINAL_STATUSES = new Set(['done', 'archived', 'cancelled']);

function dateOnly(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function daysBetween(fromIso, toIso) {
  const from = Date.parse(`${fromIso}T00:00:00.000Z`);
  const to = Date.parse(`${toIso}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.floor((to - from) / 86400000);
}

/**
 * Read-only hygiene detector: one batch report of proposals, never a mutation.
 *
 * Detection is deterministic; every state change stays a human decision made on
 * the batch (P2 of the hygiene strategy). `x_evergreen: true` exempts a task
 * from every rule — evergreen is the explicit whole-task opt-out.
 */
export async function buildHygieneReport(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const member = options.member ?? null;
  const today = dateOnly(options.today) ?? new Date().toISOString().slice(0, 10);
  const manifest = loadManifest(root);
  const byId = new Map(manifest.map((item) => [item.id, item]));

  const tasks = manifest
    .filter((item) => item.type === 'task')
    .filter((item) => OPEN_STATUSES.has(item.status))
    .filter((item) => !member || item.owner === member);

  const describe = (item, extra) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    owner: item.owner ?? null,
    path: item.path,
    ...extra,
  });

  const doingStale = [];
  const staleOpen = [];
  const blockedResolved = [];
  const wishDates = [];
  const plannedDates = [];

  for (const item of tasks) {
    if (item.evergreen === true) continue;
    const updatedAt = dateOnly(item.updated_at);
    const idleDays = updatedAt ? daysBetween(updatedAt, today) : null;

    // (a) doing, untouched past the demotion window → it is not being done.
    if (item.status === 'doing' && idleDays !== null && idleDays > DOING_DEMOTION_DAYS) {
      doingStale.push(describe(item, {
        updated_at: updatedAt,
        idle_days: idleDays,
        proposed_action: 'demote to ready',
      }));
    }

    // (b) ready/plan, untouched past the GP3 staleness threshold.
    if ((item.status === 'ready' || item.status === 'plan') && idleDays !== null && idleDays > STALE_DAYS) {
      staleOpen.push(describe(item, {
        updated_at: updatedAt,
        idle_days: idleDays,
        proposed_action: 'archive (closed without completion)',
      }));
    }

    // (c) blocked, but nothing still blocks it: every blocked_by target is
    // terminal or gone from the ledger.
    if (item.status === 'blocked') {
      const blockers = (item.relations_out ?? []).filter((relation) => relation.type === 'blocked_by');
      if (blockers.length > 0) {
        const states = blockers.map((blocker) => {
          const target = byId.get(blocker.target);
          return { target: blocker.target, state: target ? (target.status ?? 'none') : 'missing' };
        });
        const active = states.filter((entry) => entry.state !== 'missing' && !TERMINAL_STATUSES.has(entry.state));
        if (active.length === 0) {
          blockedResolved.push(describe(item, {
            blockers: states,
            proposed_action: 'unblock or re-route',
          }));
        }
      }
    }

    // (d) due_date on a non-committed task is a wish, not a deadline (D1).
    if (!item.iteration && dateOnly(item.due_date)) {
      wishDates.push(describe(item, {
        due_date: dateOnly(item.due_date),
        proposed_action: 'strip due_date (move to backlog)',
      }));
    }

    // (e) x_planned_date is a weekday schedule inside the committed iteration;
    // anywhere else it is stale noise.
    const plannedDate = dateOnly(item.planned_date);
    if (plannedDate) {
      const range = item.iteration ? iterationWeekRange(item.iteration) : null;
      if (!range) {
        plannedDates.push(describe(item, {
          planned_date: plannedDate,
          reason: 'task has no iteration',
          proposed_action: 'strip x_planned_date',
        }));
      } else if (plannedDate < range.start || plannedDate > range.end) {
        plannedDates.push(describe(item, {
          planned_date: plannedDate,
          reason: `outside ${item.iteration} (${range.start}..${range.end})`,
          proposed_action: 'strip x_planned_date',
        }));
      }
    }
  }

  // (f) every referenced PR merged → close candidate (reuses loop pr-check).
  let pr = { skipped: true };
  let prsMerged = [];
  if (options.pr !== false) {
    try {
      const report = options.prReport ?? await buildPrCheck(root, {
        member,
        concurrency: options.concurrency,
        fetcher: options.fetcher,
      });
      pr = {
        checked_tasks: report.checked_tasks,
        tasks_with_refs: report.tasks_with_refs,
        unique_prs: report.unique_prs,
        unresolved: report.unresolved,
      };
      const toProposal = (finding, staleText) => ({
        id: finding.id,
        title: finding.title,
        status: finding.status,
        owner: finding.owner ?? null,
        path: finding.path,
        prs: finding.prs,
        stale_text: staleText,
        proposed_action: 'close (verify definition of done first)',
      });
      const evergreenIds = new Set(tasks.filter((item) => item.evergreen === true).map((item) => item.id));
      prsMerged = [
        ...report.contradictions.map((finding) => toProposal(finding, true)),
        ...report.all_merged.map((finding) => toProposal(finding, false)),
      ].filter((proposal) => !evergreenIds.has(proposal.id));
    } catch (error) {
      pr = { error: String(error?.message ?? error) };
    }
  }

  // (g) decision_adr-product-initiative-kickoff D6: active product initiatives
  // with kickoff or task gaps. `./hey initiative alert` sends these to owners.
  const productGaps = evaluateProductInitiatives(manifest, { today, member }).products
    .filter((product) => product.red_flag_count > 0)
    .map((product) => ({
      id: product.id,
      title: product.title,
      status: 'active',
      owner: product.owner,
      missing_kickoff: product.missing_kickoff.map((gap) => gap.field),
      task_gaps: product.task_gaps.length,
      proposed_action: 'fill kickoff fields / task dates and components',
    }));

  const sections = {
    doing_stale: doingStale,
    stale_open: staleOpen,
    blocked_resolved: blockedResolved,
    wish_dates: wishDates,
    planned_dates: plannedDates,
    prs_merged: prsMerged,
    product_initiative_gaps: productGaps,
  };

  return {
    generated_at: new Date().toISOString(),
    today,
    member,
    doing_demotion_days: DOING_DEMOTION_DAYS,
    stale_days: STALE_DAYS,
    checked_tasks: tasks.length,
    sections,
    counts: Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value.length])),
    pr,
  };
}

export function formatHygieneReport(report) {
  const lines = ['', `Hygiene check${report.member ? ` for ${report.member}` : ''} (${report.today})`, ''];
  lines.push(`Scanned ${report.checked_tasks} open task(s). Read-only — every proposal below awaits a human decision.`);
  lines.push('');

  const section = (heading, entries, render) => {
    if (entries.length === 0) return;
    lines.push(`${heading} (${entries.length})`);
    for (const entry of entries) {
      lines.push(`  - ${entry.title} (${entry.id}, ${entry.status}${entry.owner ? `, ${entry.owner}` : ''})`);
      lines.push(`    ${render(entry)} → ${entry.proposed_action}`);
    }
    lines.push('');
  };

  section(
    `Doing, idle > ${report.doing_demotion_days}d`,
    report.sections.doing_stale,
    (entry) => `last touched ${entry.updated_at} (${entry.idle_days}d ago)`
  );
  section(
    `Ready/plan, untouched > ${report.stale_days}d`,
    report.sections.stale_open,
    (entry) => `last touched ${entry.updated_at} (${entry.idle_days}d ago)`
  );
  section(
    'Blocked, but every blocker is terminal or missing',
    report.sections.blocked_resolved,
    (entry) => entry.blockers.map((blocker) => `${blocker.target}=${blocker.state}`).join(', ')
  );
  section(
    'Wish-dates on non-committed tasks',
    report.sections.wish_dates,
    (entry) => `due_date ${entry.due_date} with no iteration`
  );
  section(
    'Planned dates outside their iteration',
    report.sections.planned_dates,
    (entry) => `x_planned_date ${entry.planned_date} — ${entry.reason}`
  );
  section(
    'All referenced PRs merged',
    report.sections.prs_merged,
    (entry) => `${entry.prs.map((prEntry) => prEntry.key).join(', ')}${entry.stale_text ? ' (body still says pending — re-read)' : ''}`
  );

  section(
    'Product initiatives with kickoff or task gaps',
    report.sections.product_initiative_gaps ?? [],
    (entry) => `${entry.missing_kickoff.length ? `missing ${entry.missing_kickoff.join(', ')}; ` : ''}${entry.task_gaps} task(s) with gaps`
  );

  if (report.pr?.skipped) {
    lines.push('Merged-PR check skipped (--no-pr).');
    lines.push('');
  } else if (report.pr?.error) {
    lines.push(`Merged-PR check failed: ${report.pr.error}`);
    lines.push('');
  }

  const total = Object.values(report.counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    lines.push('Nothing flagged.');
    lines.push('');
  }
  return lines.join('\n');
}
