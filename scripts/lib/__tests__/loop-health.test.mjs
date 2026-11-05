import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ITERATION_CAP,
  buildBacklogHealth,
  checkDigestHeartbeat,
  formatHealthBanner,
  hasDigestMarker,
  lastDigestDate,
} from '../loop-health.mjs';
import { DIGEST_END, DIGEST_START } from '../loop-digest.mjs';

let root;

function setup(members = 'members:\n  - name: terence\n    role: engineer\n    x_ceremony_cron: true\n') {
  root = resolve(tmpdir(), `test-health-${Date.now()}-${process.hrtime()[1]}`);
  mkdirSync(resolve(root, 'index'), { recursive: true });
  mkdirSync(resolve(root, 'content/vocab'), { recursive: true });
  mkdirSync(resolve(root, 'workspace/terence/logs'), { recursive: true });
  writeFileSync(resolve(root, 'content/vocab/members.yml'), members, 'utf8');
  writeFileSync(resolve(root, 'index/manifest.jsonl'), '', 'utf8');
  return root;
}

function log(date, body) {
  writeFileSync(resolve(root, 'workspace/terence/logs', `${date}.md`), body, 'utf8');
}

function task(overrides) {
  return `${JSON.stringify({
    id: 'task_x', type: 'task', title: 'T', path: 'content/tasks/task_x.md',
    created_at: '2026-08-01', updated_at: '2026-08-01', area: 'Team',
    status: 'ready', priority: 'plan', owner: 'terence', due_date: null,
    iteration: '2026-W34', tags: [], entities: [], relations_out: [],
    links_out: [], sources: [], hashes: { content_hash: 'h' },
    feedback: { adopt: 0, reject: 0, warn: 0, score: 0.5 }, unresolved_entities: [],
    ...overrides,
  })}`;
}

afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('hasDigestMarker()', () => {
  it('accepts the marker only as a whole line', () => {
    assert.equal(hasDigestMarker(`# 2026-08-19\n${DIGEST_START}\nbody\n${DIGEST_END}\n`), true);
    assert.equal(hasDigestMarker(`  ${DIGEST_START}  \n`), true);
  });

  it('rejects prose that merely mentions the marker', () => {
    // The bug this pins: a log entry documenting the mechanism inline, e.g.
    // "writes between `<!-- fisher:digest:start -->` and …", satisfied a
    // substring search. A heartbeat that can be satisfied by *writing about
    // itself* reports healthy while the cron is dead — strictly worse than no
    // heartbeat, because it silences the real signal.
    const prose = `- 18:30 — writes between \`${DIGEST_START}\` and \`${DIGEST_END}\` under a heading.\n`;
    assert.equal(hasDigestMarker(prose), false);
  });
});

describe('checkDigestHeartbeat()', () => {
  beforeEach(() => setup());

  it('treats yesterday as current, so a check before the 08:30 run is not a false alarm', () => {
    log('2026-08-18', `# 2026-08-18\n${DIGEST_START}\nx\n${DIGEST_END}\n`);
    assert.deepEqual(checkDigestHeartbeat(root, { today: '2026-08-19' }).stale, []);
  });

  it('flags a gap older than the one-day budget', () => {
    log('2026-08-16', `# 2026-08-16\n${DIGEST_START}\nx\n${DIGEST_END}\n`);
    const { stale } = checkDigestHeartbeat(root, { today: '2026-08-19' });
    assert.equal(stale.length, 1);
    assert.equal(stale[0].member, 'terence');
    assert.equal(stale[0].days_stale, 3);
  });

  it('flags a member whose logs exist but never carried a digest', () => {
    // Exactly today's real state: logs written by hand every day, no cron
    // output. "Logs exist" must not be mistaken for "the pass ran".
    log('2026-08-19', '# 2026-08-19\n\n## Log\n- 09:00 — hand-written\n');
    const { stale } = checkDigestHeartbeat(root, { today: '2026-08-19' });
    assert.equal(stale.length, 1);
    assert.equal(stale[0].last_digest, null);
  });

  it('stays silent for members who never opted in', () => {
    setup('members:\n  - name: terence\n    role: engineer\n');
    assert.deepEqual(checkDigestHeartbeat(root, { today: '2026-08-19' }).stale, []);
  });

  it('finds the newest digest-bearing log, not merely the newest log', () => {
    log('2026-08-18', `# 2026-08-18\n${DIGEST_START}\nx\n${DIGEST_END}\n`);
    log('2026-08-19', '# 2026-08-19\nhand-written only\n');
    assert.equal(lastDigestDate(root, 'terence'), '2026-08-18');
  });
});

