import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { MarkdownTracker } from '../tracker.mjs';

// --- Helpers ---

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
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
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

function makeMarkdown(fields) {
  const fm = {
    id: fields.id,
    type: 'task',
    title: fields.title ?? fields.id,
    created_at: fields.created_at ?? '2026-01-01',
    updated_at: fields.updated_at ?? '2026-01-01',
    status: fields.status ?? 'ready',
    owner: fields.owner ?? 'agent',
    priority: fields.priority ?? 'plan',
    area: fields.area ?? 'TestProject',
    definition_of_done: fields.definition_of_done ?? ['Write tests', 'Deploy']
  };
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push('---', '', `## Context`, `Test task ${fields.id}`, '');
  return lines.join('\n');
}

// --- Setup ---

let tmpRoot;

function setupTmpRepo() {
  tmpRoot = resolve(tmpdir(), `test-tracker-${Date.now()}`);
  mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'content/tasks'), { recursive: true });

  const entries = [
    makeManifestLine({ id: 'task_alpha', priority: 'plan', title: 'Alpha task', path: 'content/tasks/task_alpha.md', owner: 'agent' }),
    makeManifestLine({ id: 'task_beta',  priority: 'do', title: 'Beta task',  path: 'content/tasks/task_beta.md',  owner: 'human' }),
    makeManifestLine({
      id: 'task_gamma', priority: 'do', title: 'Gamma task', path: 'content/tasks/task_gamma.md', owner: 'agent',
      relations_out: [{ type: 'blocked_by', target: 'task_alpha' }],
      links_out: ['task_alpha']
    }),
    makeManifestLine({ id: 'task_done',  priority: 'plan', title: 'Done task',  path: 'content/tasks/task_done.md',  owner: 'agent', status: 'done' })
  ];

  writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), entries.join('\n') + '\n', 'utf8');

  for (const id of ['task_alpha', 'task_beta', 'task_gamma', 'task_done']) {
    const status = id === 'task_done' ? 'done' : 'ready';
    const owner  = id === 'task_beta' ? 'human' : 'agent';
    const priority = (id === 'task_beta' || id === 'task_gamma') ? 'do' : 'plan';
    writeFileSync(
      resolve(tmpRoot, `content/tasks/${id}.md`),
      makeMarkdown({ id, title: `${id} task`, status, owner, priority }),
      'utf8'
    );
  }
}

// --- Tests ---

describe('MarkdownTracker.fetchCandidateIssues()', () => {
  beforeEach(setupTmpRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('returns only agent-owned ready tasks', () => {
    const tracker = new MarkdownTracker({ repoRoot: tmpRoot });
    const candidates = tracker.fetchCandidateIssues();
    assert.ok(candidates.every(c => c.owner === 'agent'), 'all candidates owned by agent');
  });

  it('excludes human-owned tasks (task_beta)', () => {
    const tracker = new MarkdownTracker({ repoRoot: tmpRoot });
    const ids = tracker.fetchCandidateIssues().map(c => c.id);
    assert.ok(!ids.includes('task_beta'), 'task_beta excluded');
  });

  it('excludes tasks blocked by non-terminal tasks (task_gamma blocked by task_alpha)', () => {
    const tracker = new MarkdownTracker({ repoRoot: tmpRoot });
    const ids = tracker.fetchCandidateIssues().map(c => c.id);
    assert.ok(!ids.includes('task_gamma'), 'task_gamma excluded because task_alpha is ready (non-terminal)');
  });

  it('excludes done tasks (task_done)', () => {
    const tracker = new MarkdownTracker({ repoRoot: tmpRoot });
    const ids = tracker.fetchCandidateIssues().map(c => c.id);
    assert.ok(!ids.includes('task_done'), 'task_done excluded');
  });

  it('results sorted by priority (lower number = higher priority)', () => {
    // task_gamma is blocked so won't appear; task_alpha ('plan') is the only agent-owned active
    // Add a 'do'-priority agent-owned unblocked task to verify sort order
    const extraLine = makeManifestLine({ id: 'task_extra', priority: 'do', title: 'Extra task', path: 'content/tasks/task_extra.md', owner: 'agent' });
    const manifestPath = resolve(tmpRoot, 'index/manifest.jsonl');
    const existing = readFileSync(manifestPath, 'utf8');
    writeFileSync(manifestPath, existing + extraLine + '\n', 'utf8');
    writeFileSync(resolve(tmpRoot, 'content/tasks/task_extra.md'), makeMarkdown({ id: 'task_extra', priority: 'do' }), 'utf8');

    const tracker = new MarkdownTracker({ repoRoot: tmpRoot });
    const candidates = tracker.fetchCandidateIssues();
    assert.ok(candidates.length >= 2, 'at least 2 candidates');
    assert.equal(candidates[0].priority, 0, 'first candidate has priority 0 (do)');
    assert.equal(candidates[1].priority, 1, 'second candidate has priority 1 (plan)');
  });

  it('can use an injected manifest when the on-disk index is unavailable or stale', () => {
    const tracker = new MarkdownTracker({
      repoRoot: tmpRoot,
      manifest: [
        {
          id: 'task_live',
          type: 'task',
          status: 'ready',
          owner: 'agent',
          priority: 'do',
          title: 'Live task',
          path: 'content/tasks/task_alpha.md',
          tags: [],
          relations_out: [],
          hashes: { content_hash: 'live' },
          created_at: '2026-01-02',
          updated_at: '2026-01-02',
          project: 'TestProject',
          entities: [],
          links_out: [],
          sources: [],
          feedback: { adopt: 0, reject: 0, warn: 0, score: 0.5 },
          unresolved_entities: [],
          due_date: null,
          iteration: null
        }
      ]
    });

    const candidates = tracker.fetchCandidateIssues();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].id, 'task_live');
  });
});

