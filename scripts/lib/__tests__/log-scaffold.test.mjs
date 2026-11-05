import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SCAFFOLD_END,
  SCAFFOLD_START,
  applyLogScaffold,
  renderScaffoldSection,
} from '../log-scaffold.mjs';

function scaffoldFixture(overrides = {}) {
  return {
    generated_at: '2026-08-14T12:00:00.000Z',
    member: 'charlie',
    date: '2026-08-14',
    commits: [{ hash: 'abc1234', time: '10:30', author: 'charlie-dev', subject: 'fix: something' }],
    runs: [{ run_id: 'run_1', task_id: 'task_x', status: 'completed', events: ['completed'] }],
    tasks_touched: [{ id: 'task_x', title: 'Task X', status: 'done' }],
    ...overrides,
  };
}

describe('renderScaffoldSection()', () => {
  it('wraps pastward facts in the fisher markers with the Auto scaffold heading', () => {
    const section = renderScaffoldSection(scaffoldFixture());
    assert.ok(section.startsWith(SCAFFOLD_START));
    assert.ok(section.endsWith(SCAFFOLD_END));
    assert.match(section, /## Auto scaffold/);
    assert.match(section, /- 10:30 `abc1234` fix: something/);
    assert.match(section, /- `run_1` task_x — completed, now completed/);
    assert.match(section, /- Task X \(`task_x`, done\)/);
  });
});

describe('applyLogScaffold()', () => {
  let tmpRoot;
  const logPath = () => resolve(tmpRoot, 'workspace/charlie/logs/2026-08-14.md');

  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-scaffold-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(resolve(tmpRoot, 'workspace/charlie/logs'), { recursive: true });
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  const apply = (section) => applyLogScaffold(tmpRoot, { member: 'charlie', date: '2026-08-14', section });

  it('creates the log file when missing', () => {
    const result = apply(renderScaffoldSection(scaffoldFixture()));
    assert.equal(result.created, true);
    assert.match(readFileSync(logPath(), 'utf8'), /^# 2026-08-14\n/);
  });

  it('replaces only the marker span and preserves every human-authored line', () => {
    // D2's whole contract: Fisher owns the marker span, the member owns the
    // rest. A scaffold refresh that touched a Reflection would break the pilot.
    const human = `# 2026-08-14\n\n## Log\n- 09:00 — human line\n\n${renderScaffoldSection(scaffoldFixture())}\n\n## Reflection\nMy judgment stays.\n`;
    writeFileSync(logPath(), human, 'utf8');

    const updated = renderScaffoldSection(scaffoldFixture({ commits: [] }));
    const result = apply(updated);
    assert.equal(result.replaced, true);

    const content = readFileSync(logPath(), 'utf8');
    assert.match(content, /- 09:00 — human line/);
    assert.match(content, /My judgment stays\./);
    assert.match(content, /### Commits \(0\)/);
    assert.doesNotMatch(content, /abc1234/);
    // Exactly one marker pair — no duplicated sections on rerun.
    assert.equal(content.split(SCAFFOLD_START).length, 2);
  });

  it('is idempotent: re-applying the same section leaves the file unchanged', () => {
    const section = renderScaffoldSection(scaffoldFixture());
    apply(section);
    const before = readFileSync(logPath(), 'utf8');
    apply(section);
    assert.equal(readFileSync(logPath(), 'utf8'), before);
  });

  it('fails loud on unbalanced markers instead of guessing the span', () => {
    writeFileSync(logPath(), `# 2026-08-14\n\n${SCAFFOLD_START}\nno end marker\n`, 'utf8');
    assert.throws(() => apply('section'), /unbalanced scaffold markers/);
  });
});
