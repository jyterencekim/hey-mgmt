import { resolve } from 'node:path';
import { loadManifest } from './indexer.mjs';
import { parseArtifact, writeArtifact } from './content-io.mjs';
import { compareIterations } from './iteration.mjs';

// D3/D4 (note_automated-initiative-task-hygiene-strategy, ratified 2026-08-14):
// carry-forward is automatic and information-preserving; at 3 slips the task
// stops carrying silently and forces a human decision.
export const SLIP_DECISION_THRESHOLD = 3;
export const CARRYABLE_STATUSES = ['plan', 'ready', 'doing', 'blocked'];

const ITERATION_RE = /^\d{4}-W\d{2}$/;

function assertIteration(value, flag) {
  if (typeof value !== 'string' || !ITERATION_RE.test(value)) {
    throw new Error(`${flag} must use YYYY-WNN format, e.g. 2026-W34 (got: ${value || '(empty)'})`);
  }
}

/**
 * Plan the carry-forward of open committed tasks from one iteration to the next.
 *
 * Pure read: nothing is written. Tasks whose iteration matches `from` (default:
 * the most recent iteration before `to` present on open tasks) are carried to
 * `to` with their slip count incremented. A task reaching the slip threshold is
 * still carried — silence is the pathology this exists to end, not the carry —
 * but flagged as a forced decision (re-scope / re-commit / archive).
 */
export function buildCarryPlan(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const to = options.to;
  assertIteration(to, '--to');
  const member = options.member ?? null;
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  const open = loadManifest(root)
    .filter((item) => item.type === 'task')
    .filter((item) => CARRYABLE_STATUSES.includes(item.status))
    .filter((item) => !member || item.owner === member)
    .filter((item) => item.iteration);

  const pastIterations = [...new Set(open.map((item) => item.iteration))]
    .filter((iteration) => compareIterations(iteration, to) < 0)
    .sort(compareIterations);

  let from = options.from ?? null;
  if (from) {
    assertIteration(from, '--from');
  } else {
    if (pastIterations.length === 0) {
      throw new Error(`no open task carries an iteration before ${to}; pass --from explicitly`);
    }
    from = pastIterations[pastIterations.length - 1];
  }
  if (compareIterations(from, to) >= 0) {
    throw new Error(`--from (${from}) must be before --to (${to})`);
  }

  const carried = [];
  for (const item of open.filter((entry) => entry.iteration === from)) {
    // x_slip_count lives in the file, not just the manifest — read the file so
    // the increment is computed against the current source of truth.
    const artifact = parseArtifact(resolve(root, item.path), resolve(root, 'content'));
    const currentSlip = Number.isInteger(artifact.frontmatter.x_slip_count)
      ? artifact.frontmatter.x_slip_count
      : 0;
    const slipCount = currentSlip + 1;
    carried.push({
      id: item.id,
      title: item.title,
      status: item.status,
      owner: item.owner ?? null,
      priority: item.priority ?? null,
      path: item.path,
      slip_count: slipCount,
      forced_decision: slipCount >= SLIP_DECISION_THRESHOLD,
    });
  }
  carried.sort((a, b) => a.id.localeCompare(b.id));

  const olderIterations = pastIterations.filter((iteration) => iteration !== from);
  const older = olderIterations.map((iteration) => ({
    iteration,
    open_tasks: open.filter((entry) => entry.iteration === iteration).length,
  }));

  return {
    generated_at: new Date().toISOString(),
    today,
    from,
    to,
    member,
    carried,
    forced_decisions: carried.filter((entry) => entry.forced_decision),
    older_open_iterations: older,
  };
}

/**
 * Apply a carry plan: rewrite iteration, increment x_slip_count, bump
 * updated_at. All other frontmatter is preserved. The caller re-indexes.
 */
export function applyCarryPlan(repoRoot, plan) {
  const root = resolve(repoRoot ?? process.cwd());
  const contentRoot = resolve(root, 'content');
  const applied = [];
  for (const entry of plan.carried) {
    const filePath = resolve(root, entry.path);
    const artifact = parseArtifact(filePath, contentRoot);
    artifact.frontmatter.iteration = plan.to;
    artifact.frontmatter.x_slip_count = entry.slip_count;
    artifact.frontmatter.updated_at = plan.today;
    writeArtifact(filePath, artifact.frontmatter, artifact.body);
    applied.push(entry.id);
  }
  return { applied: applied.length, task_ids: applied };
}

export function formatCarryPlan(plan, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const lines = ['', `Iteration carry ${plan.from} → ${plan.to}${plan.member ? ` for ${plan.member}` : ''}${dryRun ? ' (dry run — nothing written)' : ''}`, ''];

  lines.push(`Carried (${plan.carried.length})`);
  for (const entry of plan.carried) {
    lines.push(`  - ${entry.title} (${entry.id}, ${entry.status}${entry.owner ? `, ${entry.owner}` : ''}, slip ${entry.slip_count})`);
  }
  if (plan.carried.length === 0) {
    lines.push(`  (no open task carries iteration ${plan.from})`);
  }
  lines.push('');

  if (plan.forced_decisions.length > 0) {
    lines.push(`FORCED DECISIONS — slip count ≥ ${SLIP_DECISION_THRESHOLD} (${plan.forced_decisions.length})`);
    lines.push('  Carried, but each now requires a decision: re-scope, re-commit with a reason, or archive.');
    for (const entry of plan.forced_decisions) {
      lines.push(`  - ${entry.title} (${entry.id}, slip ${entry.slip_count}${entry.owner ? `, ${entry.owner}` : ''})`);
    }
    lines.push('');
  }

  if (plan.older_open_iterations.length > 0) {
    const parts = plan.older_open_iterations.map((entry) => `${entry.iteration} (${entry.open_tasks})`);
    lines.push(`Note: open tasks remain on older iterations: ${parts.join(', ')} — re-run with --from to carry them.`);
    lines.push('');
  }

  return lines.join('\n');
}
