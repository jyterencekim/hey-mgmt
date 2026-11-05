function isoWeekParts(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return {
    year: utc.getUTCFullYear(),
    week
  };
}

export function currentIteration(date = new Date()) {
  const { year, week } = isoWeekParts(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

const ITERATION_RE = /^(\d{4})-W(\d{2})$/;

/**
 * Monday..Sunday date range (YYYY-MM-DD) of an ISO iteration, or null when the
 * value is not a YYYY-WNN iteration string.
 */
export function iterationWeekRange(iteration) {
  const match = ITERATION_RE.exec(String(iteration ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // Jan 4 is always inside ISO week 1; walk back to that week's Monday, then
  // forward (week - 1) weeks.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (day - 1) + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const iso = (date) => date.toISOString().slice(0, 10);
  return { start: iso(monday), end: iso(sunday) };
}

/** The iteration one ISO week after the given one (handles year boundaries). */
export function nextIteration(iteration) {
  const range = iterationWeekRange(iteration);
  if (!range) return null;
  const monday = new Date(`${range.start}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() + 7);
  // Re-derive via isoWeekParts with a local date whose Y/M/D match the UTC
  // components, so the caller's timezone cannot shift the week.
  return currentIteration(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 12));
}

/**
 * Lexicographic compare is correct for YYYY-WNN (year leads, week zero-padded),
 * including across year boundaries (2026-W53 < 2027-W01).
 */
export function compareIterations(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''));
}
