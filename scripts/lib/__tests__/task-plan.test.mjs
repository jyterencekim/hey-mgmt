import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlannedDate } from '../task-plan.mjs';

describe('validatePlannedDate()', () => {
  it('accepts a weekday inside the committed iteration', () => {
    // 2026-W34 runs Mon 2026-08-17 .. Sun 2026-08-23.
    const result = validatePlannedDate({
      date: '2026-08-19',
      iteration: '2026-W34',
      status: 'ready',
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.range, { start: '2026-08-17', end: '2026-08-23' });
  });

  it('accepts both boundary days, so a Monday or Sunday plan is not lost to an off-by-one', () => {
    for (const date of ['2026-08-17', '2026-08-23']) {
      assert.equal(validatePlannedDate({ date, iteration: '2026-W34', status: 'ready' }).ok, true, date);
    }
  });

  it('rejects a date outside the iteration, because hygiene rule (e) would strip it on sight', () => {
    // The failure this guards against: planning next Monday's work while the
    // task is still committed to this week produces a row that reads as
    // scheduled but is unreachable from the iteration it belongs to.
    const result = validatePlannedDate({
      date: '2026-08-24',
      iteration: '2026-W34',
      status: 'ready',
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /outside 2026-W34 \(2026-08-17\.\.2026-08-23\)/);
  });

  it('refuses to schedule a task that has made no iteration commitment', () => {
    // Layer discipline: x_planned_date is a weekday INSIDE a commitment. With
    // no iteration there is nothing to schedule inside, and silently defaulting
    // to the current week would fabricate a commitment the member never made.
    const result = validatePlannedDate({ date: '2026-08-19', iteration: null, status: 'ready' });
    assert.equal(result.ok, false);
    assert.match(result.error, /no iteration/);
  });

  it('rejects terminal tasks, so finished work cannot reappear on a day plan', () => {
    for (const status of ['done', 'archived', 'cancelled']) {
      const result = validatePlannedDate({ date: '2026-08-19', iteration: '2026-W34', status });
      assert.equal(result.ok, false, status);
      assert.match(result.error, /cannot be planned/);
    }
  });

  it('allows blocked tasks to hold a day — a blocked task still needs a slot to be unblocked in', () => {
    assert.equal(
      validatePlannedDate({ date: '2026-08-19', iteration: '2026-W34', status: 'blocked' }).ok,
      true,
    );
  });

  it('rejects malformed dates rather than coercing them', () => {
    for (const date of ['2026-8-19', '08-19-2026', 'tomorrow', '', null, undefined]) {
      assert.equal(validatePlannedDate({ date, iteration: '2026-W34', status: 'ready' }).ok, false, String(date));
    }
  });

  it('rejects a non-iteration string instead of treating it as an open range', () => {
    const result = validatePlannedDate({
      date: '2026-08-19',
      iteration: '2026-08-17',
      status: 'ready',
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /not a YYYY-WNN value/);
  });

  it('validates the date shape before the iteration, so the message names the real problem', () => {
    // Both are wrong here; a member who typed the date wrong should be told
    // that, not sent to fix an iteration that is also missing.
    const result = validatePlannedDate({ date: 'tomorrow', iteration: null, status: 'ready' });
    assert.match(result.error, /must be YYYY-MM-DD/);
  });
});
