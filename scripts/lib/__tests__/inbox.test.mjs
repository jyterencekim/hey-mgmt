import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { acknowledgeInboxItem, captureInboxItem, getInboxItem, listInboxItems, promoteInboxItem, sendInboxItem } from '../inbox.mjs';

let tmpRoot;

function setupTmpRepo() {
  tmpRoot = resolve(tmpdir(), `test-inbox-${Date.now()}`);
  mkdirSync(resolve(tmpRoot, 'workspace', 'jared'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'content', 'notes', '2026', '03'), { recursive: true });
}

describe('inbox flow', () => {
  beforeEach(setupTmpRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('captures raw input outside the structured artifact graph', () => {
    const { item, path } = captureInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      title: 'Slack request',
      body: 'Can we investigate oracle fallback drift?',
      source: 'slack://superearn/123'
    });

    const listed = listInboxItems({ repoRoot: tmpRoot, workspace: 'jared' });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, item.id);
    assert.equal(listed[0].status, 'open');
    assert.ok(path.includes('workspace/jared/inbox/open/'));
  });

  it('captures with kind field defaulting to self', () => {
    const { item } = captureInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      title: 'Self capture',
      body: 'My own item',
    });

    assert.equal(item.kind, 'self');
  });

  it('promotes an inbox item into a canonical artifact with namespaced linkage', () => {
    const { item } = captureInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      title: 'Slack request',
      body: 'Can we investigate oracle fallback drift?'
    });

    const result = promoteInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      itemId: item.id,
      type: 'note',
      title: 'Investigate oracle fallback drift',
      extraFields: { owner: 'jared', status: 'active' }
    });

    const raw = readFileSync(resolve(tmpRoot, result.artifact.path), 'utf8');
    assert.ok(raw.includes('x_inbox_item_id'));
    assert.ok(raw.includes('## Raw Input'));
    assert.ok(raw.includes('oracle fallback drift'));
  });

  it('acknowledges an inbox item and moves it out of the default open queue', () => {
    const { item } = captureInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      title: 'Slack request',
      body: 'Can we investigate oracle fallback drift?'
    });

    const acknowledged = acknowledgeInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      itemId: item.id,
      context: { command: 'inbox ack' },
    });

    assert.equal(acknowledged.status, 'read');
    assert.ok(existsSync(resolve(tmpRoot, 'workspace', 'jared', 'inbox', 'read', `${item.id}.json`)));

    const openItems = listInboxItems({ repoRoot: tmpRoot, workspace: 'jared' });
    const allItems = listInboxItems({ repoRoot: tmpRoot, workspace: 'jared', includeAll: true });
    const readItems = listInboxItems({ repoRoot: tmpRoot, workspace: 'jared', status: 'read' });

    assert.equal(openItems.length, 0);
    assert.equal(allItems.length, 1);
    assert.equal(readItems.length, 1);
    assert.equal(readItems[0].id, item.id);
  });

  it('annotates open inbox items whose linked task is already terminal', () => {
    mkdirSync(resolve(tmpRoot, 'content', 'tasks', '2026', '05'), { recursive: true });
    writeFileSync(
      resolve(tmpRoot, 'content', 'tasks', '2026', '05', 'task_feather.md'),
      [
        '---',
        'id: task_feather',
        'type: task',
        'title: Feather DD',
        'status: done',
        'owner: jared',
        "updated_at: '2026-05-15'",
        '---',
        '',
        '## Context',
        '',
      ].join('\n'),
      'utf8',
    );

    const { item } = captureInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      title: 'Feather follow-up',
      body: 'Please finish the Jared DD rows.',
      metadata: { x_task_ref: 'task_feather' },
    });

    const [listed] = listInboxItems({ repoRoot: tmpRoot, workspace: 'jared' });

    assert.equal(listed.id, item.id);
    assert.equal(listed.status, 'open');
    assert.deepEqual(listed.linked_task, {
      id: 'task_feather',
      title: 'Feather DD',
      status: 'done',
      owner: 'jared',
      updated_at: '2026-05-15',
      path: 'tasks/2026/05/task_feather.md',
    });
    assert.equal(listed.stale_reason, 'linked task task_feather is done');
  });

  it('can list inbox items without linked task cross-check annotations', () => {
    const { item } = captureInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      title: 'Task-linked item',
      body: '',
      metadata: { x_task_ref: 'task_missing' },
    });

    const [listed] = listInboxItems({
      repoRoot: tmpRoot,
      workspace: 'jared',
      includeTaskStatus: false,
    });

    assert.equal(listed.id, item.id);
    assert.equal(listed.linked_task, undefined);
    assert.equal(listed.stale_reason, undefined);
  });

  it('falls back to the inbox item title when no override is provided', () => {
    const { item } = captureInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      title: 'Slack request',
      body: 'Can we investigate oracle fallback drift?'
    });

    const result = promoteInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      itemId: item.id,
      type: 'note',
      extraFields: { owner: 'jared', status: 'active' }
    });

    assert.ok(result.artifact.id.startsWith('note_'));
    const raw = readFileSync(resolve(tmpRoot, result.artifact.path), 'utf8');
    assert.ok(raw.includes('Slack request'));
    assert.ok(raw.includes('x_inbox_item_id'));
  });

  it('can promote an already acknowledged inbox item', () => {
    const { item } = captureInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      title: 'Slack request',
      body: 'Can we investigate oracle fallback drift?'
    });

    acknowledgeInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      itemId: item.id,
      context: { command: 'inbox ack' },
    });

    const result = promoteInboxItem({
      repoRoot: tmpRoot,
      workspace: 'jared',
      itemId: item.id,
      type: 'note',
      title: 'Investigate oracle fallback drift',
      extraFields: { owner: 'jared', status: 'active' }
    });

    const promoted = getInboxItem({ repoRoot: tmpRoot, workspace: 'jared', itemId: item.id });
    assert.equal(promoted.status, 'promoted');
    assert.ok(existsSync(resolve(tmpRoot, 'workspace', 'jared', 'inbox', 'promoted', `${item.id}.json`)));

    const raw = readFileSync(resolve(tmpRoot, result.artifact.path), 'utf8');
    assert.ok(raw.includes('x_inbox_item_id'));
  });
});

