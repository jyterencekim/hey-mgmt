import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { __testables__ } from '../meeting-sync/gmail.mjs';

const html = readFileSync(new URL('./fixtures/gmail-gemini-notification.html', import.meta.url), 'utf8');

function fakeMessage() {
  return {
    id: 'msg-123',
    threadId: 'thread-123',
    internalDate: String(Date.parse('2026-03-23T01:00:00Z')),
    payload: {
      headers: [
        { name: 'From', value: 'Gemini <gemini-notes@google.com>' },
        { name: 'To', value: 'jared.lee@kaia.io' },
        { name: 'Subject', value: 'Notes: “(Confirmed) Kaia Foundation Daily” Mar 23, 2026' },
      ],
      parts: [
        {
          mimeType: 'text/html',
          body: { data: Buffer.from(html).toString('base64url') },
        },
      ],
    },
  };
}

describe('meeting sync gmail parsing', () => {
  it('extracts the open meeting notes link ahead of attachment links', () => {
    const normalized = __testables__.normalizeNotificationMessage({
      message: fakeMessage(),
      config: {
        gmail: {
          allowed_sender: 'gemini-notes@google.com',
          subject_prefix: 'Notes:',
          link_priority: ['open_meeting_notes', 'attachment'],
        },
      },
    });

    assert.equal(normalized.google_doc_id, 'doc_12345');
    assert.equal(normalized.google_doc_url, 'https://docs.google.com/document/d/doc_12345/edit?usp=sharing');
    assert.equal(normalized.title, 'Kaia Foundation Daily');
    assert.equal(normalized.parse_status, 'linked');
  });

  it('classifies drive links as attachment fallbacks', () => {
    const ids = __testables__.extractGoogleIds('https://drive.google.com/file/d/file_98765/view?usp=sharing');
    assert.deepEqual(ids, {
      google_doc_id: null,
      google_file_id: 'file_98765',
    });
  });
});
