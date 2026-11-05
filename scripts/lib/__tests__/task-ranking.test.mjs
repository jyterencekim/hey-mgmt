import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIORITY_RANK,
  STATUS_RANK,
  rankFocusTasks,
  scoreTask,
  partitionForFocus,
} from '../task-ranking.mjs';

const TODAY = '2026-04-27';

function task(overrides = {}) {
  return {
    id: overrides.id ?? 'task_x',
    type: 'task',
    title: overrides.title ?? overrides.id ?? 'X',
    status: overrides.status ?? 'ready',
    priority: overrides.priority ?? 'plan',
    owner: overrides.owner ?? 'terence',
    due_date: overrides.due_date ?? null,
    created_at: overrides.created_at ?? '2026-01-01',
    ...overrides,
  };
}

describe('rankFocusTasks', () => {
  it('ranks `do` above `plan` above `routine` above `drop`', () => {
    const tasks = [
      task({ id: 'a', priority: 'drop' }),
      task({ id: 'b', priority: 'do' }),
      task({ id: 'c', priority: 'routine' }),
      task({ id: 'd', priority: 'plan' }),
    ];
    const ids = rankFocusTasks({ tasks, today: TODAY }).map((r) => r.task.id);
    assert.deepEqual(ids, ['b', 'd', 'c', 'a']);
  });

  it('hoists in-flight task to the very top regardless of priority', () => {
    const tasks = [
      task({ id: 'do-task', priority: 'do' }),
      task({ id: 'in-flight', priority: 'routine' }),
    ];
    const ids = rankFocusTasks({ tasks, today: TODAY, inFlightId: 'in-flight' }).map((r) => r.task.id);
    assert.deepEqual(ids[0], 'in-flight');
  });

  it('hoists overdue tasks above non-overdue same-priority tasks', () => {
    const tasks = [
      task({ id: 'on-time', priority: 'plan', due_date: '2026-05-10' }),
      task({ id: 'overdue', priority: 'plan', due_date: '2026-04-10' }),
    ];
    const ids = rankFocusTasks({ tasks, today: TODAY }).map((r) => r.task.id);
    assert.deepEqual(ids, ['overdue', 'on-time']);
  });

  it('overdue `routine` still ranks below in-flight `do` (in-flight is the absolute hoist)', () => {
    const tasks = [
      task({ id: 'overdue-routine', priority: 'routine', due_date: '2026-04-10' }),
      task({ id: 'in-flight-do', priority: 'do', due_date: null }),
    ];
    const ids = rankFocusTasks({
      tasks,
      today: TODAY,
      inFlightId: 'in-flight-do',
    }).map((r) => r.task.id);
    assert.deepEqual(ids[0], 'in-flight-do');
  });

  it('overdue `routine` outranks on-time `do` (overdue is a forcing signal)', () => {
    const tasks = [
      task({ id: 'on-time-do', priority: 'do', due_date: '2026-05-15' }),
      task({ id: 'overdue-routine', priority: 'routine', due_date: '2026-04-10' }),
    ];
    const ids = rankFocusTasks({ tasks, today: TODAY }).map((r) => r.task.id);
    assert.deepEqual(ids, ['overdue-routine', 'on-time-do']);
  });

  it('within same priority: doing > ready > blocked', () => {
    const tasks = [
      task({ id: 'b', status: 'blocked', priority: 'do' }),
      task({ id: 'a', status: 'ready', priority: 'do' }),
      task({ id: 'p', status: 'doing', priority: 'do' }),
    ];
    const ids = rankFocusTasks({ tasks, today: TODAY }).map((r) => r.task.id);
    assert.deepEqual(ids, ['p', 'a', 'b']);
  });

  it('uses due_date as a tiebreaker within same priority+status', () => {
    const tasks = [
      task({ id: 'later', priority: 'do', due_date: '2026-05-20' }),
      task({ id: 'sooner', priority: 'do', due_date: '2026-05-01' }),
      task({ id: 'no-due', priority: 'do', due_date: null }),
    ];
    const ids = rankFocusTasks({ tasks, today: TODAY }).map((r) => r.task.id);
    assert.deepEqual(ids, ['sooner', 'later', 'no-due']);
  });

  it('uses created_at as a final tiebreaker (oldest first)', () => {
    const tasks = [
      task({ id: 'newer', priority: 'plan', created_at: '2026-04-01' }),
      task({ id: 'older', priority: 'plan', created_at: '2026-01-15' }),
    ];
    const ids = rankFocusTasks({ tasks, today: TODAY }).map((r) => r.task.id);
    assert.deepEqual(ids, ['older', 'newer']);
  });

  it('promotes carry-over items over equivalents', () => {
    const tasks = [
      task({ id: 'fresh', priority: 'plan' }),
      task({ id: 'carried', priority: 'plan' }),
    ];
    const ids = rankFocusTasks({
      tasks,
      today: TODAY,
      carryOver: ['carried'],
    }).map((r) => r.task.id);
    assert.deepEqual(ids[0], 'carried');
  });

  it('filters by member when provided', () => {
    const tasks = [
      task({ id: 'mine', owner: 'terence' }),
      task({ id: 'theirs', owner: 'oliver' }),
    ];
    const ids = rankFocusTasks({ tasks, today: TODAY, member: 'terence' }).map((r) => r.task.id);
    assert.deepEqual(ids, ['mine']);
  });

  it('drops non-focusable statuses (done, archived, plan, cancelled)', () => {
    const tasks = [
      task({ id: 'a', status: 'ready' }),
      task({ id: 'd', status: 'done' }),
      task({ id: 'p', status: 'plan' }),
      task({ id: 'archived', status: 'archived' }),
    ];
    const ids = rankFocusTasks({ tasks, today: TODAY }).map((r) => r.task.id);
    assert.deepEqual(ids, ['a']);
  });

  it('respects --limit', () => {
    const tasks = Array.from({ length: 8 }, (_, i) =>
      task({ id: `t${i}`, priority: 'plan', created_at: `2026-01-0${(i + 1)}` })
    );
    const ranked = rankFocusTasks({ tasks, today: TODAY, limit: 3 });
    assert.equal(ranked.length, 3);
  });

  it('attaches readable reasons for each ranked task', () => {
    const tasks = [
      task({
        id: 'urgent',
        priority: 'do',
        status: 'doing',
        due_date: '2026-04-10',
      }),
    ];
    const [entry] = rankFocusTasks({ tasks, today: TODAY });
    assert.ok(entry.reasons.includes('doing'));
    assert.ok(entry.reasons.includes('priority=do'));
    assert.ok(entry.reasons.some((r) => r.startsWith('overdue')));
  });

  it('skips non-task records', () => {
    const tasks = [
      task({ id: 't' }),
      { id: 'note_x', type: 'note', status: 'active', owner: 'terence' },
    ];
    const ids = rankFocusTasks({ tasks, today: TODAY }).map((r) => r.task.id);
    assert.deepEqual(ids, ['t']);
  });
});