describe('buildBacklogHealth()', () => {
  beforeEach(() => setup());

  it('measures commitment against the cap, not the count of undated tasks', () => {
    // The retired metric counted no-due-date tasks, which the accepted ADR
    // defines as the NORMAL backlog state — it moved when dates were stripped
    // and said nothing about health. Commitment vs cap measures the layer that
    // now carries the work.
    const rows = [];
    for (let i = 0; i < 12; i += 1) rows.push(task({ id: `task_c${i}`, iteration: '2026-W34' }));
    for (let i = 0; i < 5; i += 1) rows.push(task({ id: `task_b${i}`, iteration: null }));
    writeFileSync(resolve(root, 'index/manifest.jsonl'), `${rows.join('\n')}\n`, 'utf8');

    const health = buildBacklogHealth(root, { iteration: '2026-W34' });
    const terence = health.rows.find((row) => row.member === 'terence');
    assert.equal(terence.committed, 12);
    assert.equal(terence.cap, ITERATION_CAP);
    assert.equal(terence.over_cap, 2);
    assert.equal(terence.within_cap, false);
    assert.equal(terence.backlog, 5, 'undated tasks are backlog, which is healthy, not debt');
  });

  it('excludes terminal tasks so closing work improves the number', () => {
    const rows = [
      task({ id: 'task_open', iteration: '2026-W34' }),
      task({ id: 'task_done', iteration: '2026-W34', status: 'done' }),
      task({ id: 'task_arch', iteration: '2026-W34', status: 'archived' }),
    ];
    writeFileSync(resolve(root, 'index/manifest.jsonl'), `${rows.join('\n')}\n`, 'utf8');
    const health = buildBacklogHealth(root, { iteration: '2026-W34' });
    assert.equal(health.rows.find((row) => row.member === 'terence').committed, 1);
  });

  it('reports planned coverage as a diagnostic that cannot fail the check', () => {
    // x_planned_date is an optional override. If zero coverage produced a
    // failure we would have rebuilt the pressure the ADR removed.
    writeFileSync(resolve(root, 'index/manifest.jsonl'), `${task({ iteration: '2026-W34' })}\n`, 'utf8');
    const health = buildBacklogHealth(root, { iteration: '2026-W34' });
    const terence = health.rows.find((row) => row.member === 'terence');
    assert.equal(terence.planned_coverage, 0);
    assert.equal(terence.within_cap, true);
    assert.equal(formatHealthBanner({ heartbeat: { stale: [] }, health }), null);
  });
});

describe('formatHealthBanner()', () => {
  it('returns null when there is nothing to say, so it never adds noise', () => {
    assert.equal(
      formatHealthBanner({ heartbeat: { stale: [] }, health: { iteration: '2026-W34', cap: 10, rows: [] } }),
      null,
    );
  });

  it('names a stall as the automation stopping rather than a skipped day', () => {
    const banner = formatHealthBanner({
      heartbeat: { stale: [{ member: 'terence', last_digest: '2026-08-16', days_stale: 3 }] },
      health: { iteration: '2026-W34', cap: 10, rows: [] },
    });
    assert.match(banner, /NO SCHEDULED PASS ON RECORD/);
    assert.match(banner, /automation not reporting/);
    // It must not assert a diagnosis it cannot verify from the repo.
    assert.equal(/cron is (down|not landing)/.test(banner), false);
  });
});
