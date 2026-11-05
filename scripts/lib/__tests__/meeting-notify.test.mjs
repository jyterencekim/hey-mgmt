import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { notifyMeeting } from '../meeting-notify.mjs';
import { notifyMeetingAction } from '../meeting-sync/importer.mjs';
import { listInboxItems } from '../inbox.mjs';

const MEMBERS_YML = `members:
  - name: jared
    role: lead-and-product-manager
  - name: oliver
    role: strategy-and-finance
  - name: terence
    role: backend-frontend-engineer
  - name: eb
    role: engineering-lead
  - name: benji
    role: external-linecorp
  - name: team
    role: shared
`;

const MEETING_MD = `---
id: meeting_test-2026-05-04
type: meeting
title: Test Meeting
owner: jared
attendees:
  - jared
  - terence
  - benji
---

## Notes

Meeting body here.
`;

const NOTE_MD = `---
id: note_test-2026-05-04
type: note
title: Not a meeting
owner: jared
---

Body.
`;

function setupRepo() {
  const root = resolve(tmpdir(), `test-meeting-notify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(resolve(root, 'content', 'vocab'), { recursive: true });
  mkdirSync(resolve(root, 'content', 'meetings', '2026', '05'), { recursive: true });
  mkdirSync(resolve(root, 'workspace', 'jared'), { recursive: true });
  mkdirSync(resolve(root, 'workspace', 'oliver'), { recursive: true });
  mkdirSync(resolve(root, 'workspace', 'terence'), { recursive: true });
  mkdirSync(resolve(root, 'workspace', 'eb'), { recursive: true });
  writeFileSync(resolve(root, 'content', 'vocab', 'members.yml'), MEMBERS_YML, 'utf8');
  writeFileSync(resolve(root, 'content', 'meetings', '2026', '05', 'meeting_test-2026-05-04.md'), MEETING_MD, 'utf8');
  writeFileSync(resolve(root, 'content', 'meetings', '2026', '05', 'note_test-2026-05-04.md'), NOTE_MD, 'utf8');
  return root;
}

describe('meeting-notify', () => {
  let root;

  beforeEach(() => { root = setupRepo(); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('sends a read request to all four team members, including owner and non-attendees', async () => {
    const meetingPath = resolve(root, 'content', 'meetings', '2026', '05', 'meeting_test-2026-05-04.md');
    const result = await notifyMeeting({ repoRoot: root, meetingPath });

    assert.equal(result.meeting_id, 'meeting_test-2026-05-04');
    assert.deepEqual(result.sent.map((entry) => entry.recipient), ['jared', 'oliver', 'terence', 'eb']);

    for (const recipient of ['jared', 'oliver', 'terence', 'eb']) {
      const items = listInboxItems({ repoRoot: root, workspace: recipient });
      assert.equal(items.length, 1);
      assert.ok(items[0].title.includes('읽어주세요'));
      assert.ok(items[0].body.includes('새 미팅록이 등록되었습니다. 읽어주세요.'));
      assert.ok(items[0].body.includes('Meeting body here'));
      assert.equal(items[0].metadata.x_meeting_id, 'meeting_test-2026-05-04');
      assert.equal(items[0].metadata.x_kind, 'meeting-notify');
    }
  });

  it('already-sent: second call is a no-op (ledger respected)', async () => {
    const meetingPath = resolve(root, 'content', 'meetings', '2026', '05', 'meeting_test-2026-05-04.md');

    const r1 = await notifyMeeting({ repoRoot: root, meetingPath });
    assert.equal(r1.sent.length, 4);

    const r2 = await notifyMeeting({ repoRoot: root, meetingPath });
    assert.equal(r2.sent.length, 0);
    assert.deepEqual(r2.skipped_already_sent, ['jared', 'oliver', 'terence', 'eb']);

    const items = listInboxItems({ repoRoot: root, workspace: 'terence' });
    assert.equal(items.length, 1);
  });

  it('automated meeting import actions invoke the all-team notifier', async () => {
    const action = {
      result: {
        artifact_type: 'meeting',
        artifact_path: 'content/meetings/2026/05/meeting_test-2026-05-04.md',
      },
    };

    const result = await notifyMeetingAction({ repoRoot: root, action, dryRun: false });

    assert.equal(result.notification.sent.length, 4);
    assert.deepEqual(result.notification.sent.map((entry) => entry.recipient), ['jared', 'oliver', 'terence', 'eb']);
    assert.ok(result.notification.sent.every((entry) => entry.path.startsWith('workspace/')));
  });

  it('not a meeting: returns skipped reason', async () => {
    const notePath = resolve(root, 'content', 'meetings', '2026', '05', 'note_test-2026-05-04.md');
    const result = await notifyMeeting({ repoRoot: root, meetingPath: notePath });
    assert.deepEqual(result, { skipped: 'not-a-meeting' });
  });

  it('dry run: no inbox files created, no ledger written', async () => {
    const meetingPath = resolve(root, 'content', 'meetings', '2026', '05', 'meeting_test-2026-05-04.md');
    const result = await notifyMeeting({ repoRoot: root, meetingPath, dryRun: true });

    assert.equal(result.dry_run, true);
    assert.deepEqual(result.would_send, ['jared', 'oliver', 'terence', 'eb']);

    for (const recipient of ['jared', 'oliver', 'terence', 'eb']) {
      assert.equal(listInboxItems({ repoRoot: root, workspace: recipient }).length, 0);
    }

    const ledger = resolve(root, '.hey', 'sent-meeting-notify.jsonl');
    assert.equal(existsSync(ledger), false);
  });
});
