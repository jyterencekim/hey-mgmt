import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const testRoot = resolve(tmpdir(), `knowledge-test-${Date.now()}`);

function setupTestRepo() {
  mkdirSync(resolve(testRoot, 'content'), { recursive: true });
  mkdirSync(resolve(testRoot, 'workspace/fisher/knowledge'), { recursive: true });
  mkdirSync(resolve(testRoot, 'index'), { recursive: true });
  // Minimal manifest for catalog-db
  writeFileSync(resolve(testRoot, 'index/manifest.jsonl'), '', 'utf8');
  writeFileSync(resolve(testRoot, 'index/feedback_agg.json'), '{}', 'utf8');
}

function teardownTestRepo() {
  rmSync(testRoot, { recursive: true, force: true });
}

function makeEvent(overrides = {}) {
  return {
    source: 'slack',
    object_id: 'thread__C0AC9CBPPJS__123_456',
    object_type: 'slack-thread',
    object_title: '#superearn-internal: vault rebalancing 논의',
    object_url: 'https://slack.com/archives/C0AC9CBPPJS/p123456',
    actor: 'Jared',
    workspace_owner: 'jared',
    summary: 'Team discussed vault rebalancing thresholds for custom strategy',
    changed_at: '2026-04-08T09:30:00.000Z',
    kst_date: '2026-04-08',
    signature: 'sig_test_001',
    ...overrides,
  };
}

