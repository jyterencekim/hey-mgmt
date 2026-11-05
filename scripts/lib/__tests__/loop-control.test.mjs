import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildLoopBoard, buildLoopHorizon, summarizeUndated } from '../loop-control.mjs';

let tmpRoot;

function manifestLine(overrides) {
  const base = {
    id: 'task_x',
    type: 'task',
    title: 'Task X',
    path: 'content/tasks/task_x.md',
    created_at: '2026-05-01',
    updated_at: '2026-05-01',
    area: 'Team',
    status: 'ready',
    priority: 'plan',
    phase: null,
    owner: 'charlie',
    due_date: null,
    iteration: '2026-W19',
    tags: [],
    entities: [],
    relations_out: [],
    links_out: [],
    sources: [],
    hashes: { content_hash: 'hash' },
    feedback: { adopt: 0, reject: 0, warn: 0, score: 0.5 },
    unresolved_entities: [],
  };
  return JSON.stringify({ ...base, ...overrides });
}

describe('buildLoopBoard()', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-loop-${Date.now()}`);
    mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });
    mkdirSync(resolve(tmpRoot, '.hey/orch/runs/run_001'), { recursive: true });
    const manifest = [
      manifestLine({ id: 'task_ready', title: 'Ready task', status: 'ready' }),
      manifestLine({ id: 'task_blocked', title: 'Blocked task', status: 'blocked' }),
      manifestLine({ id: 'task_review', title: 'Reviewable task', status: 'doing', phase: 'awaiting_review' }),
      manifestLine({ id: 'task_done', title: 'Done task', status: 'done', updated_at: '2026-05-07' }),
    ];
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), `${manifest.join('\n')}\n`, 'utf8');
    writeFileSync(
      resolve(tmpRoot, '.hey/orch/runs/run_001/attempt.json'),
      `${JSON.stringify({ task_id: 'task_ready', status: 'in_progress', title: 'Ready task' }, null, 2)}\n`,
      'utf8'
    );
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('groups tasks into attention lanes', () => {
    const board = buildLoopBoard(tmpRoot, { member: 'charlie', today: '2026-05-07' });
    assert.equal(board.lanes['Needs unblock'][0].id, 'task_blocked');
    assert.equal(board.lanes['Needs review'][0].id, 'task_review');
    assert.equal(board.lanes['In flight'][0].id, 'task_ready');
    assert.equal(board.lanes['Done since last brief'][0].id, 'task_done');
  });
});

describe('buildLoopHorizon() iteration view', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-horizon-${Date.now()}`);
    mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });
    mkdirSync(resolve(tmpRoot, 'content'), { recursive: true });
    const manifest = [
      // 2026-08-14 sits in 2026-W33.
      manifestLine({ id: 'task_now', title: 'Committed now', iteration: '2026-W33', planned_date: '2026-08-12' }),
      manifestLine({ id: 'task_next', title: 'Committed next', iteration: '2026-W34' }),
      manifestLine({ id: 'task_backlog', title: 'Backlog task', iteration: null, due_date: null }),
      manifestLine({ id: 'task_dated', title: 'Dated wish', iteration: null, due_date: '2026-09-01' }),
    ];
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), `${manifest.join('\n')}\n`, 'utf8');
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('buckets committed tasks by iteration and undated uncommitted tasks as backlog', () => {
    // P1 precondition: once wish-dates are stripped, most open tasks have no
    // due_date — without iteration buckets the forward view would go blank.
    const horizon = buildLoopHorizon(tmpRoot, { member: 'charlie', today: '2026-08-14' });
    const view = horizon.iteration_view;
    assert.equal(view.current, '2026-W33');
    assert.equal(view.next, '2026-W34');
    assert.deepEqual(view.buckets.this_iteration.map((item) => item.id), ['task_now']);
    // A committed task surfaces its weekday schedule.
    assert.equal(view.buckets.this_iteration[0].planned_date, '2026-08-12');
    assert.deepEqual(view.buckets.next_iteration.map((item) => item.id), ['task_next']);
    // A dated-but-uncommitted task belongs to the date windows, not backlog.
    assert.deepEqual(view.buckets.backlog.map((item) => item.id), ['task_backlog']);
  });
});

