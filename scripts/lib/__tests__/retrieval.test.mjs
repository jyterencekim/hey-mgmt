import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { searchRepository, searchRepositoryAdaptive } from '../retrieval.mjs';

function makeManifestLine(overrides) {
  const base = {
    id: 'task_x',
    type: 'task',
    status: 'ready',
    owner: 'agent',
    priority: 'plan',
    title: 'X task',
    path: 'content/tasks/task_x.md',
    tags: [],
    relations_out: [],
    hashes: { content_hash: 'xxx' },
    created_at: '2026-03-01',
    updated_at: '2026-03-05',
    project: 'TestProject',
    entities: [],
    links_out: [],
    sources: [],
    feedback: { adopt: 0, reject: 0, warn: 0, score: 0.5 },
    unresolved_entities: [],
    due_date: null,
    iteration: null
  };

  return JSON.stringify({ ...base, ...overrides });
}

let tmpRoot;

function setupTmpRepo() {
  tmpRoot = resolve(tmpdir(), `test-retrieval-${Date.now()}`);
  mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });

  const manifestEntries = [
    makeManifestLine({
      id: 'task_integrate-bridge-aggregator',
      title: 'Integrate Bridge Aggregator',
      owner: 'terence',
      priority: 'do',
      project: 'SuperearnCore',
      path: 'content/tasks/2026/03/task_integrate-bridge-aggregator.md'
    }),
    makeManifestLine({
      id: 'note_external-schedule-2026q1q2',
      type: 'note',
      status: 'active',
      title: 'External Schedule and Partner Dependencies (2026 Q1-Q2)',
      owner: 'jared',
      project: 'SuperearnCore',
      path: 'content/notes/note_external-schedule-2026q1q2.md'
    }),
    makeManifestLine({
      id: 'decision_deflate-ontology',
      type: 'decision',
      status: 'active',
      title: 'ADR: Deflate artifact ontology from 10 to 5 types',
      owner: 'jared',
      project: null,
      path: 'content/decisions/decision_deflate-ontology.md'
    })
  ];

  writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), `${manifestEntries.join('\n')}\n`, 'utf8');

  const searchIndex = {
    generated_at: '2026-03-06T00:00:00.000Z',
    documents: [
      {
        id: 'task_integrate-bridge-aggregator',
        title: 'Integrate Bridge Aggregator',
        path: 'content/tasks/2026/03/task_integrate-bridge-aggregator.md',
        type: 'task',
        project: 'SuperearnCore',
        status: 'ready',
        owner: 'terence',
        text: 'Integrate Bridge Aggregator cross-chain asset transfers EIP-712 approval flow QA deploy'
      },
      {
        id: 'note_external-schedule-2026q1q2',
        title: 'External Schedule and Partner Dependencies (2026 Q1-Q2)',
        path: 'content/notes/note_external-schedule-2026q1q2.md',
        type: 'note',
        project: 'SuperearnCore',
        status: 'active',
        owner: 'jared',
        text: 'External Schedule and Partner Dependencies release timeline partner dependencies'
      },
      {
        id: 'decision_deflate-ontology',
        title: 'ADR: Deflate artifact ontology from 10 to 5 types',
        path: 'content/decisions/decision_deflate-ontology.md',
        type: 'decision',
        project: null,
        status: 'active',
        owner: 'jared',
        text: 'ADR Deflate artifact ontology from 10 to 5 types artifact simplification'
      }
    ]
  };

  writeFileSync(resolve(tmpRoot, 'index/search.flex.json'), `${JSON.stringify(searchIndex, null, 2)}\n`, 'utf8');
}

describe('searchRepository()', () => {
  beforeEach(setupTmpRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('returns no results for non-matching queries', () => {
    const results = searchRepository('zzzzzzzz-no-match', {}, { repoRoot: tmpRoot });
    assert.deepEqual(results, []);
  });

  it('matches derived body text from the search index', () => {
    const results = searchRepository('cross chain asset transfers', {}, { repoRoot: tmpRoot });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'task_integrate-bridge-aggregator');
  });

  it('still supports empty-query filtered listings', () => {
    const results = searchRepository('', { owner: 'jared', type: 'note', status: 'active' }, { repoRoot: tmpRoot });
    assert.deepEqual(results.map((item) => item.id), ['note_external-schedule-2026q1q2']);
  });

  it('adaptive search returns lexical ranking', async () => {
    const results = await searchRepositoryAdaptive('cross chain asset transfers', {}, {
      repoRoot: tmpRoot,
      retrieval: 'auto',
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'task_integrate-bridge-aggregator');
  });
});
