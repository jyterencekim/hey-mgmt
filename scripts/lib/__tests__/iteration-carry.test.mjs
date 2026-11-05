import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { applyCarryPlan, buildCarryPlan, formatCarryPlan } from '../iteration-carry.mjs';
import { parseArtifact } from '../content-io.mjs';

let tmpRoot;

function taskFile(id, { status = 'ready', iteration = '2026-W33', slip = null, extra = '' } = {}) {
  const slipLine = slip === null ? '' : `x_slip_count: ${slip}\n`;
  return [
    '---',
    `id: ${id}`,
    'type: task',
    `title: Title of ${id}`,
    'created_at: 2026-08-01',
    'updated_at: 2026-08-01',
    `status: ${status}`,
    'owner: terence',
    'priority: plan',
    `iteration: ${iteration}`,
    `${slipLine}${extra}definition_of_done:`,
    '  - done',
    '---',
    '',
    `Body of ${id}.`,
    '',
  ].join('\n');
}

function manifestLine(id, overrides = {}) {
  return JSON.stringify({
    id,
    type: 'task',
    title: `Title of ${id}`,
    path: `content/tasks/${id}.md`,
    created_at: '2026-08-01',
    updated_at: '2026-08-01',
    status: 'ready',
    priority: 'plan',
    owner: 'terence',
    due_date: null,
    iteration: '2026-W33',
    relations_out: [],
    links_out: [],
    sources: [],
    tags: [],
    entities: [],
    hashes: { content_hash: 'hash' },
    ...overrides,
  });
}

function writeTask(id, options = {}, manifestOverrides = {}) {
  writeFileSync(resolve(tmpRoot, 'content/tasks', `${id}.md`), taskFile(id, options), 'utf8');
  return manifestLine(id, {
    status: options.status ?? 'ready',
    iteration: options.iteration ?? '2026-W33',
    ...manifestOverrides,
  });
}

describe('buildCarryPlan() / applyCarryPlan()', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-carry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(resolve(tmpRoot, 'content/tasks'), { recursive: true });
    mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  function writeManifest(lines) {
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), `${lines.join('\n')}\n`, 'utf8');
  }

  it('rewrites iteration, increments slip counts, preserves the rest', () => {
    // Carry-forward exists to close the metadata-sync gap: without the
    // iteration rewrite, committed-vs-stale is unqueryable (P1 precondition).
    writeManifest([
      writeTask('task_fresh'), // no x_slip_count yet → created at 1
      writeTask('task_slipped', { slip: 1 }),
    ]);

    const plan = buildCarryPlan(tmpRoot, { to: '2026-W34', today: '2026-08-17' });
    assert.equal(plan.from, '2026-W33');
    assert.deepEqual(plan.carried.map((entry) => [entry.id, entry.slip_count]), [
      ['task_fresh', 1],
      ['task_slipped', 2],
    ]);

    applyCarryPlan(tmpRoot, plan);

    const fresh = parseArtifact(resolve(tmpRoot, 'content/tasks/task_fresh.md'), resolve(tmpRoot, 'content'));
    assert.equal(fresh.frontmatter.iteration, '2026-W34');
    assert.equal(fresh.frontmatter.x_slip_count, 1);
    assert.equal(fresh.frontmatter.updated_at, '2026-08-17');
    // Everything not owned by carry must survive the rewrite untouched.
    assert.equal(fresh.frontmatter.priority, 'plan');
    assert.equal(fresh.frontmatter.owner, 'terence');
    assert.deepEqual(fresh.frontmatter.definition_of_done, ['done']);
    assert.equal(fresh.body, 'Body of task_fresh.');

    const slipped = parseArtifact(resolve(tmpRoot, 'content/tasks/task_slipped.md'), resolve(tmpRoot, 'content'));
    assert.equal(slipped.frontmatter.x_slip_count, 2);
  });

  it('plans without writing, so --dry-run cannot mutate the ledger', () => {
    const before = taskFile('task_fresh');
    writeManifest([writeTask('task_fresh')]);

    buildCarryPlan(tmpRoot, { to: '2026-W34' });

    const after = readFileSync(resolve(tmpRoot, 'content/tasks/task_fresh.md'), 'utf8');
    assert.equal(after, before);
  });

  it('flags slip count >= 3 as a forced decision but still carries it', () => {
    // D3: the carry is automatic; the threshold ends *silent* re-deferral by
    // forcing re-scope / re-commit / archive, not by dropping the task.
    writeManifest([writeTask('task_chronic', { slip: 2 })]);

    const plan = buildCarryPlan(tmpRoot, { to: '2026-W34' });
    assert.equal(plan.carried.length, 1);
    assert.equal(plan.forced_decisions.length, 1);
    assert.equal(plan.forced_decisions[0].id, 'task_chronic');
    assert.equal(plan.forced_decisions[0].slip_count, 3);
    assert.match(formatCarryPlan(plan, { dryRun: true }), /FORCED DECISIONS/);
  });

  it('infers --from as the most recent past iteration and reports older ones', () => {
    writeManifest([
      writeTask('task_recent', { iteration: '2026-W33' }),
      writeTask('task_old', { iteration: '2026-W31' }),
      writeTask('task_committed', { iteration: '2026-W34' }),
    ]);

    const plan = buildCarryPlan(tmpRoot, { to: '2026-W34' });
    assert.equal(plan.from, '2026-W33');
    assert.deepEqual(plan.carried.map((entry) => entry.id), ['task_recent']);
    // Older iterations must not be carried silently, but must not vanish either.
    assert.deepEqual(plan.older_open_iterations, [{ iteration: '2026-W31', open_tasks: 1 }]);
  });

  it('skips terminal tasks and requires --from when nothing is inferable', () => {
    writeManifest([writeTask('task_done', { status: 'done' })]);
    assert.throws(() => buildCarryPlan(tmpRoot, { to: '2026-W34' }), /pass --from/);
  });
});
