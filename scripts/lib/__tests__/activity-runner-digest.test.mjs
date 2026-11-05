import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadDigestState, saveDigestState, digestStatePath } from '../activity-runner.mjs';

let tmpRoot;

describe('digest state helpers', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `digest-state-${Date.now()}`);
    mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('saves and loads digest post metadata', () => {
    const payload = {
      channel: 'C123',
      date: '2026-04-15',
      schedule: '18:00',
      root_ts: '111.222',
      thread_posts: [{ kind: 'promoted', ts: '111.333', count: 3 }],
    };
    saveDigestState({ repoRoot: tmpRoot, channel: 'C123', date: '2026-04-15', schedule: '18:00', payload });

    const loaded = loadDigestState({ repoRoot: tmpRoot, channel: 'C123', date: '2026-04-15', schedule: '18:00' });
    assert.deepEqual(loaded, payload);

    const path = digestStatePath({ repoRoot: tmpRoot, channel: 'C123', date: '2026-04-15', schedule: '18:00' });
    assert.ok(path.includes('2026-04-15__C123__18_00.json'));
  });
});
