import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listNotionMeetingSnapshots } from '../meeting-sync/notion.mjs';

const config = {
  defaults: {
    default_owner: 'alice',
  },
  notion: {
    database_id: 'db-123',
    properties: {
      title: 'Title',
      start_at: 'Start',
      end_at: 'End',
      attendees: 'Attendees',
      owner: 'Owner',
      calendar_event_id: 'Calendar Event ID',
      source_url: 'Source URL',
    },
  },
  members: {
    alice: {
      notion_people: ['Alice', 'Alice Lee'],
      gmail_addresses: ['alice@example.com'],
    },
    charlie: {
      notion_people: ['Charlie'],
      gmail_addresses: [],
    },
  },
};

describe('meeting sync notion import', () => {
  it('maps a notion database row into a canonical meeting snapshot', async () => {
    const notion = {
      databases: {
        query: async () => ({
          results: [
            {
              id: 'page-123',
              url: 'https://notion.so/page-123',
              last_edited_time: '2026-03-23T01:00:00.000Z',
              properties: {
                Title: { type: 'title', title: [{ plain_text: 'Core Platform Daily' }] },
                Start: { type: 'date', date: { start: '2026-03-23T01:00:00.000Z' } },
                End: { type: 'date', date: { start: '2026-03-23T02:00:00.000Z' } },
                Attendees: {
                  type: 'people',
                  people: [{ name: 'Alice Lee', person: { email: 'alice@example.com' } }, { name: 'Partner X', person: { email: 'partner@example.com' } }],
                },
                Owner: { type: 'people', people: [{ name: 'Alice Lee', person: { email: 'alice@example.com' } }] },
                'Calendar Event ID': { type: 'rich_text', rich_text: [{ plain_text: 'cal-123' }] },
                'Source URL': { type: 'url', url: 'https://docs.google.com/document/d/doc_12345/edit' },
              },
            },
          ],
        }),
      },
      blocks: {
        children: {
          list: async () => ({
            results: [
              {
                id: 'block-1',
                type: 'heading_2',
                has_children: false,
                heading_2: { rich_text: [{ plain_text: 'Notes' }] },
              },
              {
                id: 'block-2',
                type: 'paragraph',
                has_children: false,
                paragraph: { rich_text: [{ plain_text: 'Bridge status reviewed' }] },
              },
              {
                id: 'block-3',
                type: 'to_do',
                has_children: false,
                to_do: { checked: false, rich_text: [{ plain_text: 'Share updated action list' }] },
              },
            ],
            has_more: false,
            next_cursor: null,
          }),
        },
      },
    };

    const [snapshot] = await listNotionMeetingSnapshots({
      notion,
      config,
      since: '2026-03-22T00:00:00.000Z',
      limit: 10,
    });

    assert.equal(snapshot.notion_page_id, 'page-123');
    assert.equal(snapshot.title, 'Core Platform Daily');
    assert.equal(snapshot.owner, 'alice');
    assert.deepEqual(snapshot.attendees, ['alice']);
    assert.deepEqual(snapshot.external_attendees, ['partner@example.com']);
    assert.equal(snapshot.calendar_event_id, 'cal-123');
    assert.match(snapshot.notes_md, /Bridge status reviewed/);
    assert.deepEqual(snapshot.action_items, ['Share updated action list']);
    assert.equal(snapshot.parse_status, 'ready');
  });
});
