const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ITERATION_RE = /^\d{4}-W\d{2}$/;
const EXTENSION_FIELD_RE = /^x_[a-z0-9_]+$/;

export const FRONTMATTER_ALIASES = new Map([
  ['due', 'due_date'],
]);

export const TASK_STATUS_VALUES = new Set([
  'plan',
  'ready',
  'blocked',
  'doing',
  'done',
  'archived',
  'cancelled',
]);

export const ARTIFACT_STATUS_VALUES = new Set([
  'active',
  'archived',
  'done',
  'cancelled',
  'plan',
]);

export const GOAL_STATUS_VALUES = new Set([
  'active',
  'hit',
  'missed',
  'archived',
]);

// Back-compat alias for callers that only need a membership check across all types.
export const STATUS_VALUES = new Set([...TASK_STATUS_VALUES, ...ARTIFACT_STATUS_VALUES, ...GOAL_STATUS_VALUES]);

function allowedStatusValuesForType(type) {
  if (type === 'task') return TASK_STATUS_VALUES;
  if (type === 'goal') return GOAL_STATUS_VALUES;
  return ARTIFACT_STATUS_VALUES;
}

export const PRIORITY_VALUES = new Set(['do', 'plan', 'routine', 'drop']);

// decision_adr-product-initiative-kickoff D1.
export const INITIATIVE_KIND_VALUES = new Set(['product', 'business', 'marketing', 'ops']);

const COMMON_FIELDS = new Set([
  'id',
  'type',
  'title',
  'created_at',
  'updated_at',
  'status',
  'owner',
  'area',
  'priority',
  'tags',
  'entities',
  'relations',
  'sources',
  'watchers',
]);

const TYPE_FIELDS = {
  task: new Set(['definition_of_done', 'due_date', 'iteration']),
  decision: new Set(['decision_status', 'owners']),
  meeting: new Set(['attendees', 'start_at', 'end_at']),
  playbook: new Set(['playbook_version']),
  note: new Set([]),
  initiative: new Set([
    'definition_of_done',
    'x_timeline_start',
    'x_timeline_end',
    'x_initiative_kind',
    'x_prd_doc',
    'x_components',
    'x_kickoff_date',
    'x_baseline_tasks',
  ]),
  goal: new Set(['target', 'metric', 'current', 'target_date', 'definition_of_done']),
};

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim() !== '');
}

function isDateOnly(value) {
  return typeof value === 'string' && DATE_ONLY_RE.test(value);
}

