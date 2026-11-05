import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { listRunAttempts } from '../work-runs.mjs';

let tmpRoot;

function writeRun(runId, attempt) {
  const dir = resolve(tmpRoot, '.hey/orch/runs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'attempt.json'), `${JSON.stringify(attempt, null, 2)}\n`, 'utf8');
}

describe('listRunAttempts()', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-work-runs-${Date.now()}`);
    writeRun('run_001', { task_id: 'task_a', status: 'completed', title: 'A' });
    writeRun('run_002', { task_id: 'task_b', status: 'in_progress', title: 'B' });
    writeRun('run_003', { task_id: 'task_a', status: 'in_progress', title: 'A again' });
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('filters runs by task id', () => {
    const runs = listRunAttempts(tmpRoot, { taskId: 'task_a', limit: 10 });
    assert.deepEqual(runs.map((run) => run.run_id), ['run_003', 'run_001']);
  });

  it('filters runs by status', () => {
    const runs = listRunAttempts(tmpRoot, { status: 'in_progress', limit: 10 });
    assert.deepEqual(runs.map((run) => run.task_id), ['task_a', 'task_b']);
  });
});
