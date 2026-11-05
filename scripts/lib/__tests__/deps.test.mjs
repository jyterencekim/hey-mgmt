import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { checkDependencies, listDependencies, showDependency } from '../deps.mjs';

let tmpRoot;

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function setupTmpRepo() {
  tmpRoot = resolve(tmpdir(), `test-deps-${Date.now()}`);
  mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });

  const manifestEntries = [
    {
      id: 'note_strategy-config-frontend-impact',
      type: 'note',
      status: 'active',
      owner: 'terence',
      priority: null,
      title: 'Strategy config changes also require frontend portfolio follow-up',
      path: 'content/notes/dependencies/note_strategy-config-frontend-impact.md',
      tags: ['ChangeImpact'],
      relations_out: [{ type: 'links_to', target: 'task_frontend-portfolio-logic-update' }],
      hashes: { content_hash: 'hash-1' },
      created_at: '2026-04-06',
      updated_at: '2026-04-06',
      area: 'SuperearnApp',
      entities: [],
      links_out: [],
      sources: [{ kind: 'doc', ref: 'content/tasks/2026/04/task_frontend-portfolio-logic-update.md' }],
      feedback: { adopt: 0, reject: 0, warn: 0, score: 0.5 },
      unresolved_entities: [],
      due_date: null,
      iteration: null
    },
    {
      id: 'task_frontend-portfolio-logic-update',
      type: 'task',
      status: 'ready',
      owner: 'terence',
      priority: 'plan',
      title: 'Frontend 포트폴리오 로직 업데이트 (strategy config 기반)',
      path: 'content/tasks/2026/04/task_frontend-portfolio-logic-update.md',
      tags: ['Implementation', 'UX'],
      relations_out: [{ type: 'links_to', target: 'note_strategy-config-frontend-impact' }],
      hashes: { content_hash: 'hash-2' },
      created_at: '2026-04-03',
      updated_at: '2026-04-06',
      area: 'SuperearnApp',
      entities: [],
      links_out: [],
      sources: [],
      feedback: { adopt: 0, reject: 0, warn: 0, score: 0.5 },
      unresolved_entities: [],
      due_date: '2026-04-06',
      iteration: '2026-W15'
    }
  ];

  writeFileSync(
    resolve(tmpRoot, 'index/manifest.jsonl'),
    `${manifestEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8'
  );

  writeJson(resolve(tmpRoot, 'index/backlinks.json'), {
    'note_strategy-config-frontend-impact': ['task_frontend-portfolio-logic-update'],
    'task_frontend-portfolio-logic-update': ['note_strategy-config-frontend-impact']
  });

  writeJson(resolve(tmpRoot, 'index/dependencies.json'), {
    generated_at: '2026-04-06T00:00:00.000Z',
    dependencies: [
      {
        id: 'note_strategy-config-frontend-impact',
        title: 'Strategy config changes also require frontend portfolio follow-up',
        path: 'content/notes/dependencies/note_strategy-config-frontend-impact.md',
        relative_path: 'notes/dependencies/note_strategy-config-frontend-impact.md',
        created_at: '2026-04-06',
        updated_at: '2026-04-06',
        owner: 'terence',
        area: 'SuperearnApp',
        tags: ['ChangeImpact'],
        sources: [{ kind: 'doc', ref: 'content/tasks/2026/04/task_frontend-portfolio-logic-update.md' }],
        relations_out: [{ type: 'links_to', target: 'task_frontend-portfolio-logic-update' }],
        links_out: [],
        contract: {
          triggers: {
            repos: ['superearn-strategy-admin'],
            paths: ['config/strategies/*.json', 'public/config/strategies/*.json'],
            areas: ['SuperearnApp'],
            entities: [],
            intents: ['update strategy config', 'strategy config 기반 포트폴리오 로직 업데이트'],
            terms: ['strategy config', 'strategy admin', 'portfolio logic', '포트폴리오 로직', 'ethereum json']
          },
          obligations: [
            {
              title: 'Sync frontend portfolio logic to the latest strategy config',
              severity: 'required',
              repos: [],
              entities: [],
              paths: ['public/config/strategies/ethereum.json', 'config/strategies/ethereum.json'],
              actions: ['Reflect the changed strategy-config assumptions in frontend portfolio logic.']
            },
            {
              title: 'Run frontend QA after strategy config changes',
              severity: 'required',
              repos: [],
              entities: [],
              paths: [],
              actions: ['Run the frontend QA pass that covers Ethereum portfolio rendering.']
            }
          ],
          verification: ['Ethereum portfolio flow renders correctly with the new config.']
        },
        trigger_repo_terms: ['superearn-strategy-admin', 'strategy admin'],
        trigger_entity_terms: [],
        obligation_repo_terms: [],
        obligation_entity_terms: [],
        search_terms: [
          'strategy config',
          'strategy admin',
          'portfolio logic',
          'frontend portfolio logic',
          '포트폴리오 로직',
          'ethereum json'
        ],
        body_text: 'Use this when strategy config changes drive frontend portfolio logic updates.'
      }
    ]
  });
}

describe('dependency retrieval', () => {
  beforeEach(setupTmpRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('matches high-recall fuzzy intent queries', () => {
    const result = checkDependencies({
      repoRoot: tmpRoot,
      intent: 'stratgey confg update',
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].id, 'note_strategy-config-frontend-impact');
    assert.ok(result.obligations.some((entry) => entry.title.includes('frontend portfolio logic')));
  });

  it('matches bilingual terms and exact path globs', () => {
    const result = checkDependencies({
      repoRoot: tmpRoot,
      intent: 'strategy config 기반 포트폴리오 로직 업데이트',
      paths: 'config/strategies/ethereum.json'
    });

    assert.equal(result.matches.length, 1);
    assert.ok(result.matches[0].reasons.some((reason) => reason.includes('path match')));
  });

  it('lists and shows dependency notes', () => {
    const listed = listDependencies({ repoRoot: tmpRoot, area: 'SuperearnApp' });
    assert.deepEqual(listed.map((entry) => entry.id), ['note_strategy-config-frontend-impact']);

    const shown = showDependency({ repoRoot: tmpRoot, id: 'note_strategy-config-frontend-impact' });
    assert.equal(shown.id, 'note_strategy-config-frontend-impact');
    assert.ok(shown.related_artifacts.some((entry) => entry.id === 'task_frontend-portfolio-logic-update'));
  });

  it('returns empty results for empty or whitespace-only intent', () => {
    for (const intent of ['', '   ', null, undefined]) {
      const result = checkDependencies({ repoRoot: tmpRoot, intent });
      assert.equal(result.matches.length, 0, `expected no matches for intent=${JSON.stringify(intent)}`);
    }
  });

  it('matches Korean-only intent', () => {
    const result = checkDependencies({
      repoRoot: tmpRoot,
      intent: '포트폴리오 로직 업데이트',
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].id, 'note_strategy-config-frontend-impact');
  });

  it('returns null for showDependency with unknown id', () => {
    const result = showDependency({ repoRoot: tmpRoot, id: 'note_does-not-exist' });
    assert.equal(result, null);
  });

  it('filters listDependencies by repo', () => {
    const matched = listDependencies({ repoRoot: tmpRoot, repo: 'superearn-strategy-admin' });
    assert.equal(matched.length, 1);

    const empty = listDependencies({ repoRoot: tmpRoot, repo: 'nonexistent-repo' });
    assert.equal(empty.length, 0);
  });

  it('filters listDependencies by entity', () => {
    const empty = listDependencies({ repoRoot: tmpRoot, entity: 'Nonexistent' });
    assert.equal(empty.length, 0);
  });

  it('skips malformed records in dependencies index', () => {
    // Inject a malformed record alongside the valid one
    const depPath = resolve(tmpRoot, 'index/dependencies.json');
    const payload = JSON.parse(readFileSync(depPath, 'utf8'));
    payload.dependencies.push(null, { noId: true }, 'garbage', { id: 123, title: 'bad id type' });
    writeJson(depPath, payload);

    const result = checkDependencies({ repoRoot: tmpRoot, intent: 'strategy config update' });
    // Should still find the valid record without throwing
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].id, 'note_strategy-config-frontend-impact');
  });

  it('globToRegex handles **/prefix patterns correctly', () => {
    // Add a **/ glob pattern to the fixture
    const depPath = resolve(tmpRoot, 'index/dependencies.json');
    const payload = JSON.parse(readFileSync(depPath, 'utf8'));
    payload.dependencies[0].contract.triggers.paths.push('**/strategies/*.json');
    writeJson(depPath, payload);

    // Deep path should match via **/strategies/*.json
    const matched = checkDependencies({
      repoRoot: tmpRoot,
      intent: 'update config',
      paths: 'some/deep/path/strategies/ethereum.json',
    });
    assert.equal(matched.matches.length, 1);
    assert.ok(matched.matches[0].reasons.some((r) => r.includes('path match')));

    // Should NOT match a path without the /strategies/ directory boundary
    const noMatch = checkDependencies({
      repoRoot: tmpRoot,
      intent: 'something',
      paths: 'foolstrategies/ethereum.json',
    });
    assert.equal(noMatch.matches.length, 0);
  });
});
