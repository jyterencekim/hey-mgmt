import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildHygieneReport } from '../hygiene.mjs';

let tmpRoot;

function manifestLine(overrides) {
  const base = {
    id: 'task_x',
    type: 'task',
    title: 'Task X',
    path: 'content/tasks/task_x.md',
    created_at: '2026-05-01',
    updated_at: '2026-08-10',
    status: 'ready',
    priority: 'plan',
    owner: 'terence',
    due_date: null,
    iteration: null,
    planned_date: null,
    slip_count: null,
    evergreen: false,
    tags: [],
    entities: [],
    relations_out: [],
    links_out: [],
    sources: [],
    hashes: { content_hash: 'hash' },
  };
  return JSON.stringify({ ...base, ...overrides });
}

const TODAY = '2026-08-14';

function writeManifest(lines) {
  writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), `${lines.join('\n')}\n`, 'utf8');
}

async function report(options = {}) {
  return buildHygieneReport(tmpRoot, { today: TODAY, pr: false, ...options });
}

describe('buildHygieneReport()', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-hygiene-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });
    mkdirSync(resolve(tmpRoot, 'content/tasks'), { recursive: true });
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('proposes demoting doing tasks idle past the 14d window, exempting evergreen', async () => {
    // A task idle in `doing` for two weeks is not being done; leaving it there
    // hides real WIP. Evergreen tasks are expected not to move, so the idle
    // rules must not nag them.
    writeManifest([
      manifestLine({ id: 'task_stalled', status: 'doing', iteration: '2026-W33', updated_at: '2026-07-01' }),
      manifestLine({ id: 'task_active', status: 'doing', iteration: '2026-W33', updated_at: '2026-08-13' }),
      manifestLine({ id: 'task_evergreen', status: 'doing', iteration: '2026-W33', updated_at: '2026-07-01', evergreen: true }),
    ]);
    const result = await report();
    assert.deepEqual(result.sections.doing_stale.map((entry) => entry.id), ['task_stalled']);
  });

  it('proposes archiving ready/plan tasks untouched past the GP3 90d threshold, exempting evergreen', async () => {
    writeManifest([
      manifestLine({ id: 'task_rotting', status: 'plan', updated_at: '2026-04-01' }),
      manifestLine({ id: 'task_recent', status: 'plan', updated_at: '2026-08-01' }),
      manifestLine({ id: 'task_evergreen', status: 'ready', iteration: '2026-W33', updated_at: '2026-04-01', evergreen: true }),
    ]);
    const result = await report();
    assert.deepEqual(result.sections.stale_open.map((entry) => entry.id), ['task_rotting']);
  });

  it('surfaces blocked tasks whose every blocker is terminal or missing', async () => {
    // "Blocked" on a resolved blocker is invisible dead weight: nothing will
    // ever unblock it because nothing is actually blocking it.
    writeManifest([
      manifestLine({ id: 'task_blocker_done', status: 'done' }),
      manifestLine({ id: 'task_blocker_live', status: 'doing', iteration: '2026-W33' }),
      manifestLine({
        id: 'task_free',
        status: 'blocked',
        iteration: '2026-W33',
        relations_out: [
          { type: 'blocked_by', target: 'task_blocker_done' },
          { type: 'blocked_by', target: 'task_gone' },
        ],
      }),
      manifestLine({
        id: 'task_still_blocked',
        status: 'blocked',
        iteration: '2026-W33',
        relations_out: [{ type: 'blocked_by', target: 'task_blocker_live' }],
      }),
    ]);
    const result = await report();
    assert.deepEqual(result.sections.blocked_resolved.map((entry) => entry.id), ['task_free']);
    assert.deepEqual(result.sections.blocked_resolved[0].blockers, [
      { target: 'task_blocker_done', state: 'done' },
      { target: 'task_gone', state: 'missing' },
    ]);
  });

  it('proposes stripping wish-dates from non-committed tasks', async () => {
    // D1: due_date means hard external deadline. On a task with no iteration it
    // is a wish, and wishes going "overdue" is the alarm-fatigue pathology.
    writeManifest([
      manifestLine({ id: 'task_wish', status: 'plan', due_date: '2026-09-01' }),
      manifestLine({ id: 'task_committed', status: 'ready', iteration: '2026-W33', due_date: '2026-09-01' }),
    ]);
    const result = await report();
    assert.deepEqual(result.sections.wish_dates.map((entry) => entry.id), ['task_wish']);
  });

  it('proposes stripping planned dates missing an iteration or outside its week', async () => {
    // x_planned_date is a schedule inside the committed week (2026-W33 =
    // 08-10..08-16); anywhere else it schedules nothing and only misleads.
    writeManifest([
      manifestLine({ id: 'task_no_iter', status: 'plan', planned_date: '2026-08-12' }),
      manifestLine({ id: 'task_outside', status: 'ready', iteration: '2026-W33', planned_date: '2026-08-20' }),
      manifestLine({ id: 'task_inside', status: 'ready', iteration: '2026-W33', planned_date: '2026-08-12' }),
    ]);
    const result = await report();
    assert.deepEqual(result.sections.planned_dates.map((entry) => entry.id), ['task_no_iter', 'task_outside']);
  });

  it('turns an injected pr-check report into close proposals', async () => {
    writeManifest([manifestLine({ id: 'task_landed', status: 'doing', iteration: '2026-W33', updated_at: '2026-08-13' })]);
    const prReport = {
      checked_tasks: 1,
      tasks_with_refs: 1,
      unique_prs: 1,
      unresolved: 0,
      contradictions: [],
      all_merged: [{
        id: 'task_landed',
        title: 'Task X',
        status: 'doing',
        owner: 'terence',
        path: 'content/tasks/task_landed.md',
        prs: [{ key: 'org/repo#1', state: 'MERGED', merged_at: '2026-08-01', claims_pending: false }],
      }],
    };
    const result = await report({ pr: true, prReport });
    assert.equal(result.sections.prs_merged.length, 1);
    assert.equal(result.sections.prs_merged[0].id, 'task_landed');
    assert.match(result.sections.prs_merged[0].proposed_action, /close/);
  });

  it('never mutates: task files and the manifest are byte-identical after a run', async () => {
    // Hygiene is a detector feeding a human-approved batch; a detector that
    // writes would silently bypass the approval gate (P2).
    const taskPath = resolve(tmpRoot, 'content/tasks/task_stalled.md');
    writeFileSync(taskPath, '---\nid: task_stalled\n---\nbody\n', 'utf8');
    writeManifest([
      manifestLine({ id: 'task_stalled', status: 'doing', iteration: '2026-W33', updated_at: '2026-07-01', path: 'content/tasks/task_stalled.md' }),
    ]);
    const manifestPath = resolve(tmpRoot, 'index/manifest.jsonl');
    const manifestBefore = readFileSync(manifestPath, 'utf8');
    const taskBefore = readFileSync(taskPath, 'utf8');

    const result = await report();
    assert.equal(result.sections.doing_stale.length, 1);

    assert.equal(readFileSync(manifestPath, 'utf8'), manifestBefore);
    assert.equal(readFileSync(taskPath, 'utf8'), taskBefore);
  });
});
