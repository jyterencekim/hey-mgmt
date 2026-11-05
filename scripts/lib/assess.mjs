import { resolve } from 'node:path';
import { queryCatalog, dbExists } from './catalog-db.mjs';
import { validateRepository } from './indexer.mjs';

const PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30, quarterly: 90 };

function fmt(date) {
  return date.toISOString().slice(0, 10);
}

function safeQuery(repoRoot, sql, params = []) {
  try {
    return queryCatalog({ repoRoot, sql, params });
  } catch {
    return [];
  }
}

function groupBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const k = row[key] ?? '';
    out[k] = row.count ?? 0;
  }
  return out;
}

export function runAssess(repoRoot, options = {}) {
  const root = resolve(repoRoot);

  if (!dbExists(root)) {
    throw new Error(`Catalog DB not found. Run 'hey db build' first.`);
  }

  const period = options.period ?? 'weekly';
  const iteration = options.iteration ?? null;
  if (!(period in PERIOD_DAYS)) {
    throw new Error(`Invalid period '${period}'. Use: ${Object.keys(PERIOD_DAYS).join(', ')}`);
  }
  const lookback = PERIOD_DAYS[period];

  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - lookback);

  const today = fmt(toDate);
  const from = fmt(fromDate);

  const futureDate = new Date(toDate);
  futureDate.setDate(futureDate.getDate() + lookback);
  const future = fmt(futureDate);

  const taskIterationClause = iteration ? ' AND iteration = ?' : '';
  const withIteration = (params = []) => iteration ? [...params, iteration] : params;

  const completed = safeQuery(
    root,
    `SELECT id, title, owner, area, priority, updated_at FROM items WHERE type='task' AND status='done' AND updated_at >= ?${taskIterationClause} ORDER BY updated_at DESC`,
    withIteration([from])
  );

  const created = safeQuery(
    root,
    `SELECT id, type, title, owner, area, created_at FROM items WHERE created_at >= ? ORDER BY created_at DESC`,
    [from]
  );

  const decisions = safeQuery(
    root,
    `SELECT id, title, created_at FROM items WHERE type='decision' AND created_at >= ? ORDER BY created_at DESC`,
    [from]
  );

  const active = safeQuery(
    root,
    `SELECT id, title, owner, area, priority, due_date FROM items WHERE type='task' AND status='ready'${taskIterationClause} ORDER BY priority, due_date`,
    withIteration([])
  );

  const blocked = safeQuery(
    root,
    `SELECT id, title, owner, area, priority FROM items WHERE type='task' AND status='blocked'${taskIterationClause}`,
    withIteration([])
  );

  const overdue = safeQuery(
    root,
    `SELECT id, title, owner, area, priority, due_date FROM items WHERE type='task' AND status IN ('ready','doing') AND due_date IS NOT NULL AND due_date < ?${taskIterationClause} ORDER BY due_date`,
    withIteration([today])
  );

  const in_progress = safeQuery(
    root,
    `SELECT id, title, owner, area, priority FROM items WHERE type='task' AND status='doing'${taskIterationClause}`,
    withIteration([])
  );

  const upcoming_due = safeQuery(
    root,
    `SELECT id, title, owner, area, priority, due_date FROM items WHERE type='task' AND status IN ('ready','doing') AND due_date IS NOT NULL AND due_date >= ? AND due_date <= ?${taskIterationClause} ORDER BY due_date`,
    withIteration([today, future])
  );

  const byAreaRows = safeQuery(
    root,
    `SELECT area, COUNT(*) as count FROM items WHERE type='task' AND status IN ('ready','doing')${taskIterationClause} GROUP BY area ORDER BY count DESC`,
    withIteration([])
  );

  const byOwnerRows = safeQuery(
    root,
    `SELECT owner, COUNT(*) as count FROM items WHERE type='task' AND status IN ('ready','doing')${taskIterationClause} GROUP BY owner ORDER BY count DESC`,
    withIteration([])
  );

  const unassigned = safeQuery(
    root,
    `SELECT id, title, area, priority FROM items WHERE type='task' AND status='ready' AND (owner IS NULL OR owner = '')${taskIterationClause} ORDER BY priority`,
    withIteration([])
  );

  // Letter-grade auditing is retired (decision_adr-retire-letter-grade-audit);
  // health is validation state only.
  let health;
  try {
    const { report } = validateRepository(root);
    health = {
      validation_errors: report.issues.filter((i) => i.level === 'error').length,
      validation_warnings: report.issues.filter((i) => i.level === 'warning').length,
    };
  } catch {
    health = {
      validation_errors: 0,
      validation_warnings: 0,
    };
  }

  return {
    period,
    iteration,
    window: { from, to: today },
    progress: { completed, created, decisions },
    current: { active, blocked, overdue, in_progress },
    ahead: {
      upcoming_due,
      by_area: groupBy(byAreaRows, 'area'),
      by_owner: groupBy(byOwnerRows, 'owner'),
      unassigned,
    },
    health,
  };
}
