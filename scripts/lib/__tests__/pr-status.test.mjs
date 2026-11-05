import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPrCheck, extractPrRefs } from '../pr-status.mjs';

let tmpRoot;

function manifestLine(overrides) {
  const base = {
    id: 'task_x',
    type: 'task',
    title: 'Task X',
    path: 'content/tasks/task_x.md',
    created_at: '2026-05-01',
    updated_at: '2026-05-01',
    area: 'Team',
    status: 'ready',
    priority: 'plan',
    phase: null,
    owner: 'charlie',
    due_date: null,
    iteration: '2026-W19',
    tags: [],
    entities: [],
    relations_out: [],
    links_out: [],
    sources: [],
    hashes: { content_hash: 'hash' },
    feedback: { adopt: 0, reject: 0, warn: 0, score: 0.5 },
    unresolved_entities: [],
  };
  return JSON.stringify({ ...base, ...overrides });
}

describe('extractPrRefs()', () => {
  it('reads both reference forms that name a repository', () => {
    const refs = extractPrRefs(
      'Landed https://github.com/example-org/core-service/pull/158 and kaiachain/core-usdt-miniapp-frontend#400.'
    );
    assert.deepEqual(refs.map((ref) => ref.key), [
      'example-org/core-service#158',
      'kaiachain/core-usdt-miniapp-frontend#400',
    ]);
  });

  it('ignores bare PR numbers, which name no repository', () => {
    // "PR #77" is the most common shape in task bodies. Guessing its repo would
    // produce confident-looking findings against the wrong pull request.
    assert.deepEqual(extractPrRefs('Merged as PR #77, see also #400.'), []);
  });

  it('deduplicates a pull request cited more than once', () => {
    const refs = extractPrRefs(
      'example-org/core-service#158 was reverted, then https://github.com/example-org/core-service/pull/158 relanded.'
    );
    assert.equal(refs.length, 1);
  });

  it('detects prose in the surrounding paragraph claiming the PR is pending', () => {
    // Verbatim shape from task_rename-usd-named-fields-that-c, which sat open
    // for eleven days after its PR merged because nobody re-read this sentence.
    const [ref] = extractPrRefs(
      '**Open.** `kaiachain/core-usdt-miniapp-frontend#400` -> `develop`.\nPartner-org repo, so a human reviews and lands it.'
    );
    assert.equal(ref.claims_pending, true);
  });

  it('does not treat a plain landed statement as pending', () => {
    const [ref] = extractPrRefs('Landed and live: example-org/core-data-pipeline#77, deploy green.');
    assert.equal(ref.claims_pending, false);
  });
});

describe('buildPrCheck()', () => {
  const bodies = {
    'content/tasks/task_all_merged.md': 'Shipped in example-org/core-data-pipeline#77 and kaiachain/core-usdt-miniapp-frontend#400.',
    'content/tasks/task_one_open.md': 'Opened example-org/core-ops-runtime#221; still in review.',
    'content/tasks/task_unreadable.md': 'Tracked in example-org/ghost-repo#1.',
    'content/tasks/task_no_refs.md': 'No pull request has been opened yet.',
    'content/tasks/task_stale_text.md': '**Open.** `kaiachain/core-usdt-miniapp-frontend#400` awaits a human reviewer in the partner org.',
  };

  const fetcher = async (ref) => {
    if (ref.key === 'example-org/core-data-pipeline#77') return { state: 'MERGED', mergedAt: '2026-07-28T00:00:00Z' };
    if (ref.key === 'kaiachain/core-usdt-miniapp-frontend#400') return { state: 'MERGED', mergedAt: '2026-07-29T04:27:01Z' };
    if (ref.key === 'example-org/core-ops-runtime#221') return { state: 'OPEN', mergedAt: null };
    throw new Error('could not resolve to a PullRequest');
  };

  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-prcheck-${Date.now()}`);
    mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });
    mkdirSync(resolve(tmpRoot, 'content/tasks'), { recursive: true });
    for (const [path, body] of Object.entries(bodies)) {
      writeFileSync(resolve(tmpRoot, path), body, 'utf8');
    }
    const manifest = [
      manifestLine({ id: 'task_all_merged', title: 'All merged', path: 'content/tasks/task_all_merged.md', status: 'doing' }),
      manifestLine({ id: 'task_one_open', title: 'One still open', path: 'content/tasks/task_one_open.md' }),
      manifestLine({ id: 'task_unreadable', title: 'Unreadable ref', path: 'content/tasks/task_unreadable.md' }),
      manifestLine({ id: 'task_no_refs', title: 'No refs', path: 'content/tasks/task_no_refs.md' }),
      manifestLine({ id: 'task_closed', title: 'Already closed', path: 'content/tasks/task_all_merged.md', status: 'done' }),
      manifestLine({ id: 'task_stale_text', title: 'Stale text', path: 'content/tasks/task_stale_text.md', status: 'doing' }),
    ];
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), `${manifest.join('\n')}\n`, 'utf8');
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('reports all-merged as the weaker tier, not as a completion claim', async () => {
    // Most tasks cite the PRs that built them, so this tier fires on healthy
    // in-progress work too. It is a hint to look, never a verdict.
    const report = await buildPrCheck(tmpRoot, { fetcher });
    assert.deepEqual(report.all_merged.map((f) => f.id), ['task_all_merged']);
    assert.equal(report.all_merged[0].prs.length, 2);
    assert.ok(!report.contradictions.some((f) => f.id === 'task_all_merged'));
  });

  it('does not flag a task that still has an open pull request', async () => {
    // Flagging in-progress work would make the report noise, and a noisy report
    // stops being read.
    const report = await buildPrCheck(tmpRoot, { fetcher });
    assert.ok(![...report.contradictions, ...report.all_merged].some((f) => f.id === 'task_one_open'));
  });

  it('does not flag a task when a reference could not be read', async () => {
    // An unreadable reference is absence of evidence. Treating it as merged
    // would tell a member their work is done on the strength of a failed call.
    const report = await buildPrCheck(tmpRoot, { fetcher });
    assert.ok(![...report.contradictions, ...report.all_merged].some((f) => f.id === 'task_unreadable'));
    assert.equal(report.unresolved, 1);
  });

  it('leaves already-closed tasks out of scope', async () => {
    const report = await buildPrCheck(tmpRoot, { fetcher });
    assert.ok(![...report.contradictions, ...report.all_merged].some((f) => f.id === 'task_closed'));
  });

  it('separates stale body text into its own tier, ahead of all-merged', async () => {
    // The high-precision signal: the file asserts the PR has not landed and it
    // has. That is a contradiction someone must resolve, not a hint.
    const report = await buildPrCheck(tmpRoot, { fetcher });
    assert.deepEqual(report.contradictions.map((f) => f.id), ['task_stale_text']);
    assert.equal(report.contradictions[0].prs[0].claims_pending, true);
    assert.ok(!report.all_merged.some((f) => f.id === 'task_stale_text'));
  });

  it('never mutates a task file', async () => {
    // The check reports; a human closes. A merged PR is evidence the work
    // landed, not proof the definition of done is met.
    await buildPrCheck(tmpRoot, { fetcher });
    const { readFileSync } = await import('node:fs');
    assert.equal(
      readFileSync(resolve(tmpRoot, 'content/tasks/task_all_merged.md'), 'utf8'),
      bodies['content/tasks/task_all_merged.md']
    );
  });
});
