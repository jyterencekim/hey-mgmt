import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { readArtifacts } from '../content-io.mjs';
import { applyMeetingSnapshot } from '../meeting-sync/writer.mjs';

function initRepo() {
  const repoRoot = mkdtempSync(resolve(tmpdir(), 'meeting-sync-writer-'));
  mkdirSync(resolve(repoRoot, 'content', 'vocab'), { recursive: true });
  mkdirSync(resolve(repoRoot, 'content', 'policies'), { recursive: true });
  writeFileSync(resolve(repoRoot, 'content', 'vocab', 'members.yml'), 'members:\n  - name: alice\n    role: lead\n  - name: team\n    role: shared\n');
  writeFileSync(resolve(repoRoot, 'content', 'vocab', 'areas.yml'), 'areas:\n  - name: Team\n    status: active\n');
  writeFileSync(resolve(repoRoot, 'content', 'vocab', 'tags.yml'), 'tags:\n  - Ops\n');
  writeFileSync(resolve(repoRoot, 'content', 'vocab', 'entities.yml'), 'entities: []\n');
  writeFileSync(resolve(repoRoot, 'content', 'policies', 'governance.yml'), 'sources_policy:\n  decision:\n    min_refs: 2\n');
  return repoRoot;
}

const config = {
  defaults: {
    timezone: 'Asia/Seoul',
    default_owner: 'alice',
    default_project: 'Team',
    meeting_status: 'active',
    note_status: 'active',
  },
  matching: {
    start_tolerance_minutes: 180,
  },
  members: {
    alice: {
      gmail_addresses: ['alice@example.com'],
      notion_people: ['Alice', 'Alice Lee'],
    },
  },
};

describe('meeting sync writer', () => {
  it('creates stubs, promotes them into meetings, and preserves notion authority', () => {
    const repoRoot = initRepo();

    const stubResult = applyMeetingSnapshot({
      repoRoot,
      config,
      snapshot: {
        source: 'gmail',
        title: 'Core Platform Daily',
        google_doc_id: 'doc-123',
        gmail_message_id: 'msg-123',
        owner: 'alice',
        attendees: [],
        external_attendees: [],
        updated_at: '2026-03-23T01:00:00.000Z',
        parse_status: 'pending_fetch',
        source_urls: ['https://docs.google.com/document/d/doc-123/edit'],
      },
      dryRun: false,
    });

    assert.equal(stubResult.result.artifact_type, 'note');

    const notionResult = applyMeetingSnapshot({
      repoRoot,
      config,
      snapshot: {
        source: 'notion',
        title: 'Core Platform Daily',
        google_doc_id: 'doc-123',
        notion_page_id: 'page-123',
        calendar_event_id: 'cal-123',
        start_at: '2026-03-23T01:00:00.000Z',
        end_at: '2026-03-23T02:00:00.000Z',
        owner: 'alice',
        attendees: ['alice'],
        external_attendees: ['Partner X'],
        notes_md: 'Notion authoritative notes',
        action_items: ['Share updated action list'],
        parse_status: 'ready',
        source_urls: ['https://notion.so/page-123'],
      },
      dryRun: false,
    });

    assert.equal(notionResult.result.artifact_type, 'meeting');
    assert.ok(notionResult.archived_stub);

    const gmailUpdate = applyMeetingSnapshot({
      repoRoot,
      config,
      snapshot: {
        source: 'gmail',
        title: 'Core Platform Daily',
        google_doc_id: 'doc-123',
        gmail_message_id: 'msg-123',
        start_at: '2026-03-23T01:00:00.000Z',
        end_at: '2026-03-23T02:00:00.000Z',
        owner: 'alice',
        attendees: ['alice'],
        external_attendees: ['Partner X'],
        notes_md: 'gmail overwrite attempt',
        action_items: ['Should not replace notion'],
        parse_status: 'ready',
        source_urls: ['https://docs.google.com/document/d/doc-123/edit'],
      },
      dryRun: false,
    });

    assert.equal(gmailUpdate.result.artifact_type, 'meeting');

    const artifacts = readArtifacts(resolve(repoRoot, 'content'));
    const meeting = artifacts.find((artifact) => artifact.type === 'meeting');
    const stub = artifacts.find((artifact) => artifact.type === 'note');

    assert.equal(meeting.frontmatter.x_source_authority, 'notion');
    assert.match(meeting.body, /Notion authoritative notes/);
    assert.doesNotMatch(meeting.body, /gmail overwrite attempt/);
    assert.ok(meeting.relationsOut.find((relation) => relation.type === 'supersedes' && relation.target === stub.id));
    assert.equal(stub.frontmatter.status, 'archived');
  });
});
