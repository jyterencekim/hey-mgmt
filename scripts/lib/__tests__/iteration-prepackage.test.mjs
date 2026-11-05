import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  WEEKLY_COMMITMENT_CAP,
  buildIterationPrepackage,
  formatIterationPrepackage,
} from '../iteration-prepackage.mjs';

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
    owner: 'charlie',
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

function writeTask(id, frontmatter = '') {
  writeFileSync(
    resolve(tmpRoot, `content/tasks/${id}.md`),
    `---\nid: ${id}\ntype: task\ntitle: ${id}\n${frontmatter}---\nbody\n`,
    'utf8'
  );
}

describe('buildIterationPrepackage()', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-prepackage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });
    mkdirSync(resolve(tmpRoot, 'content/tasks'), { recursive: true });
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('assembles carry candidates, closed list, and per-member capacity vs the cap', async () => {
    // The prepackage exists so the ceremony opens with every mechanical fact
    // computed: who slips, who closed what, and who is already over the cap.
    writeTask('task_carry', 'x_slip_count: 2\n');
    writeTask('task_next');
    for (const id of ['task_done', 'task_archived']) writeTask(id);

    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), [
      manifestLine({ id: 'task_carry', path: 'content/tasks/task_carry.md', status: 'ready', iteration: '2026-W33' }),
      manifestLine({ id: 'task_next', path: 'content/tasks/task_next.md', status: 'ready', iteration: '2026-W34' }),
      manifestLine({ id: 'task_done', path: 'content/tasks/task_done.md', status: 'done', iteration: '2026-W33', owner: 'alice' }),
      manifestLine({ id: 'task_archived', path: 'content/tasks/task_archived.md', status: 'archived', iteration: '2026-W33' }),
    ].join('\n') + '\n', 'utf8');

    const pkg = await buildIterationPrepackage(tmpRoot, {
      closing: '2026-W33',
      today: '2026-08-14',
      pr: false,
    });

    assert.equal(pkg.next, '2026-W34');
    assert.deepEqual(pkg.carry.carried.map((entry) => entry.id), ['task_carry']);
    // Slip 2 → 3 crosses the D3 threshold: the carry still happens, but the
    // task must force a decision at the ceremony.
    assert.equal(pkg.carry.carried[0].slip_count, 3);
    assert.equal(pkg.carry.carried[0].forced_decision, true);

    assert.deepEqual(pkg.closed.map((task) => task.id), ['task_done', 'task_archived']);

    const charlie = pkg.capacity.find((row) => row.owner === 'charlie');
    assert.deepEqual(
      { committed: charlie.committed_next, incoming: charlie.carry_incoming, projected: charlie.projected },
      { committed: 1, incoming: 1, projected: 2 }
    );
    assert.equal(charlie.over_cap, false);
    assert.equal(charlie.cap, WEEKLY_COMMITMENT_CAP);
  });

  it('flags a member whose projected commitments exceed the cap', async () => {
    // D4: the cap is the guard against re-creating the 300-task pile inside
    // the iteration; an over-cap projection must be impossible to miss.
    const lines = [];
    for (let index = 0; index < WEEKLY_COMMITMENT_CAP + 1; index += 1) {
      const id = `task_c${String(index).padStart(2, '0')}`;
      writeTask(id);
      lines.push(manifestLine({ id, path: `content/tasks/${id}.md`, status: 'ready', iteration: '2026-W33' }));
    }
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), `${lines.join('\n')}\n`, 'utf8');

    const pkg = await buildIterationPrepackage(tmpRoot, {
      closing: '2026-W33',
      today: '2026-08-14',
      pr: false,
    });
    const charlie = pkg.capacity.find((row) => row.owner === 'charlie');
    assert.equal(charlie.over_cap, true);

    const text = formatIterationPrepackage(pkg);
    assert.match(text, /charlie: 0 committed \+ 11 carry incoming = 11 — OVER CAP by 1/);
  });
});
