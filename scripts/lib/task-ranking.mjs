// Shared focus-task ranker. Single source of truth for "what should I work on?"
// across `/morning`, `/check`, `/standup`, Fisher's daily-sync digest, and any
// other surface that needs an ordered shortlist of a member's tasks.
//
// Priority labels are Eisenhower quadrants (do/plan/routine/drop) — see
// content/decisions/decision_adr-replace-p0-p3-priority-wit.md. The ranker
// composes:
//   1. in-flight (claimed) tasks first
//   2. overdue tasks hoisted (urgency override — overdue is a forcing signal
//      regardless of declared priority)
//   3. status: doing > ready > blocked
//   4. priority: do > plan > routine > drop
//   5. urgency bucket within priority (overdue/today/this-week/later/none)
//   6. carry-over from yesterday's plan
//   7. tiebreakers: due_date asc, created_at asc, id asc

export const PRIORITY_RANK = Object.freeze({ do: 0, plan: 1, routine: 2, drop: 3 });
export const STATUS_RANK = Object.freeze({ doing: 0, ready: 1, blocked: 2 });
export const FOCUSABLE_STATUSES = Object.freeze(new Set(['ready', 'doing', 'blocked']));

const FALLBACK_RANK = 9;
const SENTINEL_DATE = '9999-99-99';

function urgencyBucket(dueDate, today) {
  if (!dueDate) return 4;
  if (!today) return 3;
  if (dueDate < today) return 0;
  if (dueDate === today) return 1;
  const dueMs = Date.parse(`${dueDate}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (Number.isFinite(dueMs) && Number.isFinite(todayMs)) {
    const days = Math.round((dueMs - todayMs) / 86_400_000);
    if (days <= 7) return 2;
    return 3;
  }
  return 3;
}

function isOverdue(task, today) {
  return Boolean(task.due_date && today && task.due_date < today);
}

function reasonsFor(task, { today, inFlightId, carrySet }) {
  const reasons = [];
  if (inFlightId && task.id === inFlightId) reasons.push('in-flight');
  if (isOverdue(task, today)) reasons.push(`overdue (${task.due_date})`);
  if (task.status === 'doing') reasons.push('doing');
  else if (task.status === 'blocked') reasons.push('blocked');
  if (task.priority && PRIORITY_RANK[task.priority] !== undefined) {
    reasons.push(`priority=${task.priority}`);
  }
  if (task.due_date && !isOverdue(task, today)) {
    if (today && task.due_date === today) reasons.push('due today');
    else reasons.push(`due ${task.due_date}`);
  }
  if (carrySet.has(task.id)) reasons.push('carried over');
  return reasons;
}

function compareScore(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) continue;
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv));
  }
  return 0;
}

export function scoreTask(task, { today = null, inFlightId = null, carrySet = new Set() } = {}) {
  const inFlight = inFlightId && task.id === inFlightId ? 0 : 1;
  const overdue = isOverdue(task, today) ? 0 : 1;
  const status = STATUS_RANK[task.status] ?? FALLBACK_RANK;
  const priority = PRIORITY_RANK[task.priority] ?? FALLBACK_RANK;
  const urgency = urgencyBucket(task.due_date, today);
  const carry = carrySet.has(task.id) ? 0 : 1;
  return [
    inFlight,
    overdue,
    status,
    priority,
    urgency,
    carry,
    task.due_date || SENTINEL_DATE,
    task.created_at || SENTINEL_DATE,
    task.id || '',
  ];
}

export function rankFocusTasks({
  tasks,
  today = null,
  member = null,
  inFlightId = null,
  carryOver = [],
  includeBlocked = true,
  limit = null,
} = {}) {
  const carrySet = new Set(carryOver);
  const allowedStatuses = new Set(FOCUSABLE_STATUSES);
  if (!includeBlocked) allowedStatuses.delete('blocked');

  const candidates = (tasks ?? [])
    .filter((t) => t && t.type === 'task')
    .filter((t) => allowedStatuses.has(t.status))
    .filter((t) => (member ? t.owner === member : true));

  const ranked = candidates
    .map((task) => ({
      task,
      score: scoreTask(task, { today, inFlightId, carrySet }),
      reasons: reasonsFor(task, { today, inFlightId, carrySet }),
    }))
    .sort((a, b) => compareScore(a.score, b.score));

  return typeof limit === 'number' && limit > 0 ? ranked.slice(0, limit) : ranked;
}

export function partitionForFocus({
  tasks,
  today = null,
  member = null,
  inFlightId = null,
  carryOver = [],
  focusLimit = 5,
} = {}) {
  const ranked = rankFocusTasks({ tasks, today, member, inFlightId, carryOver, includeBlocked: true });
  const focus = [];
  const blocked = [];
  for (const entry of ranked) {
    if (entry.task.status === 'blocked') blocked.push(entry);
    else if (focus.length < focusLimit) focus.push(entry);
  }
  return { focus, blocked };
}
