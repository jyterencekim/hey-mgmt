import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  observationFilePath,
  writeObservation,
  readObservations,
  deleteObservation,
  demoteObservation,
} from '../activity-observations.mjs';

let tmpRoot;

beforeEach(() => {
  tmpRoot = resolve(tmpdir(), `obs-test-${Date.now()}`);
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const baseObs = {
  date: '2026-04-08',
  tier: 'observed',
  signature: 'sig-abc123',
  source: 'slack',
  title: 'Team standup notes',
  actor: 'alice',
  time: '09:00 KST',
  url: 'https://slack.example/msg-1',
  relevance: 'high',
  reason: 'Mentions Fisher rollout',
};

describe('observationFilePath', () => {
  it('returns correct path', () => {
    const filePath = observationFilePath(tmpRoot, '2026-04-08');
    assert.equal(filePath, resolve(tmpRoot, 'workspace/fisher/observations/2026-04-08.md'));
  });
});

describe('writeObservation', () => {
  it('creates new file with header and entry', () => {
    writeObservation(tmpRoot, baseObs);
    const filePath = observationFilePath(tmpRoot, baseObs.date);
    const raw = readFileSync(filePath, 'utf8');
    assert.ok(raw.startsWith('# Fisher Observations — 2026-04-08\n'));
    assert.ok(raw.includes('<!-- obs:sig-abc123 tier:observed -->'));
    assert.ok(raw.includes('### [slack] Team standup notes'));
    assert.ok(raw.includes('**Actor**: alice'));
    assert.ok(raw.includes('**Relevance**: high'));
  });

  it('appends to existing file when called twice, both entries present', () => {
    writeObservation(tmpRoot, baseObs);
    writeObservation(tmpRoot, { ...baseObs, signature: 'sig-def456', title: 'Second entry', url: 'https://slack.example/msg-2' });
    const raw = readFileSync(observationFilePath(tmpRoot, baseObs.date), 'utf8');
    assert.ok(raw.includes('<!-- obs:sig-abc123 tier:observed -->'));
    assert.ok(raw.includes('<!-- obs:sig-def456 tier:observed -->'));
    assert.ok(raw.includes('Team standup notes'));
    assert.ok(raw.includes('Second entry'));
  });

  it('includes promoted_to field only when present', () => {
    writeObservation(tmpRoot, { ...baseObs, promoted_to: 'content/notes/2026/04/note_xyz.md' });
    const raw = readFileSync(observationFilePath(tmpRoot, baseObs.date), 'utf8');
    assert.ok(raw.includes('**Promoted_to**: content/notes/2026/04/note_xyz.md'));

    rmSync(observationFilePath(tmpRoot, baseObs.date));
    writeObservation(tmpRoot, baseObs);
    const raw2 = readFileSync(observationFilePath(tmpRoot, baseObs.date), 'utf8');
    assert.ok(!raw2.includes('Promoted_to'));
  });

  it('skips materially duplicate observations even with a new signature', () => {
    writeObservation(tmpRoot, baseObs);
    writeObservation(tmpRoot, { ...baseObs, signature: 'sig-new-but-same' });
    const entries = readObservations(tmpRoot, baseObs.date);
    assert.equal(entries.length, 1);
  });
});

describe('readObservations', () => {
  it('returns empty array when file does not exist', () => {
    const result = readObservations(tmpRoot, '2026-04-08');
    assert.deepEqual(result, []);
  });

  it('parses a single entry correctly', () => {
    writeObservation(tmpRoot, baseObs);
    const [entry] = readObservations(tmpRoot, baseObs.date);
    assert.equal(entry.signature, 'sig-abc123');
    assert.equal(entry.tier, 'observed');
    assert.equal(entry.source, 'slack');
    assert.equal(entry.title, 'Team standup notes');
    assert.equal(entry.actor, 'alice');
    assert.equal(entry.relevance, 'high');
  });

  it('handles multiple entries', () => {
    writeObservation(tmpRoot, baseObs);
    writeObservation(tmpRoot, { ...baseObs, signature: 'sig-def456', title: 'Second entry', source: 'github', url: 'https://github.example/issue-2' });
    const entries = readObservations(tmpRoot, baseObs.date);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].signature, 'sig-abc123');
    assert.equal(entries[1].signature, 'sig-def456');
    assert.equal(entries[1].source, 'github');
    assert.equal(entries[1].title, 'Second entry');
  });
});

describe('deleteObservation', () => {
  it('removes entry by signature and keeps others', () => {
    writeObservation(tmpRoot, baseObs);
    writeObservation(tmpRoot, { ...baseObs, signature: 'sig-def456', title: 'Second entry', url: 'https://slack.example/msg-2' });
    const removed = deleteObservation(tmpRoot, baseObs.date, 'sig-abc123');
    assert.equal(removed, true);
    const raw = readFileSync(observationFilePath(tmpRoot, baseObs.date), 'utf8');
    assert.ok(!raw.includes('sig-abc123'));
    assert.ok(raw.includes('sig-def456'));
    assert.ok(raw.includes('Second entry'));
  });

  it('returns false for nonexistent signature', () => {
    writeObservation(tmpRoot, baseObs);
    const result = deleteObservation(tmpRoot, baseObs.date, 'no-such-sig');
    assert.equal(result, false);
  });
});

describe('demoteObservation', () => {
  it('changes tier from promoted to observed', () => {
    writeObservation(tmpRoot, { ...baseObs, tier: 'promoted' });
    const result = demoteObservation(tmpRoot, baseObs.date, baseObs.signature);
    assert.equal(result, true);
    const raw = readFileSync(observationFilePath(tmpRoot, baseObs.date), 'utf8');
    assert.ok(raw.includes('<!-- obs:sig-abc123 tier:observed -->'));
    assert.ok(!raw.includes('tier:promoted'));
  });

  it('returns false when signature not found', () => {
    writeObservation(tmpRoot, { ...baseObs, tier: 'promoted' });
    const result = demoteObservation(tmpRoot, baseObs.date, 'no-such-sig');
    assert.equal(result, false);
  });
});
