import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { manifestNeedsBuild } from '../indexer.mjs';
import { ensureCatalogFresh } from '../catalog-db.mjs';

let tmpRoot;

function setup() {
  tmpRoot = resolve(tmpdir(), `test-manifest-stale-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(resolve(tmpRoot, 'content', 'tasks'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'workspace', 'charlie', 'logs'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });
}

function bumpMtime(path, deltaMs) {
  const stat = statSync(path);
  const newMs = stat.mtimeMs + deltaMs;
  const seconds = newMs / 1000;
  utimesSync(path, seconds, seconds);
}

describe('manifestNeedsBuild', () => {
  beforeEach(setup);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('returns true when manifest.jsonl is missing', () => {
    writeFileSync(resolve(tmpRoot, 'content/tasks/task_a.md'), '---\nid: x\n---\n');
    assert.equal(manifestNeedsBuild(tmpRoot), true);
  });

  it('returns false when no source file is newer than manifest', () => {
    const sourceFile = resolve(tmpRoot, 'content/tasks/task_a.md');
    writeFileSync(sourceFile, '---\nid: x\n---\n');
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), '{}\n');
    bumpMtime(resolve(tmpRoot, 'index/manifest.jsonl'), 60_000);

    assert.equal(manifestNeedsBuild(tmpRoot), false);
  });

  it('returns true when a content/* file mtime exceeds manifest mtime', () => {
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), '{}\n');
    const sourceFile = resolve(tmpRoot, 'content/tasks/task_a.md');
    writeFileSync(sourceFile, '---\nid: x\n---\n');
    bumpMtime(sourceFile, 60_000);

    assert.equal(manifestNeedsBuild(tmpRoot), true);
  });

  it('returns true when a workspace/* file mtime exceeds manifest mtime', () => {
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), '{}\n');
    const logFile = resolve(tmpRoot, 'workspace/charlie/logs/2026-04-30.md');
    writeFileSync(logFile, '# log\n');
    bumpMtime(logFile, 60_000);

    assert.equal(manifestNeedsBuild(tmpRoot), true);
  });

  it('ignores non-source files (e.g. *.png) when comparing mtimes', () => {
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), '{}\n');
    const irrelevant = resolve(tmpRoot, 'content/tasks/screenshot.png');
    writeFileSync(irrelevant, 'binary');
    bumpMtime(irrelevant, 60_000);

    assert.equal(manifestNeedsBuild(tmpRoot), false);
  });

  it('skips ignored directories (.git, node_modules, .hey, index)', () => {
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), '{}\n');
    mkdirSync(resolve(tmpRoot, 'content', '.git'), { recursive: true });
    const ignored = resolve(tmpRoot, 'content/.git/HEAD.md');
    writeFileSync(ignored, '# nope\n');
    bumpMtime(ignored, 60_000);

    assert.equal(manifestNeedsBuild(tmpRoot), false);
  });
});

describe('ensureCatalogFresh — graceful degradation', () => {
  beforeEach(setup);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('does not throw when buildIndexes fails on validation', () => {
    // Repo with no vocab files → validateRepository errors → buildIndexes throws.
    // Pre-seed a stale manifest so manifestNeedsBuild fires and the catch path runs.
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), '{}\n');
    const sourceFile = resolve(tmpRoot, 'content/tasks/task_a.md');
    writeFileSync(sourceFile, '---\nid: x\n---\n');
    bumpMtime(sourceFile, 60_000);

    const originalErr = console.error;
    const captured = [];
    console.error = (...args) => captured.push(args.join(' '));

    let result;
    try {
      result = ensureCatalogFresh(tmpRoot);
    } finally {
      console.error = originalErr;
    }

    assert.equal(result.manifest, false);
    assert.ok(captured.some((line) => line.includes('manifest rebuild skipped')));
  });
});
