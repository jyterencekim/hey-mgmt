// decision_adr-product-initiative-kickoff: pure rules shared by the validator,
// the product-initiative report and alerts. No imports, so validate.mjs can
// use it without an import cycle through indexer.mjs.

export const INITIATIVE_KINDS = ['product', 'business', 'marketing', 'ops'];

// New product initiatives created on/after this date fail validation when the
// kickoff contract is missing; older ones warn until the owner backfills.
export const PRODUCT_RULE_EFFECTIVE_DATE = '2026-11-03';

// D6: an unchanged gap set is not re-sent within this window.
export const ALERT_RESEND_DAYS = 7;

export const KICKOFF_FIELDS = [
  { key: 'timeline_start', field: 'x_timeline_start', label: 'start date' },
  { key: 'timeline_end', field: 'x_timeline_end', label: 'target date' },
  { key: 'prd_doc', field: 'x_prd_doc', label: 'PRD link' },
  { key: 'components', field: 'x_components', label: 'PRD component list' },
  { key: 'kickoff_date', field: 'x_kickoff_date', label: 'kickoff date' },
  { key: 'baseline_tasks', field: 'x_baseline_tasks', label: 'kickoff task baseline' },
];

export const OPEN_STATUSES = new Set(['plan', 'ready', 'doing', 'blocked']);
export const DROPPED_STATUSES = new Set(['archived', 'cancelled']);

export function dateOnly(value) {
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function isEmpty(value) {
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || String(value).trim() === '';
}

export function daysBetween(fromIso, toIso) {
  const from = Date.parse(`${fromIso}T00:00:00.000Z`);
  const to = Date.parse(`${toIso}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.floor((to - from) / 86400000);
}

/**
 * Normalize a parsed artifact (validator input) into the manifest-entry shape
 * the rules below read, so validator and report share one implementation.
 */
export function entryFromArtifact(artifact) {
  const fm = artifact.frontmatter ?? {};
  const list = (value) => (Array.isArray(value) ? value.map(String) : []);
  return {
    id: artifact.id,
    type: artifact.type,
    title: artifact.title,
    status: fm.status ?? null,
    owner: fm.owner ?? null,
    created_at: String(fm.created_at ?? ''),
    initiative_kind: fm.x_initiative_kind ?? null,
    prd_doc: fm.x_prd_doc ?? null,
    components: list(fm.x_components),
    kickoff_date: dateOnly(fm.x_kickoff_date),
    baseline_tasks: list(fm.x_baseline_tasks),
    timeline_start: dateOnly(fm.x_timeline_start),
    timeline_end: dateOnly(fm.x_timeline_end),
    component: fm.x_component ?? null,
    start_date: dateOnly(fm.x_start_date),
    target_date: dateOnly(fm.x_target_date),
    relations_out: artifact.relationsOut ?? [],
  };
}

/**
 * Task membership per initiative: the UNION of initiative `parent_of` and task
 * `child_of`, matching the weekly-report rollup.
 */
export function buildInitiativeMembership(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const members = new Map();
  const add = (initiativeId, taskId) => {
    if (byId.get(initiativeId)?.type !== 'initiative' || byId.get(taskId)?.type !== 'task') return;
    if (!members.has(initiativeId)) members.set(initiativeId, new Set());
    members.get(initiativeId).add(taskId);
  };
  for (const entry of entries) {
    for (const relation of entry.relations_out ?? []) {
      if (entry.type === 'initiative' && relation.type === 'parent_of') add(entry.id, relation.target);
      if (entry.type === 'task' && relation.type === 'child_of') add(relation.target, entry.id);
    }
  }
  return members;
}

export function isActiveProduct(initiative) {
  return initiative.initiative_kind === 'product' && initiative.status === 'active';
}

/** D2 fields missing on an initiative, as {field, label}. */
export function missingKickoffFields(initiative) {
  return KICKOFF_FIELDS
    .filter(({ key }) => isEmpty(initiative[key]))
    .map(({ field, label }) => ({ field, label }));
}

/** True when a missing kickoff contract is a validation error, not a warning. */
export function kickoffIsEnforced(initiative) {
  const created = dateOnly(initiative.created_at);
  return Boolean(created && created >= PRODUCT_RULE_EFFECTIVE_DATE);
}

/** D3 gaps on one open task of a product initiative. */
export function taskGaps(task, initiative, today) {
  const gaps = [];
  if (isEmpty(task.component)) {
    gaps.push({ field: 'x_component', label: 'component' });
  } else if (initiative.components.length > 0 && !initiative.components.includes(task.component)) {
    gaps.push({ field: 'x_component', label: `component '${task.component}' is not in the initiative's x_components` });
  }
  if (isEmpty(task.start_date)) gaps.push({ field: 'x_start_date', label: 'start date' });
  if (isEmpty(task.target_date)) gaps.push({ field: 'x_target_date', label: 'target date' });
  else if (today && task.target_date < today) {
    gaps.push({ field: 'x_target_date', label: `target date ${task.target_date} passed`, slipped: true });
  }
  return gaps;
}

/** D5: tasks added after kickoff and baseline tasks removed or dropped since. */
export function scopeChanges(initiative, memberIds, byId) {
  if (isEmpty(initiative.kickoff_date)) return null;
  const baseline = new Set(initiative.baseline_tasks);
  // A task dropped before kickoff was never part of the plan; only a dropped
  // task created after kickoff still counts as added (then removed).
  const added = [...memberIds]
    .filter((id) => !baseline.has(id))
    .map((id) => byId.get(id))
    .filter(Boolean)
    .filter((task) => !DROPPED_STATUSES.has(task.status) || (dateOnly(task.created_at) ?? '') > initiative.kickoff_date)
    .map((task) => ({ id: task.id, title: task.title, status: task.status, created_at: dateOnly(task.created_at) }));
  const removed = [];
  for (const id of baseline) {
    const task = byId.get(id);
    if (!task) removed.push({ id, title: null, reason: 'missing from the ledger' });
    else if (!memberIds.has(id)) removed.push({ id, title: task.title, reason: 'unlinked from the initiative' });
    else if (DROPPED_STATUSES.has(task.status)) removed.push({ id, title: task.title, reason: task.status });
  }
  return { added, removed };
}
