import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchMeetingCandidate } from '../meeting-candidates.mjs';

function meetingArtifact({ id, title, start_at, x_calendar_event_id = null }) {
  return {
    id,
    type: 'meeting',
    title,
    frontmatter: {
      start_at,
      x_calendar_event_id,
    },
  };
}

describe('meeting candidate matching', () => {
  it('matches recurring event instances by exact calendar_event_id before any fuzzy fallback', () => {
    const artifacts = [
      meetingArtifact({
        id: 'meeting_ops-sync-2026-03-10',
        title: 'Ops Sync',
        start_at: '2026-03-10T01:00:00Z',
        x_calendar_event_id: 'series-instance-1',
      }),
      meetingArtifact({
        id: 'meeting_ops-sync-2026-03-17',
        title: 'Ops Sync',
        start_at: '2026-03-17T01:00:00Z',
        x_calendar_event_id: 'series-instance-2',
      }),
    ];

    const result = matchMeetingCandidate({
      candidate: {
        calendar_event_id: 'series-instance-2',
        title: 'Ops Sync',
        start_at: '2026-03-17T01:00:00Z',
      },
      artifacts,
    });

    assert.equal(result.strategy, 'exact_calendar_event_id');
    assert.equal(result.match.id, 'meeting_ops-sync-2026-03-17');
  });

  it('keeps exact calendar_event_id match even when the meeting was rescheduled', () => {
    const artifacts = [
      meetingArtifact({
        id: 'meeting_launch-review',
        title: 'Launch Review',
        start_at: '2026-03-16T01:00:00Z',
        x_calendar_event_id: 'calendar-123',
      }),
    ];

    const result = matchMeetingCandidate({
      candidate: {
        calendar_event_id: 'calendar-123',
        title: 'Launch Review',
        start_at: '2026-03-16T03:30:00Z',
      },
      artifacts,
    });

    assert.equal(result.strategy, 'exact_calendar_event_id');
    assert.equal(result.match.id, 'meeting_launch-review');
  });

  it('skips cancelled events instead of attempting to match them', () => {
    const artifacts = [
      meetingArtifact({
        id: 'meeting_partner-call',
        title: 'Partner Call',
        start_at: '2026-03-16T05:00:00Z',
        x_calendar_event_id: 'cancelled-1',
      }),
    ];

    const result = matchMeetingCandidate({
      candidate: {
        calendar_event_id: 'cancelled-1',
        title: 'Partner Call',
        start_at: '2026-03-16T05:00:00Z',
        status: 'cancelled',
      },
      artifacts,
    });

    assert.equal(result.strategy, 'skip_cancelled');
    assert.equal(result.reason, 'cancelled_event');
    assert.equal(result.match, null);
  });

  it('disambiguates same-title same-day meetings by nearest start_at when no calendar_event_id exists', () => {
    const artifacts = [
      meetingArtifact({
        id: 'meeting_weekly-sync-am',
        title: 'Weekly Sync',
        start_at: '2026-03-16T00:00:00Z',
      }),
      meetingArtifact({
        id: 'meeting_weekly-sync-pm',
        title: 'Weekly Sync',
        start_at: '2026-03-16T06:00:00Z',
      }),
    ];

    const result = matchMeetingCandidate({
      candidate: {
        title: 'Weekly   Sync',
        start_at: '2026-03-16T06:20:00Z',
      },
      artifacts,
    });

    assert.equal(result.strategy, 'title_start_proximity');
    assert.equal(result.match.id, 'meeting_weekly-sync-pm');
    assert.equal(result.distance_minutes, 20);
  });
});