function isIsoDateTime(value) {
  return typeof value === 'string' && ISO_DATETIME_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function allowedFieldsForType(type) {
  return new Set([...(TYPE_FIELDS[type] ?? []), ...COMMON_FIELDS]);
}

function pushIssue(issues, artifact, message) {
  issues.push({ level: 'error', id: artifact.id, path: artifact.relativePath, message });
}

export function isExtensionField(field) {
  return EXTENSION_FIELD_RE.test(field);
}

export function validateFrontmatterSchema(artifact, issues) {
  const fm = artifact.frontmatter ?? {};
  const allowed = allowedFieldsForType(artifact.type);

  for (const key of Object.keys(fm)) {
    if (FRONTMATTER_ALIASES.has(key)) {
      pushIssue(issues, artifact, `field '${key}' is not supported. Use '${FRONTMATTER_ALIASES.get(key)}' instead.`);
      continue;
    }

    if (!allowed.has(key) && !isExtensionField(key)) {
      pushIssue(issues, artifact, `unknown frontmatter field '${key}'. Use a canonical field or namespace extensions as 'x_*'.`);
    }
  }

  if ('created_at' in fm && !(isDateOnly(fm.created_at) || isIsoDateTime(fm.created_at))) {
    pushIssue(issues, artifact, 'created_at must be YYYY-MM-DD or an ISO 8601 datetime');
  }

  if ('updated_at' in fm && !(isDateOnly(fm.updated_at) || isIsoDateTime(fm.updated_at))) {
    pushIssue(issues, artifact, 'updated_at must be YYYY-MM-DD or an ISO 8601 datetime');
  }

  if ('status' in fm) {
    const allowed = allowedStatusValuesForType(artifact.type);
    if (typeof fm.status !== 'string' || !allowed.has(fm.status)) {
      pushIssue(issues, artifact, `status must be one of: ${[...allowed].join(', ')} (type=${artifact.type})`);
    }
  }

  if ('priority' in fm && fm.priority !== null && fm.priority !== undefined) {
    if (typeof fm.priority !== 'string' || !PRIORITY_VALUES.has(fm.priority)) {
      pushIssue(issues, artifact, `priority must be one of: ${[...PRIORITY_VALUES].join(', ')}`);
    }
  }

  if (
    'due_date' in fm &&
    fm.due_date !== null &&
    fm.due_date !== undefined &&
    !(isDateOnly(fm.due_date) || isIsoDateTime(fm.due_date))
  ) {
    pushIssue(issues, artifact, 'due_date must be YYYY-MM-DD');
  }

  if ('iteration' in fm && fm.iteration !== null && fm.iteration !== undefined) {
    if (typeof fm.iteration !== 'string' || !ITERATION_RE.test(fm.iteration)) {
      pushIssue(issues, artifact, 'iteration must use YYYY-WNN format, e.g. 2026-W10');
    }
  }

  if ('tags' in fm && fm.tags !== null && fm.tags !== undefined && !isStringArray(fm.tags)) {
    pushIssue(issues, artifact, 'tags must be an array of non-empty strings');
  }

  if ('definition_of_done' in fm && fm.definition_of_done !== null && fm.definition_of_done !== undefined && !isStringArray(fm.definition_of_done)) {
    pushIssue(issues, artifact, 'definition_of_done must be an array of non-empty strings');
  }

  if ('owners' in fm && fm.owners !== null && fm.owners !== undefined && !isStringArray(fm.owners)) {
    pushIssue(issues, artifact, 'owners must be an array of non-empty strings');
  }

  if ('attendees' in fm && fm.attendees !== null && fm.attendees !== undefined && !isStringArray(fm.attendees)) {
    pushIssue(issues, artifact, 'attendees must be an array of non-empty strings');
  }

  if ('watchers' in fm && fm.watchers !== null && fm.watchers !== undefined && !isStringArray(fm.watchers)) {
    pushIssue(issues, artifact, 'watchers must be an array of non-empty strings (member names)');
  }

  if ('sources' in fm && fm.sources !== null && fm.sources !== undefined && !Array.isArray(fm.sources)) {
    pushIssue(issues, artifact, 'sources must be an array');
  }

  if ('relations' in fm && fm.relations !== null && fm.relations !== undefined) {
    if (!Array.isArray(fm.relations)) {
      pushIssue(issues, artifact, 'relations must be an array');
    }
  }

  if (artifact.type === 'meeting') {
    if ('start_at' in fm && !isIsoDateTime(fm.start_at)) {
      pushIssue(issues, artifact, 'start_at must be an ISO 8601 datetime');
    }
    if ('end_at' in fm && !isIsoDateTime(fm.end_at)) {
      pushIssue(issues, artifact, 'end_at must be an ISO 8601 datetime');
    }
  }

  if (
    artifact.type === 'task' &&
    ['ready', 'blocked', 'doing'].includes(fm.status) &&
    (typeof fm.iteration !== 'string' || !ITERATION_RE.test(fm.iteration))
  ) {
    pushIssue(issues, artifact, 'task with status ready, blocked, or doing must declare iteration (YYYY-WNN)');
  }

  if (artifact.type === 'task' && 'x_slip_count' in fm && fm.x_slip_count !== null && fm.x_slip_count !== undefined) {
    if (!Number.isInteger(fm.x_slip_count) || fm.x_slip_count < 0) {
      pushIssue(issues, artifact, 'x_slip_count must be an integer >= 0 (written only by iteration carry-forward)');
    }
  }

  // Accept the ISO-datetime form too: YAML parses a bare date and the rewrite
  // helper serializes it back, so x_planned_date must round-trip either way.
  // decision_adr-product-initiative-kickoff: format checks for the kickoff
  // contract and component-level task dates.
  const dateFields = artifact.type === 'task'
    ? ['x_start_date', 'x_target_date']
    : artifact.type === 'initiative' ? ['x_kickoff_date'] : [];
  for (const field of dateFields) {
    if (field in fm && fm[field] !== null && fm[field] !== undefined && !(isDateOnly(fm[field]) || isIsoDateTime(fm[field]))) {
      pushIssue(issues, artifact, `${field} must be YYYY-MM-DD`);
    }
  }
  if (artifact.type === 'initiative') {
    if ('x_initiative_kind' in fm && fm.x_initiative_kind !== null && !INITIATIVE_KIND_VALUES.has(fm.x_initiative_kind)) {
      pushIssue(issues, artifact, `x_initiative_kind must be one of: ${[...INITIATIVE_KIND_VALUES].join(', ')}`);
    }
    for (const field of ['x_components', 'x_baseline_tasks']) {
      if (field in fm && fm[field] !== null && fm[field] !== undefined && !isStringArray(fm[field])) {
        pushIssue(issues, artifact, `${field} must be an array of non-empty strings`);
      }
    }
  }
  if (artifact.type === 'task' && 'x_component' in fm && fm.x_component !== null && (typeof fm.x_component !== 'string' || !fm.x_component.trim())) {
    pushIssue(issues, artifact, 'x_component must be a non-empty string');
  }

  if (
    artifact.type === 'task' &&
    'x_planned_date' in fm &&
    fm.x_planned_date !== null &&
    fm.x_planned_date !== undefined &&
    !(isDateOnly(fm.x_planned_date) || isIsoDateTime(fm.x_planned_date))
  ) {
    pushIssue(issues, artifact, 'x_planned_date must be YYYY-MM-DD');
  }
}
