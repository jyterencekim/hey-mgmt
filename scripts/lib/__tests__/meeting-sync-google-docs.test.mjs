import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGoogleDocSnapshot } from '../meeting-sync/google-docs.mjs';

const config = {
  defaults: {
    timezone: 'Asia/Seoul',
    default_owner: 'alice',
  },
  members: {
    alice: {
      gmail_addresses: ['alice@example.com'],
      notion_people: ['Alice', 'Alice Lee'],
    },
  },
};

function docsFixture() {
  return {
    title: 'Core Platform Daily',
    body: {
      content: [
        {
          paragraph: {
            elements: [{ textRun: { content: 'Date: Mar 23, 2026\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
        {
          paragraph: {
            elements: [{ textRun: { content: 'Time: 10:00 AM - 11:00 AM\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
        {
          paragraph: {
            elements: [{ textRun: { content: 'Attendees: Alice Lee, Partner X\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
        {
          paragraph: {
            elements: [{ textRun: { content: 'Owner: Alice Lee\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
        {
          paragraph: {
            elements: [{ textRun: { content: 'Notes\n' } }],
            paragraphStyle: { namedStyleType: 'HEADING_2' },
          },
        },
        {
          paragraph: {
            elements: [{ textRun: { content: 'Bridge status reviewed\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
      ],
    },
  };
}

describe('meeting sync google docs', () => {
  it('normalizes google docs content into a meeting snapshot', async () => {
    const snapshot = await fetchGoogleDocSnapshot({
      auth: {},
      config,
      googleDocId: 'doc_12345',
      fallbackTitle: 'Fallback title',
      gmailMessage: {
        gmail_message_id: 'msg-123',
        gmail_message_url: 'https://mail.google.com/mail/u/0/#all/msg-123',
        google_doc_url: 'https://docs.google.com/document/d/doc_12345/edit',
        updated_at: '2026-03-23T01:00:00.000Z',
      },
      docsService: {
        documents: {
          get: async () => ({ data: docsFixture() }),
        },
      },
      driveService: {
        files: {
          get: async () => ({ data: { id: 'doc_12345', webViewLink: 'https://docs.google.com/document/d/doc_12345/edit' } }),
        },
      },
    });

    assert.equal(snapshot.google_doc_id, 'doc_12345');
    assert.equal(snapshot.title, 'Core Platform Daily');
    assert.equal(snapshot.owner, 'alice');
    assert.deepEqual(snapshot.attendees, ['alice']);
    assert.deepEqual(snapshot.external_attendees, ['Partner X']);
    assert.equal(snapshot.parse_status, 'ready');
    assert.match(snapshot.notes_md, /Bridge status reviewed/);
    assert.equal(snapshot.start_at, '2026-03-23T01:00:00.000Z');
    assert.equal(snapshot.end_at, '2026-03-23T02:00:00.000Z');
  });
});