describe('knowledge entry writer', () => {
  beforeEach(setupTestRepo);
  afterEach(teardownTestRepo);

  it('writes to correct monthly file', async () => {
    const { appendKnowledgeEntry, buildKnowledgeEntry } = await import('../activity-state.mjs');
    const entry = buildKnowledgeEntry({
      event: makeEvent(),
      classification: 'skip',
      confidence: 0.8,
      agentReason: 'Routine discussion',
    });
    appendKnowledgeEntry(testRoot, entry);

    const filePath = resolve(testRoot, 'workspace/fisher/knowledge/2026-04.jsonl');
    assert.ok(existsSync(filePath), 'monthly JSONL file should exist');
    const parsed = JSON.parse(readFileSync(filePath, 'utf8').trim());
    assert.equal(parsed.source, 'slack');
    assert.equal(parsed.classification, 'skip');
    assert.equal(parsed.status, 'indexed');
    assert.equal(parsed.workspace_owner, 'jared');
  });

  it('computes relevance_score for skip', async () => {
    const { buildKnowledgeEntry } = await import('../activity-state.mjs');
    const entry = buildKnowledgeEntry({
      event: makeEvent(),
      classification: 'skip',
      confidence: 0.9,
      agentReason: 'Not worth preserving',
    });
    assert.ok(entry.relevance_score <= 0.15, `skip confidence=0.9 should have low relevance, got ${entry.relevance_score}`);
  });

  it('computes relevance_score for match', async () => {
    const { buildKnowledgeEntry } = await import('../activity-state.mjs');
    const entry = buildKnowledgeEntry({
      event: makeEvent(),
      classification: 'match',
      confidence: 0.85,
      agentReason: 'Title overlap',
      status: 'pending',
    });
    assert.ok(entry.relevance_score > 0.4, `match confidence=0.85 should have moderate relevance, got ${entry.relevance_score}`);
    assert.equal(entry.status, 'pending');
  });

  it('sets status indexed for skip, pending for match/distill', async () => {
    const { buildKnowledgeEntry } = await import('../activity-state.mjs');
    assert.equal(buildKnowledgeEntry({ event: makeEvent(), classification: 'skip', confidence: 0.5 }).status, 'indexed');
    assert.equal(buildKnowledgeEntry({ event: makeEvent(), classification: 'match', confidence: 0.5 }).status, 'pending');
    assert.equal(buildKnowledgeEntry({ event: makeEvent(), classification: 'distill', confidence: 0.5 }).status, 'pending');
  });

  it('uses raw event summary, not agent content', async () => {
    const { buildKnowledgeEntry } = await import('../activity-state.mjs');
    const entry = buildKnowledgeEntry({
      event: makeEvent({ summary: 'Raw event summary from collector' }),
      classification: 'match',
      confidence: 0.85,
      agentReason: 'Agent generated summary here',
    });
    assert.equal(entry.summary, 'Raw event summary from collector');
    assert.equal(entry.agent_reason, 'Agent generated summary here');
  });

  it('refuses sparse events instead of writing unknown rows', async () => {
    const { appendKnowledgeEntry, buildKnowledgeEntry } = await import('../activity-state.mjs');
    const entry = buildKnowledgeEntry({
      event: makeEvent({ object_title: '', kst_date: '' }),
      classification: 'skip',
      confidence: 0.8,
    });
    assert.equal(entry, null);
    assert.equal(appendKnowledgeEntry(testRoot, entry), null);
    assert.equal(existsSync(resolve(testRoot, 'workspace/fisher/knowledge/unknown.jsonl')), false);
  });

  it('excludes GitHub commit records from the knowledge base', async () => {
    const { appendKnowledgeEntry, buildKnowledgeEntry, loadMergedKnowledgeEntries } = await import('../activity-state.mjs');
    const entry = buildKnowledgeEntry({
      event: makeEvent({
        source: 'github',
        object_id: 'superearn-io/onchain-analysis/commit/c98518caa8c4f92afc31e77e74a56a86775668ea',
        object_type: 'github-commit',
        object_title: 'Commit c98518c: Add Dune current holder source-of-funds analysis',
        object_url: 'https://github.com/superearn-io/onchain-analysis/commit/c98518caa8c4f92afc31e77e74a56a86775668ea',
        actor: 'lwj010',
        summary: 'GitHub commit on superearn-io/onchain-analysis (main): Add Dune current holder source-of-funds analysis',
        signature: 'sig_github_commit_001',
      }),
      classification: 'distill',
      confidence: 0.9,
      status: 'pending',
    });

    assert.equal(appendKnowledgeEntry(testRoot, entry), null);
    assert.equal(existsSync(resolve(testRoot, 'workspace/fisher/knowledge/2026-04.jsonl')), false);

    writeFileSync(resolve(testRoot, 'workspace/fisher/knowledge/2026-04.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
    assert.deepEqual(loadMergedKnowledgeEntries(testRoot), []);
  });

  it('keeps duplicate signature writes append-only but merges them for readers', async () => {
    const { appendKnowledgeEntry, buildKnowledgeEntry, loadMergedKnowledgeEntries } = await import('../activity-state.mjs');
    const first = buildKnowledgeEntry({
      event: makeEvent({ summary: 'First summary' }),
      classification: 'match',
      confidence: 0.7,
      status: 'pending',
    });
    const second = buildKnowledgeEntry({
      event: makeEvent({ summary: 'Updated summary' }),
      classification: 'match',
      confidence: 0.9,
      status: 'linked',
      linkedArtifact: 'task_oracle-fallback',
    });

    appendKnowledgeEntry(testRoot, first);
    appendKnowledgeEntry(testRoot, second);

    const filePath = resolve(testRoot, 'workspace/fisher/knowledge/2026-04.jsonl');
    const rows = readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(rows.length, 2, 'physical writes should remain append-only to reduce git conflicts');

    const [merged] = loadMergedKnowledgeEntries(testRoot);
    assert.equal(merged.summary, 'Updated summary');
    assert.equal(merged.status, 'linked');
    assert.equal(merged.linked_artifact, 'task_oracle-fallback');
  });

  it('records status updates append-only and resolves them logically', async () => {
    const { loadMergedKnowledgeEntries, updateKnowledgeEntryStatus } = await import('../activity-state.mjs');
    const first = {
      id: 'kn_one', source: 'slack', object_id: 'obj1', object_type: 'slack-message',
      title: 'One', summary: 'One', url: 'https://example.com/1',
      actors: [], workspace_owner: 'jared', date: '2026-04-08',
      changed_at: '2026-04-08T09:00:00Z', topics: [], classification: 'match',
      status: 'pending', linked_artifact: null, relevance_score: 0.5, signature: 'sig_status_all',
    };
    const second = { ...first, id: 'kn_two', date: '2026-05-01' };
    writeFileSync(resolve(testRoot, 'workspace/fisher/knowledge/2026-04.jsonl'), JSON.stringify(first) + '\n', 'utf8');
    writeFileSync(resolve(testRoot, 'workspace/fisher/knowledge/2026-05.jsonl'), JSON.stringify(second) + '\n', 'utf8');

    const changed = updateKnowledgeEntryStatus(testRoot, 'sig_status_all', 'linked', 'task_oracle-fallback');
    assert.equal(changed, true);
    const physicalRows = ['2026-04.jsonl', '2026-05.jsonl']
      .flatMap((file) => readFileSync(resolve(testRoot, 'workspace/fisher/knowledge', file), 'utf8').trim().split('\n').filter(Boolean));
    assert.equal(physicalRows.length, 3);

    const [merged] = loadMergedKnowledgeEntries(testRoot);
    assert.equal(merged.status, 'linked');
    assert.equal(merged.linked_artifact, 'task_oracle-fallback');
  });

  it('compacts append-only duplicate rows on explicit maintenance command', async () => {
    const { appendKnowledgeEntry, buildKnowledgeEntry, compactKnowledgeEntries } = await import('../activity-state.mjs');
    const first = buildKnowledgeEntry({
      event: makeEvent({ summary: 'First summary' }),
      classification: 'match',
      confidence: 0.7,
      status: 'pending',
    });
    const second = buildKnowledgeEntry({
      event: makeEvent({ summary: 'Updated summary' }),
      classification: 'match',
      confidence: 0.9,
      status: 'linked',
      linkedArtifact: 'task_oracle-fallback',
    });

    appendKnowledgeEntry(testRoot, first);
    appendKnowledgeEntry(testRoot, second);

    const result = compactKnowledgeEntries(testRoot);
    assert.equal(result.read, 2);
    assert.equal(result.written, 1);

    const rows = readFileSync(resolve(testRoot, 'workspace/fisher/knowledge/2026-04.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'linked');
    assert.equal(rows[0].linked_artifact, 'task_oracle-fallback');
  });

  it('reports raw versus logical knowledge rows for compaction pressure', async () => {
    const { appendKnowledgeEntry, buildKnowledgeEntry, inspectKnowledgeCompaction } = await import('../activity-state.mjs');
    const first = buildKnowledgeEntry({
      event: makeEvent({ summary: 'First summary' }),
      classification: 'match',
      confidence: 0.7,
      status: 'pending',
    });
    const second = buildKnowledgeEntry({
      event: makeEvent({ summary: 'Updated summary' }),
      classification: 'match',
      confidence: 0.9,
      status: 'linked',
      linkedArtifact: 'task_oracle-fallback',
    });

    appendKnowledgeEntry(testRoot, first);
    appendKnowledgeEntry(testRoot, second);

    const stats = inspectKnowledgeCompaction(testRoot);
    assert.equal(stats.raw_rows, 2);
    assert.equal(stats.logical_rows, 1);
    assert.equal(stats.superseded_rows, 1);
    assert.equal(stats.superseded_ratio, 0.5);
  });

  it('gates automatic compaction by cooldown and garbage thresholds', async () => {
    const { evaluateKnowledgeCompaction } = await import('../activity-runner.mjs');
    const now = new Date('2026-04-24T00:00:00Z');
    const config = {
      knowledge_compaction: {
        enabled: true,
        min_interval_hours: 24,
        max_interval_hours: 168,
        min_superseded_rows: 500,
        min_superseded_ratio: 0.2,
        min_periodic_superseded_rows: 50,
      },
    };

    assert.equal(
      evaluateKnowledgeCompaction({
        config,
        now,
        state: { last_compacted_at: '2026-04-23T12:00:00Z' },
        stats: { raw_rows: 2000, superseded_rows: 800, superseded_ratio: 0.4 },
      }).reason,
      'cooldown',
    );

    assert.equal(
      evaluateKnowledgeCompaction({
        config,
        now,
        state: { last_compacted_at: '2026-04-22T00:00:00Z' },
        stats: { raw_rows: 2000, superseded_rows: 800, superseded_ratio: 0.4 },
      }).reason,
      'threshold',
    );

    assert.equal(
      evaluateKnowledgeCompaction({
        config,
        now,
        state: { last_compacted_at: '2026-04-10T00:00:00Z' },
        stats: { raw_rows: 2000, superseded_rows: 80, superseded_ratio: 0.04 },
      }).reason,
      'periodic',
    );

    assert.equal(
      evaluateKnowledgeCompaction({
        config,
        now,
        state: { last_compacted_at: '2026-04-22T00:00:00Z' },
        stats: { raw_rows: 2000, superseded_rows: 80, superseded_ratio: 0.04 },
      }).reason,
      'below_threshold',
    );
  });
});

describe('knowledge table in catalog SQLite', () => {
  beforeEach(setupTestRepo);
  afterEach(teardownTestRepo);

  it('populates knowledge table from JSONL', async () => {
    const { buildCatalogDatabase, queryCatalog } = await import('../catalog-db.mjs');
    const knowledgePath = resolve(testRoot, 'workspace/fisher/knowledge/2026-04.jsonl');
    writeFileSync(knowledgePath, JSON.stringify({
      id: 'kn_test1', source: 'slack', object_id: 'obj1', object_type: 'slack-message',
      title: 'Test entry', summary: 'Test summary', url: 'https://example.com',
      actors: ['Jared'], workspace_owner: 'jared', date: '2026-04-08',
      changed_at: '2026-04-08T09:00:00Z', topics: [], classification: 'skip',
      status: 'indexed', linked_artifact: null, agent_reason: 'test',
      relevance_score: 0.5, signature: 'sig_001',
    }) + '\n', 'utf8');

    buildCatalogDatabase(testRoot);
    const rows = queryCatalog({ repoRoot: testRoot, sql: 'SELECT * FROM knowledge' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'kn_test1');
    assert.equal(rows[0].workspace_owner, 'jared');
  });

  it('skips malformed JSONL lines', async () => {
    const { buildCatalogDatabase, queryCatalog } = await import('../catalog-db.mjs');
    const knowledgePath = resolve(testRoot, 'workspace/fisher/knowledge/2026-04.jsonl');
    const validLine = JSON.stringify({
      id: 'kn_test2', source: 'slack', object_id: 'obj2', object_type: 'slack-message',
      title: 'Valid', summary: 'Valid', url: '', actors: [], workspace_owner: 'jared',
      date: '2026-04-08', changed_at: '2026-04-08T09:00:00Z', topics: [],
      classification: 'skip', status: 'indexed', relevance_score: 0.5, signature: 'sig_002',
    });
    writeFileSync(knowledgePath, `{bad json\n${validLine}\n`, 'utf8');

    buildCatalogDatabase(testRoot);
    const rows = queryCatalog({ repoRoot: testRoot, sql: 'SELECT * FROM knowledge' });
    assert.equal(rows.length, 1);
  });

  it('handles missing knowledge directory gracefully', async () => {
    const { buildCatalogDatabase, queryCatalog } = await import('../catalog-db.mjs');
    rmSync(resolve(testRoot, 'workspace/fisher/knowledge'), { recursive: true, force: true });
    buildCatalogDatabase(testRoot);
    const rows = queryCatalog({ repoRoot: testRoot, sql: 'SELECT * FROM knowledge' });
    assert.equal(rows.length, 0);
  });

  it('deduplicates by signature', async () => {
    const { buildCatalogDatabase, queryCatalog } = await import('../catalog-db.mjs');
    const knowledgePath = resolve(testRoot, 'workspace/fisher/knowledge/2026-04.jsonl');
    const entry = {
      id: 'kn_dup1', source: 'slack', object_id: 'obj3', object_type: 'slack-message',
      title: 'First', summary: 'First', url: '', actors: [], workspace_owner: 'jared',
      date: '2026-04-08', changed_at: '2026-04-08T09:00:00Z', topics: [],
      classification: 'skip', status: 'indexed', relevance_score: 0.5, signature: 'sig_dup',
    };
    const updated = { ...entry, id: 'kn_dup2', title: 'Updated' };
    writeFileSync(knowledgePath, JSON.stringify(entry) + '\n' + JSON.stringify(updated) + '\n', 'utf8');

    buildCatalogDatabase(testRoot);
    const rows = queryCatalog({ repoRoot: testRoot, sql: 'SELECT * FROM knowledge' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Updated');
  });

  it('detects a stale catalog when knowledge JSONL is newer than SQLite', async () => {
    const { buildCatalogDatabase, catalogDbNeedsBuild } = await import('../catalog-db.mjs');
    const knowledgePath = resolve(testRoot, 'workspace/fisher/knowledge/2026-04.jsonl');
    writeFileSync(knowledgePath, JSON.stringify({
      id: 'kn_stale', source: 'slack', object_id: 'obj4', object_type: 'slack-message',
      title: 'Stale check', summary: 'Initial', url: 'https://example.com',
      actors: [], workspace_owner: 'jared', date: '2026-04-08',
      changed_at: '2026-04-08T09:00:00Z', topics: [], classification: 'skip',
      status: 'indexed', relevance_score: 0.5, signature: 'sig_stale',
    }) + '\n', 'utf8');

    buildCatalogDatabase(testRoot);
    const future = new Date(Date.now() + 60_000);
    utimesSync(knowledgePath, future, future);
    assert.equal(catalogDbNeedsBuild(testRoot), true);
  });
});

describe('CJK-aware tokenization', () => {
  it('keeps 2-char Korean tokens', async () => {
    const { textScore } = await import('../retrieval.mjs');
    const item = { id: 'test', title: '볼트 리밸런싱 전략' };
    const searchDoc = { text: '볼트 리밸런싱 전략 vault rebalancing strategy' };
    const score = textScore(item, '볼트', searchDoc);
    assert.ok(score > 0, `Korean 2-char token "볼트" should match, got score ${score}`);
  });

  it('filters 2-char Latin tokens in token matching', async () => {
    const { textScore } = await import('../retrieval.mjs');
    // Use a corpus where "ab" doesn't appear as a substring in title/id/corpus
    const item = { id: 'test', title: 'long testing framework example' };
    const searchDoc = { text: 'long testing framework example for validation' };
    const score = textScore(item, 'ab', searchDoc);
    assert.equal(score, 0, '2-char Latin token "ab" should produce no tokens and score 0');
  });

  it('handles mixed Korean+English queries', async () => {
    const { textScore } = await import('../retrieval.mjs');
    const item = { id: 'test', title: 'vault 리밸런싱' };
    const searchDoc = { text: 'vault 리밸런싱 threshold discussion 볼트 전략' };
    const score = textScore(item, 'vault 전략', searchDoc);
    assert.ok(score > 0, `Mixed query "vault 전략" should match, got score ${score}`);
  });

  it('matches Korean query against English equivalents for common retrieval terms', async () => {
    const { textScore } = await import('../retrieval.mjs');
    const item = { id: 'test', title: 'vault rebalancing strategy' };
    const searchDoc = { text: 'vault rebalancing strategy for allocation changes' };
    const score = textScore(item, '볼트 리밸런싱', searchDoc);
    assert.ok(score > 0, `Korean query "볼트 리밸런싱" should match English equivalent text, got score ${score}`);
  });

  it('matches mixed-script query against bilingual equivalents in either direction', async () => {
    const { textScore } = await import('../retrieval.mjs');
    const item = { id: 'test', title: 'vault 리밸런싱' };
    const searchDoc = { text: 'vault 리밸런싱 threshold discussion' };
    const score = textScore(item, '볼트 rebalancing', searchDoc);
    assert.ok(score > 0, `Mixed query "볼트 rebalancing" should match bilingual equivalent text, got score ${score}`);
  });

  it('preserves English 3-char minimum', async () => {
    const { textScore } = await import('../retrieval.mjs');
    const item = { id: 'test', title: 'vault strategy' };
    const searchDoc = { text: 'vault strategy rebalancing' };
    const score = textScore(item, 'vault', searchDoc);
    assert.ok(score > 0, `English 5-char token "vault" should match, got score ${score}`);
  });
});
