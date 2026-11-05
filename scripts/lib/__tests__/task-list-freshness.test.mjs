import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

let tmpRoot;

function writeTask(frontmatter) {
  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}:\n${value.map((item) => `  - ${JSON.stringify(item)}`).join('\n')}`;
      }
      return `${key}: ${JSON.stringify(value)}`;
    })
    .join('\n');

  writeFileSync(
    resolve(tmpRoot, 'content/tasks/task_fresh.md'),
    `---\n${yaml}\n---\n\n## Context\nFresh task.\n`,
    'utf8'
  );
}

function bumpMtime(path, deltaMs) {
  const stat = statSync(path);
  const seconds = (stat.mtimeMs + deltaMs) / 1000;
  utimesSync(path, seconds, seconds);
}

describe('hey task list freshness', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `task-list-freshness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(resolve(tmpRoot, 'content/tasks'), { recursive: true });
    mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });

    writeTask({
      id: 'task_fresh',
      type: 'task',
      title: 'Fresh task title',
      created_at: '2026-06-16',
      updated_at: '2026-06-16',
      status: 'ready',
      owner: 'jared',
      priority: 'do',
      iteration: '2026-W25',
      due_date: '2026-06-21',
      definition_of_done: ['Fresh value appears in task list'],
    });

    writeFileSync(
      resolve(tmpRoot, 'index/manifest.jsonl'),
      `${JSON.stringify({
        id: 'task_fresh',
        type: 'task',
        title: 'Stale task title',
        path: 'content/tasks/task_fresh.md',
        created_at: '2026-06-01',
        updated_at: '2026-06-01',
        status: 'doing',
        priority: 'plan',
        owner: 'jared',
        due_date: '2026-06-01',
        iteration: '2026-W23',
        tags: [],
        entities: [],
        relations_out: [],
        links_out: [],
        sources: [],
        hashes: {},
        feedback: { adopt: 0, reject: 0, warn: 0, score: 0.5 },
        unresolved_entities: [],
      })}\n`,
      'utf8'
    );

    bumpMtime(resolve(tmpRoot, 'content/tasks/task_fresh.md'), 60_000);
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('rebuilds a stale manifest before listing tasks', () => {
    const output = execFileSync(process.execPath, [resolve(process.cwd(), 'scripts/hey.mjs'), 'task', 'list', '--owner', 'jared'], {
      cwd: process.cwd(),
      env: { ...process.env, HEY_REPO_ROOT: tmpRoot },
      encoding: 'utf8',
    });

    assert.match(output, /task_fresh\s+ready\s+do\s+jared\s+Fresh task title/);
    assert.doesNotMatch(output, /Stale task title/);
  });
});
