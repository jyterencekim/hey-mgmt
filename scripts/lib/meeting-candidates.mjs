function normalizeTitle(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function kstDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function timeDistanceMs(left, right) {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftMs - rightMs);
}

function isCancelledCandidate(candidate) {
  return candidate?.cancelled === true || candidate?.status === 'cancelled';
}

export function matchMeetingCandidate({ candidate, artifacts, startToleranceMinutes = 180 }) {
  if (isCancelledCandidate(candidate)) {
    return {
      match: null,
      strategy: 'skip_cancelled',
      reason: 'cancelled_event',
    };
  }

  const eventId = candidate?.calendar_event_id;
  if (eventId) {
    const exact = artifacts.find((artifact) => artifact.frontmatter?.x_calendar_event_id === eventId);
    if (exact) {
      return {
        match: exact,
        strategy: 'exact_calendar_event_id',
      };
    }
  }

  const title = normalizeTitle(candidate?.title);
  const candidateDate = kstDate(candidate?.start_at);
  const titled = artifacts.filter((artifact) => normalizeTitle(artifact.title) === title);
  if (titled.length === 0) {
    return {
      match: null,
      strategy: 'no_match',
      reason: 'title_not_found',
    };
  }

  const sameDay = titled.filter((artifact) => kstDate(artifact.frontmatter?.start_at) === candidateDate);
  const pool = sameDay.length > 0 ? sameDay : titled;
  const toleranceMs = startToleranceMinutes * 60 * 1000;

  let best = null;
  for (const artifact of pool) {
    const distanceMs = timeDistanceMs(artifact.frontmatter?.start_at, candidate?.start_at);
    if (distanceMs > toleranceMs) continue;
    if (!best || distanceMs < best.distanceMs) {
      best = { artifact, distanceMs };
    }
  }

  if (!best) {
    return {
      match: null,
      strategy: 'no_match',
      reason: 'start_at_not_within_tolerance',
    };
  }

  return {
    match: best.artifact,
    strategy: 'title_start_proximity',
    distance_minutes: Math.round(best.distanceMs / 60000),
  };
}
