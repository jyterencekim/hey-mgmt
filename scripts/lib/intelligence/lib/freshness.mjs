// Freshness verdicts, mirroring the auditor's envelope: every node has an
// `as_of`; each namespace has a refresh budget; older than budget = stale.
const DAY = 86400;

// Budget per namespace (seconds). null = not on a cadence (verdict n/a).
export const BUDGETS = {
  ext: 7 * DAY,        // Fisher external activity is re-ingested continuously
  mem: 120 * DAY,      // memories older than four months deserve a re-check
  mgmt: 60 * DAY,      // an active artifact untouched for two months is suspect
  auditor: 1 * DAY,    // protocol facts are re-promoted daily
  chain: 1 * DAY,
  proc: null,
  src: null,
  oa: 120 * DAY,      // research docs carry last_verified; four months without re-verification is stale
};

const TERMINAL = new Set(['done', 'archived', 'cancelled', 'superseded']);

/** @returns {{as_of, age_seconds, budget_seconds, verdict}} verdict: fresh | stale | unknown | n/a */
export function freshnessOf(node, now = Date.now()) {
  const budget = node.meta?.cadence_seconds ?? BUDGETS[node.ns] ?? null;
  const asOf = node.as_of ?? node.updated_at ?? null;
  if (budget == null) return { as_of: asOf, age_seconds: null, budget_seconds: null, verdict: 'n/a' };
  if (!asOf) return { as_of: null, age_seconds: null, budget_seconds: budget, verdict: 'unknown' };
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) return { as_of: asOf, age_seconds: null, budget_seconds: budget, verdict: 'unknown' };
  const age = Math.max(0, Math.floor((now - t) / 1000));
  // A terminal artifact is not expected to change; its age is not staleness.
  if (node.ns === 'mgmt' && TERMINAL.has(node.status)) return { as_of: asOf, age_seconds: age, budget_seconds: budget, verdict: 'n/a' };
  return { as_of: asOf, age_seconds: age, budget_seconds: budget, verdict: age > budget ? 'stale' : 'fresh' };
}

export function formatFreshness(f) {
  if (f.verdict === 'n/a') return '';
  const d = f.age_seconds == null ? '?' : `${Math.floor(f.age_seconds / DAY)}d`;
  return f.verdict === 'stale' ? ` ⚠ stale (${d} > ${Math.floor(f.budget_seconds / DAY)}d budget, as of ${f.as_of})` : ` (${f.verdict}, ${d})`;
}