describe('scoreTask', () => {
  it('exposes priority and status maps as the published rank source', () => {
    assert.equal(PRIORITY_RANK.do, 0);
    assert.equal(PRIORITY_RANK.drop, 3);
    assert.equal(STATUS_RANK.doing, 0);
    assert.equal(STATUS_RANK.blocked, 2);
  });

  it('returns deterministic vectors for identical inputs', () => {
    const t = task({ id: 'a', priority: 'do', status: 'ready', due_date: '2026-05-01' });
    const s1 = scoreTask(t, { today: TODAY });
    const s2 = scoreTask(t, { today: TODAY });
    assert.deepEqual(s1, s2);
  });
});

describe('partitionForFocus', () => {
  it('splits focusable from blocked, capping focus at focusLimit', () => {
    const tasks = [
      task({ id: 'a1', status: 'ready', priority: 'do' }),
      task({ id: 'a2', status: 'ready', priority: 'plan' }),
      task({ id: 'a3', status: 'ready', priority: 'plan' }),
      task({ id: 'a4', status: 'ready', priority: 'plan' }),
      task({ id: 'b1', status: 'blocked', priority: 'do' }),
    ];
    const { focus, blocked } = partitionForFocus({
      tasks,
      today: TODAY,
      focusLimit: 3,
    });
    assert.equal(focus.length, 3);
    assert.deepEqual(focus.map((e) => e.task.id), ['a1', 'a2', 'a3']);
    assert.deepEqual(blocked.map((e) => e.task.id), ['b1']);
  });
});
