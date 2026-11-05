import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildIndexes, validateRepository } from '../indexer.mjs';
import {
  evaluateProductInitiatives,
  kickoffInitiative,
  sendProductGapAlerts,
} from '../product-initiative.mjs';

const TODAY = '2026-11-10';

function entry(overrides) {
  return {
    type: 'task',
    title: overrides.id,
    status: 'ready',
    owner: 'jared',
    created_at: '2026-11-01',
    relations_out: [],
    components: [],
    baseline_tasks: [],
    ...overrides,
  };
}

function productInitiative(overrides = {}) {
  return entry({
    id: 'initiative_p',
    type: 'initiative',
    status: 'active',
    initiative_kind: 'product',
    timeline_start: '2026-11-01',
    timeline_end: '2026-12-15',
    prd_doc: 'https://docs.example/prd',
    components: ['api', 'ui'],
    kickoff_date: '2026-11-03',
    baseline_tasks: ['task_a', 'task_b'],
    relations_out: [{ type: 'parent_of', target: 'task_a' }],
    ...overrides,
  });
}

const datedTask = (id, extra = {}) => entry({
  id,
  component: 'api',
  start_date: '2026-11-03',
  target_date: '2026-11-20',
  ...extra,
});

describe('evaluateProductInitiatives', () => {
  it('reports no gaps for a complete product initiative', () => {
    const report = evaluateProductInitiatives([
      productInitiative(),
      datedTask('task_a'),
      datedTask('task_b', { component: 'ui', relations_out: [{ type: 'child_of', target: 'initiative_p' }] }),
    ], { today: TODAY });

    assert.equal(report.products.length, 1);
    const [product] = report.products;
    assert.equal(product.red_flag_count, 0);
    assert.deepEqual(product.scope, { added: [], removed: [] });
    assert.deepEqual(product.components.map((group) => [group.component, group.total]), [['api', 1], ['ui', 1]]);
  });

  it('flags missing kickoff fields and task dates, components and slips', () => {
    const report = evaluateProductInitiatives([
      productInitiative({ prd_doc: null, components: ['api'], relations_out: [{ type: 'parent_of', target: 'task_a' }, { type: 'parent_of', target: 'task_b' }, { type: 'parent_of', target: 'task_c' }] }),
      datedTask('task_a', { target_date: '2026-11-05' }),
      entry({ id: 'task_b' }),
      datedTask('task_c', { component: 'billing' }),
    ], { today: TODAY });

    const [product] = report.products;
    assert.deepEqual(product.missing_kickoff.map((gap) => gap.field), ['x_prd_doc']);
    const byTask = Object.fromEntries(product.task_gaps.map((task) => [task.id, task.gaps.map((gap) => gap.field)]));
    assert.deepEqual(byTask.task_a, ['x_target_date']);
    assert.deepEqual(byTask.task_b, ['x_component', 'x_start_date', 'x_target_date']);
    assert.deepEqual(byTask.task_c, ['x_component']);
    assert.ok(product.task_gaps.find((task) => task.id === 'task_a').gaps[0].slipped);
  });

  it('shows tasks added after kickoff and baseline tasks dropped or unlinked', () => {
    const report = evaluateProductInitiatives([
      productInitiative({
        baseline_tasks: ['task_a', 'task_b', 'task_gone'],
        relations_out: [{ type: 'parent_of', target: 'task_a' }, { type: 'parent_of', target: 'task_new' }],
      }),
      datedTask('task_a', { status: 'archived' }),
      datedTask('task_b'),
      datedTask('task_new'),
    ], { today: TODAY });

    const { scope } = report.products[0];
    assert.deepEqual(scope.added.map((task) => task.id), ['task_new']);
    assert.deepEqual(scope.removed.map((task) => [task.id, task.reason]), [
      ['task_a', 'archived'],
      ['task_b', 'unlinked from the initiative'],
      ['task_gone', 'missing from the ledger'],
    ]);
  });

  it('does not count tasks archived before kickoff as added', () => {
    const report = evaluateProductInitiatives([
      productInitiative({
        baseline_tasks: ['task_a'],
        relations_out: [{ type: 'parent_of', target: 'task_a' }, { type: 'parent_of', target: 'task_old' }, { type: 'parent_of', target: 'task_late' }],
      }),
      datedTask('task_a'),
      datedTask('task_old', { status: 'archived', created_at: '2026-10-01' }),
      datedTask('task_late', { status: 'archived', created_at: '2026-11-05' }),
    ], { today: TODAY });

    assert.deepEqual(report.products[0].scope.added.map((task) => task.id), ['task_late']);
  });

  it('ignores non-product and pre-kickoff initiatives but lists unclassified active ones', () => {
    const report = evaluateProductInitiatives([
      productInitiative({ id: 'initiative_plan', status: 'plan' }),
      entry({ id: 'initiative_biz', type: 'initiative', status: 'active', initiative_kind: 'business' }),
      entry({ id: 'initiative_none', type: 'initiative', status: 'active' }),
    ], { today: TODAY });

    assert.equal(report.products.length, 0);
    assert.deepEqual(report.unclassified.map((item) => item.id), ['initiative_none']);
  });
});

// ── File-backed: validator, kickoff, alerts ──────────────────────────────────

let tmpRoot;

function writeMd(relPath, frontmatter, body = '## Context\nTest.\n') {
  const path = resolve(tmpRoot, relPath);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `---\n${frontmatter.trim()}\n---\n\n${body}`, 'utf8');
}