function setupTmpRepoWithMembers() {
  const root = resolve(tmpdir(), `test-inbox-send-${Date.now()}`);
  mkdirSync(resolve(root, 'workspace', 'jared'), { recursive: true });
  mkdirSync(resolve(root, 'workspace', 'terence'), { recursive: true });
  mkdirSync(resolve(root, 'content', 'vocab'), { recursive: true });
  mkdirSync(resolve(root, 'content', 'notes', '2026', '03'), { recursive: true });
  writeFileSync(resolve(root, 'content', 'vocab', 'members.yml'), 'members:\n  - name: jared\n    role: lead\n  - name: terence\n    role: engineer\n  - name: agent\n    role: automation\n', 'utf8');
  return root;
}

describe('cross-member inbox send', () => {
  let root;

  beforeEach(() => { root = setupTmpRepoWithMembers(); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('sends an inbox item to another member workspace', () => {
    const { item, path } = sendInboxItem({
      repoRoot: root,
      from: 'terence',
      to: 'jared',
      title: 'Review bridge config',
      body: 'Please check the new oracle params',
    });

    assert.equal(item.kind, 'member-send');
    assert.equal(item.source, 'member:terence');
    assert.equal(item.workspace, 'jared');
    assert.equal(item.status, 'open');
    assert.equal(item.metadata.x_from, 'terence');
    assert.ok(item.metadata.x_sent_at);
    assert.ok(path.includes('workspace/jared/inbox/open/'));
  });

  it('includes task reference in metadata when provided', () => {
    const { item } = sendInboxItem({
      repoRoot: root,
      from: 'terence',
      to: 'jared',
      title: 'Bridge task handoff',
      body: '',
      taskRef: 'task_bridge-aggregator',
    });

    assert.equal(item.metadata.x_task_ref, 'task_bridge-aggregator');
  });

  it('throws for unknown recipient member', () => {
    assert.throws(
      () => sendInboxItem({ repoRoot: root, from: 'terence', to: 'nobody', title: 'Test' }),
      /Unknown member: "nobody"/
    );
  });

  it('throws for member without workspace directory', () => {
    assert.throws(
      () => sendInboxItem({ repoRoot: root, from: 'terence', to: 'agent', title: 'Test' }),
      /no workspace directory/
    );
  });

  it('sent items appear in recipient listInboxItems', () => {
    sendInboxItem({ repoRoot: root, from: 'terence', to: 'jared', title: 'Item 1' });
    sendInboxItem({ repoRoot: root, from: 'terence', to: 'jared', title: 'Item 2' });

    const items = listInboxItems({ repoRoot: root, workspace: 'jared' });
    assert.equal(items.length, 2);
    assert.ok(items.every((i) => i.kind === 'member-send'));
  });

  it('recipient can promote a sent inbox item', () => {
    const { item } = sendInboxItem({
      repoRoot: root,
      from: 'terence',
      to: 'jared',
      title: 'Promote me',
      body: 'This should become a note',
    });

    const result = promoteInboxItem({
      repoRoot: root,
      workspace: 'jared',
      itemId: item.id,
      type: 'note',
      title: 'Promoted from inbox send',
      extraFields: { owner: 'jared', status: 'active' },
    });

    assert.ok(result.artifact.id.startsWith('note_'));
    const raw = readFileSync(resolve(root, result.artifact.path), 'utf8');
    assert.ok(raw.includes('x_inbox_item_id'));
  });
});
