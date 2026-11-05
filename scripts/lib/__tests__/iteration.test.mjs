import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareIterations, iterationWeekRange, nextIteration } from '../iteration.mjs';

describe('iterationWeekRange()', () => {
  it('returns the Monday..Sunday span of the ISO week', () => {
    // 2026-08-14 (a Friday) sits in 2026-W33; hygiene rule (e) depends on this
    // range to judge whether an x_planned_date belongs to its iteration.
    assert.deepEqual(iterationWeekRange('2026-W33'), { start: '2026-08-10', end: '2026-08-16' });
  });

  it('returns null for non-iteration values instead of guessing', () => {
    assert.equal(iterationWeekRange('2026-08-10'), null);
    assert.equal(iterationWeekRange(null), null);
  });
});

describe('nextIteration()', () => {
  it('advances one week', () => {
    assert.equal(nextIteration('2026-W33'), '2026-W34');
  });

  it('crosses the year boundary via real date arithmetic', () => {
    // 2026 has 53 ISO weeks; naive week+1 would produce the invalid 2026-W54
    // and silently break carry-forward at every year turn.
    assert.equal(nextIteration('2026-W53'), '2027-W01');
  });
});

describe('compareIterations()', () => {
  it('orders across year boundaries', () => {
    assert.ok(compareIterations('2026-W53', '2027-W01') < 0);
    assert.ok(compareIterations('2026-W34', '2026-W33') > 0);
  });
});
