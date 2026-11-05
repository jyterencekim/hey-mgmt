import { formatKstDate, normalizeTitle } from './common.mjs';

function timeDistanceMs(left, right) {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftMs - rightMs);
}

function exactMatch(artifacts, field, value) {
  if (!value) return null;
  return artifacts.find((artifact) => artifact.frontmatter?.[field] === value) ?? null;
}

function isStubNote(artifact) {
  return artifact.type === 'note' && typeof artifact.frontmatter?.x_sync_parse_status === 'string';
}

export function matchMeetingSnapshot({ snapshot, artifacts, config }) {
  const meetings = artifacts.filter((artifact) => artifact.type === 'meeting');
  const stubs = artifacts.filter(isStubNote);

  const exactFields = [
    ['x_notion_page_id', snapshot.notion_page_id],
    ['x_calendar_event_id', snapshot.calendar_event_id],
    ['x_google_doc_id', snapshot.google_doc_id],
    ['x_gmail_message_id', snapshot.gmail_message_id],
  ];

  for (const [field, value] of exactFields) {
    const meeting = exactMatch(meetings, field, value);
    if (meeting) {
      return { meeting, stub: exactMatch(stubs, field, value), strategy: field };
    }
  }

  let stub = null;
  for (const [field, value] of exactFields) {
    stub = stub ?? exactMatch(stubs, field, value);
  }

  const title = normalizeTitle(snapshot.title);
  const date = formatKstDate(snapshot.start_at, config.defaults?.timezone);
  const toleranceMs = Number(config.matching?.start_tolerance_minutes ?? 180) * 60 * 1000;
  let best = null;

  for (const meeting of meetings) {
    if (normalizeTitle(meeting.title) !== title) continue;
    if (formatKstDate(meeting.frontmatter?.start_at, config.defaults?.timezone) !== date) continue;
    const distance = timeDistanceMs(meeting.frontmatter?.start_at, snapshot.start_at);
    if (distance > toleranceMs) continue;
    if (!best || distance < best.distance) {
      best = { meeting, distance };
    }
  }

  return {
    meeting: best?.meeting ?? null,
    stub,
    strategy: best ? 'title_date_start_proximity' : stub ? 'stub_only' : 'no_match',
  };
}
