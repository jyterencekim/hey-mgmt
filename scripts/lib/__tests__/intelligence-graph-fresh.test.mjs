import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

import { graphNeedsBuild, getDb } from '../../kg.mjs';

let tmpRoot;
let cfg;

function setup() {
  tmpRoot = resolve(tmpdir(), `test-kg-fresh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(resolve(tmpRoot, 'content', 'tasks'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'workspace', 'terence'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'imports'), { recursive: true });
  mkdirSync(resolve(tmpRoot, '.kg'), { recursive: true });

  cfg = {
    mgmtRoot: tmpRoot,
    importsDir: resolve(tmpRoot, 'imports'),
    outDir: resolve(tmpRoot, '.kg'),
    dbPath: resolve(tmpRoot, '.kg', 'graph.sqlite'),
  };
}

function bumpMtime(path, deltaMs) {
  const stat = statSync(path);
  const newMs = stat.mtimeMs + deltaMs;
  const seconds = newMs / 1000;
  utimesSync(path, seconds, seconds);
}

describe('graphNeedsBuild & getDb staleness auto-rebuild', () => {
  beforeEach(setup);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('returns true when dbPath does not exist', () => {
    assert.equal(graphNeedsBuild(cfg), true);
  });

  it('returns false when dbPath is newer than all sources', () => {
    writeFileSync(resolve(tmpRoot, 'content/tasks/task_test.md'), '---\nid: task_test\ntype: task\n---\n');
    writeFileSync(cfg.dbPath, 'fake-sqlite');
    bumpMtime(cfg.dbPath, 60_000);

    assert.equal(graphNeedsBuild(cfg), false);
  });

  it('returns true when a content markdown file is newer than dbPath', () => {
    writeFileSync(cfg.dbPath, 'fake-sqlite');
    const note = resolve(tmpRoot, 'content/tasks/task_test.md');
    writeFileSync(note, '---\nid: task_test\ntype: task\n---\n');
    bumpMtime(note, 60_000);

    assert.equal(graphNeedsBuild(cfg), true);
  });

  it('returns true when a workspace markdown file is newer than dbPath', () => {
    writeFileSync(cfg.dbPath, 'fake-sqlite');
    const ws = resolve(tmpRoot, 'workspace/terence/note_scratch.md');
    writeFileSync(ws, '---\nid: note_scratch\ntype: note\n---\n');
    bumpMtime(ws, 60_000);

    assert.equal(graphNeedsBuild(cfg), true);
  });

  it('returns true when an imports file is newer than dbPath', () => {
    writeFileSync(cfg.dbPath, 'fake-sqlite');
    const imp = resolve(tmpRoot, 'imports/auditor.jsonl');
    writeFileSync(imp, '{"kind":"fact"}\n');
    bumpMtime(imp, 60_000);

    assert.equal(graphNeedsBuild(cfg), true);
  });

  it('respects no-rebuild flag when database exists', () => {
    writeFileSync(cfg.dbPath, 'dummy');
    const f = resolve(tmpRoot, 'content/tasks/task_a.md');
    writeFileSync(f, '---\nid: task_a\ntype: task\n---\n');
    bumpMtime(f, 60_000);
    assert.equal(graphNeedsBuild(cfg), true);
  });
});
