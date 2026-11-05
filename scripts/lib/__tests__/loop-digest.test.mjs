import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { formatLoopDigest, recordLoopDigest } from '../loop-digest.mjs';

function digestFixture(overrides = {}) {
  return {
    generated_at: '2026-08-14T00:00:00.000Z',
    today: '2026-08-14',
    member: 'terence',
    inputs: { git_head: 'abc1234', manifest_built_at: '2026-08-14T00:00:00.000Z' },
    planned_today: [
      { id: 'task_planned', title: 'Planned work', status: 'ready', priority: 'do', due_date: null, planned_date: '2026-08-14' },
    ],
    missed_plans: [
      { id: 'task_missed', title: 'Missed work', status: 'ready', priority: null, due_date: null, planned_date: '2026-08-12' },
    ],
    overdue: [
      { id: 'task_late', title: 'Late deadline', status: 'doing', priority: 'do', due_date: '2026-08-10', planned_date: null },
    ],
    recommendations: [],
    board_counts: {},
    iteration_view: null,
    inbox: { open: [], new_count: 0, last_digest_at: null },
    due_packets: [],
    active_runs: [],
    ...overrides,
  };
}

describe('formatLoopDigest()', () => {
  it('leads with the planned set and stamps generated-at + inputs', () => {
    // D1: the digest is a schedule surface first. The header stamp exists so a
    // stale digest can never masquerade as a fresh one.
    const markdown = formatLoopDigest(digestFixture());
    assert.match(markdown, /Generated at 2026-08-14 ..:.. KST — inputs as of git abc1234/);
    const planned = markdown.indexOf('## Planned today');
    const overdue = markdown.indexOf('## Hard-deadline overdue');
    assert.ok(planned !== -1 && overdue !== -1 && planned < overdue);
    assert.match(markdown, /Planned work \(`task_planned`, ready, do\)/);
  });

  it('never uses overdue language for missed planned dates', () => {
    // A missed x_planned_date has no alarm semantics — it returns to the pool.
    // Only due_date alarms; blending the two recreates the wish-date pathology.
    const markdown = formatLoopDigest(digestFixture());
    const missedSection = markdown.slice(
      markdown.indexOf('## Missed plans'),
      markdown.indexOf('## Hard-deadline overdue')
    );
    assert.match(missedSection, /was planned 2026-08-12/);
    assert.doesNotMatch(missedSection, /overdue/i);
  });

  it('renders task titles first, ids second (task-display ADR)', () => {
    const markdown = formatLoopDigest(digestFixture());
    assert.match(markdown, /- Late deadline \(`task_late`, doing, do, due 2026-08-10\)/);
  });
});

describe('recordLoopDigest()', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-digest-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(resolve(tmpRoot, 'workspace/terence/notes'), { recursive: true });
    mkdirSync(resolve(tmpRoot, 'content'), { recursive: true });
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('records inbox state and marks due packets surfaced exactly once', () => {
    // The packet marker is the "consumed" half of the P4 loop restore —
    // without it packets re-list forever. The forward digest is output-only.
    const packetPath = 'workspace/terence/notes/note_packet.md';
    writeFileSync(
      resolve(tmpRoot, packetPath),
      '---\nid: note_packet\ntype: note\ntitle: Reminder\nstatus: active\nx_kind: scheduled_action\nx_trigger_at: 2026-08-01\n---\n# Reminder\n\nBody.\n',
      'utf8'
    );
    const digest = digestFixture({
      due_packets: [{ id: 'note_packet', title: 'Reminder', trigger_date: '2026-08-01', path: packetPath }],
    });
    const first = recordLoopDigest(tmpRoot, digest);
    assert.deepEqual(first.packets_marked, ['note_packet']);
    assert.match(readFileSync(first.state_path, 'utf8'), /"last_run_at": "2026-08-14T00:00:00.000Z"/);

    const marked = readFileSync(resolve(tmpRoot, packetPath), 'utf8');
    assert.match(marked, /x_surfaced_at: .*2026-08-14/);
    assert.match(marked, /> Surfaced 2026-08-14 in terence's digest/);

    // Idempotent: a second run must not double-mark the packet.
    const second = recordLoopDigest(tmpRoot, digest);
    assert.deepEqual(second.packets_marked, []);
    assert.equal(readFileSync(resolve(tmpRoot, packetPath), 'utf8'), marked);
  });
});