describe('buildLoopHorizon() planned-today bucket', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-horizon-planned-${Date.now()}`);
    mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });
    mkdirSync(resolve(tmpRoot, 'content'), { recursive: true });
    const manifest = [
      // 2026-08-19 (Wednesday) sits in 2026-W34 (Mon 08-17 .. Sun 08-23).
      manifestLine({ id: 'task_planned', title: 'Planned today', iteration: '2026-W34', planned_date: '2026-08-19' }),
      manifestLine({ id: 'task_missed', title: 'Missed plan', iteration: '2026-W34', planned_date: '2026-08-18' }),
      manifestLine({ id: 'task_both', title: 'Planned and due', iteration: '2026-W34', planned_date: '2026-08-19', due_date: '2026-08-21' }),
      manifestLine({ id: 'task_overdue_planned', title: 'Overdue but planned', iteration: '2026-W34', planned_date: '2026-08-19', due_date: '2026-08-11' }),
      manifestLine({ id: 'task_due_today', title: 'Due today only', iteration: '2026-W34', due_date: '2026-08-19' }),
    ];
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), `${manifest.join('\n')}\n`, 'utf8');
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it("leads with today's planned set, so the schedule layer is visible at all", () => {
    // Without this the `x_planned_date` written by `hey task plan` lands in
    // 'No due date' and the whole schedule layer is invisible in the forward
    // view — which is why the field went unused after wish-dates were stripped.
    const horizon = buildLoopHorizon(tmpRoot, { member: 'charlie', today: '2026-08-19' });
    // 'Planned today' leads HORIZON_BUCKETS, so it renders first.
    assert.equal(Object.keys(horizon.buckets)[0], 'Planned today');
    assert.deepEqual(
      horizon.buckets['Planned today'].map((item) => item.id).sort(),
      ['task_both', 'task_overdue_planned', 'task_planned'],
    );
  });

  it('gives a missed plan no alarm — it falls back to normal bucketing, never an overdue signal', () => {
    // decision_adr-three-layer-task-timeline: a missed x_planned_date returns
    // to the iteration's unplanned pool. If yesterday's plan produced an
    // overdue-like bucket we would have rebuilt the exact pressure the ADR
    // removed from due_date.
    const horizon = buildLoopHorizon(tmpRoot, { member: 'charlie', today: '2026-08-19' });
    const bucketOf = (id) =>
      Object.entries(horizon.buckets).find(([, items]) => items.some((i) => i.id === id))?.[0];
    assert.equal(bucketOf('task_missed'), 'No due date');
    assert.ok(!horizon.buckets['Planned today'].some((i) => i.id === 'task_missed'));
  });

  it("shows a task planned today even when its hard deadline already passed", () => {
    // The board surfaces overdue separately; suppressing it here would hide the
    // one thing the member said they would do about it today.
    const horizon = buildLoopHorizon(tmpRoot, { member: 'charlie', today: '2026-08-19' });
    assert.ok(horizon.buckets['Planned today'].some((item) => item.id === 'task_overdue_planned'));
  });

  it('leaves a due-today task with no plan in the due-date bucket', () => {
    const horizon = buildLoopHorizon(tmpRoot, { member: 'charlie', today: '2026-08-19' });
    const bucketOf = (id) =>
      Object.entries(horizon.buckets).find(([, items]) => items.some((i) => i.id === id))?.[0];
    assert.equal(bucketOf('task_due_today'), 'Today');
  });
});

describe('summarizeUndated()', () => {
  it('counts open tasks that carry no due date', () => {
    // An undated task can never go overdue, so it never reaches an attention
    // lane. Without this count a growing undated pile reads as a healthy backlog.
    const summary = summarizeUndated([
      { status: 'ready', owner: 'charlie', due_date: null },
      { status: 'doing', owner: 'charlie', due_date: '2026-08-14' },
      { status: 'ready', owner: 'alice', due_date: null },
      { status: 'blocked', owner: 'alice', due_date: '' },
    ]);
    assert.equal(summary.open_total, 4);
    assert.equal(summary.undated_total, 3);
    assert.equal(summary.by_owner[0].owner, 'alice');
    assert.equal(summary.by_owner[0].undated, 2);
    assert.equal(summary.by_owner[0].ratio, 1);
  });

  it('excludes terminal tasks so closing work cannot inflate the ratio', () => {
    const summary = summarizeUndated([
      { status: 'done', owner: 'charlie', due_date: null },
      { status: 'archived', owner: 'charlie', due_date: null },
      { status: 'cancelled', owner: 'charlie', due_date: null },
      { status: 'ready', owner: 'charlie', due_date: '2026-08-14' },
    ]);
    assert.equal(summary.open_total, 1);
    assert.equal(summary.undated_total, 0);
    assert.equal(summary.ratio, 0);
  });
});
