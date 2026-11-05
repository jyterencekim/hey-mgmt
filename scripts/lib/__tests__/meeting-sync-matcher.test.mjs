import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchMeetingSnapshot } from '../meeting-sync/matcher.mjs';

function artifact({ id, type, title, frontmatter }) {
  return {
    id,
    type,
    title,
    frontmatter,
  };
}

const config = {
  defaults: {
    timezone: 'Asia/Seoul',
  },
  matching: {
    start_tolerance_minutes: 180,
  },
};

describe('meeting sync matcher', () => {
  it('prefers exact google doc matches', () => {
    const result = matchMeetingSnapshot({
      snapshot: {
        title: 'Core Platform Daily',
        google_doc_id: 'doc-123',
        start_at: '2026-03-23T01:00:00.000Z',
      },
      artifacts: [
        artifact({
          id: 'meeting_daily-sync',
          type: 'meeting',
          title: 'Core Platform Daily',
          frontmatter: { x_google_doc_id: 'doc-123', start_at: '2026-03-23T01:00:00.000Z' },
        }),
      ],
      config,
    });

    assert.equal(result.meeting.id, 'meeting_daily-sync');
    assert.equal(result.strategy, 'x_google_doc_id');
  });

  it('matches gmail-created stubs before fuzzy fallback', () => {
    const result = matchMeetingSnapshot({
      snapshot: {
        title: 'Core Platform Daily',
        gmail_message_id: 'msg-123',
        start_at: '2026-03-23T01:00:00.000Z',
      },
      artifacts: [
        artifact({
          id: 'note_stub-123',
          type: 'note',
          title: 'Core Platform Daily',
          frontmatter: { x_gmail_message_id: 'msg-123', x_sync_parse_status: 'pending_fetch' },
        }),
      ],
      config,
    });

    assert.equal(result.stub.id, 'note_stub-123');
    assert.equal(result.strategy, 'stub_only');
  });

  it('falls back to title/date/start_at proximity when exact ids are absent', () => {
    const result = matchMeetingSnapshot({
      snapshot: {
        title: 'Core Platform Daily',
        start_at: '2026-03-23T01:20:00.000Z',
      },
      artifacts: [
        artifact({
          id: 'meeting_daily-sync',
          type: 'meeting',
          title: 'Core Platform Daily',
          frontmatter: { start_at: '2026-03-23T01:00:00.000Z' },
        }),
      ],
      config,
    });

    assert.equal(result.meeting.id, 'meeting_daily-sync');
    assert.equal(result.strategy, 'title_date_start_proximity');
  });
});