function initiativeFile(extra = '') {
  writeMd('content/initiatives/2026/11/initiative_p.md', `
id: initiative_p
type: initiative
title: Product P
created_at: 2026-11-04
updated_at: 2026-11-04
owner: jared
status: plan
x_initiative_kind: product
x_timeline_start: 2026-11-04
x_timeline_end: 2026-12-15
x_prd_doc: https://docs.example/prd
x_components:
  - api
definition_of_done:
  - Baseline tasks done
${extra}`);
}

function taskFile(id, extra = '') {
  writeMd(`content/tasks/2026/11/${id}.md`, `
id: ${id}
type: task
title: Task ${id}
created_at: 2026-11-04
updated_at: 2026-11-04
owner: jared
status: ready
iteration: 2026-W45
definition_of_done:
  - done
relations:
  - type: child_of
    target: initiative_p
${extra}`);
}

describe('product initiative files', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-product-initiative-${process.pid}-${Date.now()}`);
    mkdirSync(resolve(tmpRoot, 'content', 'vocab'), { recursive: true });
    mkdirSync(resolve(tmpRoot, 'workspace', 'jared'), { recursive: true });
    writeFileSync(resolve(tmpRoot, 'content', 'vocab', 'members.yml'), 'members:\n  - name: jared\n  - name: fisher\n', 'utf8');
  });
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('kickoff freezes the baseline and activates; validator then passes', () => {
    initiativeFile();
    taskFile('task_a', 'x_component: api\nx_start_date: 2026-11-04\nx_target_date: 2026-11-20');
    buildIndexes(tmpRoot);

    const result = kickoffInitiative(tmpRoot, 'initiative_p', { date: '2026-10-01' });
    assert.deepEqual(result.baseline_tasks, ['task_a']);
    assert.equal(result.status, 'active');
    const written = readFileSync(resolve(tmpRoot, 'content/initiatives/2026/11/initiative_p.md'), 'utf8');
    assert.match(written, /x_kickoff_date: '?2026-10-01'?/);
    assert.match(written, /x_baseline_tasks:\n\s+- task_a/);
    // A back-dated kickoff must not move updated_at into the past.
    assert.doesNotMatch(written, /updated_at: '?2026-10-01'?/);

    const issues = validateRepository(tmpRoot).report.issues.filter((issue) => issue.level === 'error');
    assert.deepEqual(issues, []);
  });

  it('validator errors on a new active product initiative without its kickoff contract', () => {
    initiativeFile();
    const path = resolve(tmpRoot, 'content/initiatives/2026/11/initiative_p.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace('status: plan', 'status: active'), 'utf8');
    taskFile('task_a');

    const errors = validateRepository(tmpRoot).report.issues.filter((issue) => issue.level === 'error');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /x_kickoff_date, x_baseline_tasks/);
  });

  it('kickoff refuses when the PRD link is missing', () => {
    initiativeFile();
    const path = resolve(tmpRoot, 'content/initiatives/2026/11/initiative_p.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/x_prd_doc: .*\n/, ''), 'utf8');
    taskFile('task_a');
    buildIndexes(tmpRoot);

    assert.throws(() => kickoffInitiative(tmpRoot, 'initiative_p'), /missing x_prd_doc/);
  });

  it('alerts the owner once per gap set within the resend window', () => {
    initiativeFile('x_kickoff_date: 2026-11-04\nx_baseline_tasks:\n  - task_a');
    const path = resolve(tmpRoot, 'content/initiatives/2026/11/initiative_p.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace('status: plan', 'status: active'), 'utf8');
    taskFile('task_a');
    buildIndexes(tmpRoot);

    // Dedupe compares the real send timestamp against `today`, so anchor on now.
    const now = new Date().toISOString().slice(0, 10);
    const eightDaysLater = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
    const first = sendProductGapAlerts(tmpRoot, { today: now });
    assert.equal(first.results[0].action, 'sent');
    const second = sendProductGapAlerts(tmpRoot, { today: now });
    assert.equal(second.results[0].action, 'skipped');
    const later = sendProductGapAlerts(tmpRoot, { today: eightDaysLater, dryRun: true });
    assert.equal(later.results[0].action, 'would_send');
  });

  it('reminds only new gaps when the gap set changes within the week', () => {
    initiativeFile('x_kickoff_date: 2026-11-04\nx_baseline_tasks:\n  - task_a');
    const path = resolve(tmpRoot, 'content/initiatives/2026/11/initiative_p.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace('status: plan', 'status: active'), 'utf8');
    taskFile('task_a', 'x_component: api');
    buildIndexes(tmpRoot);
    const now = new Date().toISOString().slice(0, 10);
    const first = sendProductGapAlerts(tmpRoot, { today: now });
    assert.equal(first.results[0].gaps, 2);

    // Owner fixes nothing, a new task without dates appears: only its gaps go out.
    taskFile('task_b');
    buildIndexes(tmpRoot);
    const second = sendProductGapAlerts(tmpRoot, { today: now });
    assert.equal(second.results[0].action, 'sent');
    assert.equal(second.results[0].gaps, 3);
    const items = JSON.parse(JSON.stringify(readFileSync(resolve(tmpRoot, 'workspace/jared/inbox/open', `${second.results[0].inbox_id}.json`), 'utf8')));
    assert.match(items, /task_b/);
    assert.doesNotMatch(items, /task_a`/);
  });
});
