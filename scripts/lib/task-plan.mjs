import { iterationWeekRange } from './iteration.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Statuses that can still be scheduled. Terminal work has no weekday. */
const PLANNABLE_STATUSES = new Set(['plan', 'ready', 'doing', 'blocked']);

/**
 * Decide whether `date` is a legal `x_planned_date` for a task.
 *
 * This is the write-side mirror of hygiene rule (e): that rule *detects*
 * planned dates with no iteration, or outside their iteration's week, and
 * proposes stripping them. Rejecting the same two shapes here means the CLI
 * cannot mint a row the hygiene check would immediately ask to delete.
 *
 * Layer discipline from `decision_adr-three-layer-task-timeline`:
 * `x_planned_date` is a weekday *inside a committed iteration*. A task with no
 * iteration has made no commitment, so there is nothing to schedule inside —
 * that is an error to surface, not a gap to paper over by inventing one.
 *
 * @returns {{ok: true, date: string, range: {start: string, end: string}} | {ok: false, error: string}}
 */
export function validatePlannedDate({ date, iteration, status }) {
  if (!DATE_RE.test(String(date ?? ''))) {
    return { ok: false, error: `--date must be YYYY-MM-DD, got: ${date ?? '(none)'}` };
  }

  if (status !== undefined && status !== null && !PLANNABLE_STATUSES.has(status)) {
    return {
      ok: false,
      error: `task status "${status}" cannot be planned (plannable: ${[...PLANNABLE_STATUSES].join(', ')})`,
    };
  }

  if (!iteration) {
    return {
      ok: false,
      error:
        'task has no iteration. x_planned_date is a weekday inside a committed iteration — ' +
        'commit the task to an iteration first, then plan a day inside it.',
    };
  }

  const range = iterationWeekRange(iteration);
  if (!range) {
    return { ok: false, error: `iteration "${iteration}" is not a YYYY-WNN value` };
  }

  if (date < range.start || date > range.end) {
    return {
      ok: false,
      error: `${date} is outside ${iteration} (${range.start}..${range.end}). ` +
        'Re-commit the task to the iteration that contains that day, or pick a day inside this one.',
    };
  }

  return { ok: true, date, range };
}