describe('MarkdownTracker.hydrateIssue()', () => {
  beforeEach(setupTmpRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('returns description and definition_of_done from the markdown file', () => {
    const tracker = new MarkdownTracker({ repoRoot: tmpRoot });
    const candidates = tracker.fetchCandidateIssues();
    const alpha = candidates.find(c => c.id === 'task_alpha');
    assert.ok(alpha, 'task_alpha in candidates');

    const hydrated = tracker.hydrateIssue(alpha);
    assert.ok(typeof hydrated.description === 'string', 'description is a string');
    assert.ok(hydrated.description.length > 0, 'description is non-empty');
    assert.ok(Array.isArray(hydrated.definition_of_done), 'definition_of_done is an array');
    assert.ok(hydrated.definition_of_done.length > 0, 'definition_of_done is non-empty');
  });
});

describe('MarkdownTracker.updateIssueState()', () => {
  beforeEach(setupTmpRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('changes status in the markdown file', () => {
    const tracker = new MarkdownTracker({ repoRoot: tmpRoot });
    tracker.updateIssueState('task_alpha', 'doing');

    const raw = readFileSync(resolve(tmpRoot, 'content/tasks/task_alpha.md'), 'utf8');
    assert.ok(raw.includes('doing'), 'file contains new status');
  });
});

describe('MarkdownTracker.acknowledgeIssue()', () => {
  beforeEach(setupTmpRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('records assignee acknowledgement metadata in frontmatter', () => {
    const tracker = new MarkdownTracker({ repoRoot: tmpRoot });
    const ack = tracker.acknowledgeIssue('task_alpha', {
      by: 'agent',
      note: 'Saw this and queued it for the current iteration'
    });

    assert.equal(ack.by, 'agent');
    assert.ok(typeof ack.at === 'string' && ack.at.includes('T'));
    assert.equal(ack.note, 'Saw this and queued it for the current iteration');

    const raw = readFileSync(resolve(tmpRoot, 'content/tasks/task_alpha.md'), 'utf8');
    assert.ok(raw.includes('x_acknowledged:'), 'frontmatter contains x_acknowledged');
    assert.ok(raw.includes('by: agent'), 'frontmatter contains assignee');
    assert.ok(raw.includes('Saw this and queued it for the current iteration'), 'frontmatter contains note');
  });

  it('rejects acknowledgement by someone other than the task owner', () => {
    const tracker = new MarkdownTracker({ repoRoot: tmpRoot });

    assert.throws(
      () => tracker.acknowledgeIssue('task_alpha', { by: 'human' }),
      /Only the assignee can acknowledge this task/
    );
  });
});

describe('MarkdownTracker.createComment()', () => {
  beforeEach(setupTmpRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('appends comment to Agent Log section in the markdown file', () => {
    const tracker = new MarkdownTracker({ repoRoot: tmpRoot });
    tracker.createComment('task_alpha', 'Test comment content');

    const raw = readFileSync(resolve(tmpRoot, 'content/tasks/task_alpha.md'), 'utf8');
    assert.ok(raw.includes('## Agent Log'), 'Agent Log section present');
    assert.ok(raw.includes('Test comment content'), 'comment text present');
  });
});
