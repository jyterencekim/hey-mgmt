import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkflowLoader } from '../workflow-loader.mjs';

// --- Helpers ---

const WORKFLOW_CONTENT = `---
tracker:
  type: markdown
  activeStates:
    - ready
  dispatchableOwners:
    - agent
---
You are working on {{issue.title}}.

Priority: {{issue.priority}}
`;

let tmpRoot;

function setupTmpRepo() {
  tmpRoot = resolve(tmpdir(), `test-workflow-${Date.now()}`);
  mkdirSync(tmpRoot, { recursive: true });
  writeFileSync(resolve(tmpRoot, 'WORKFLOW.md'), WORKFLOW_CONTENT, 'utf8');
}

// --- Tests ---

describe('WorkflowLoader.load()', () => {
  beforeEach(setupTmpRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('returns config object with tracker settings', () => {
    const loader = new WorkflowLoader(tmpRoot);
    const config = loader.load();
    assert.ok(config && typeof config === 'object', 'config is an object');
    assert.ok(config.tracker, 'config has tracker key');
    assert.equal(config.tracker.type, 'markdown');
    assert.deepEqual(config.tracker.activeStates, ['ready']);
    assert.deepEqual(config.tracker.dispatchableOwners, ['agent']);
  });
});

describe('WorkflowLoader.config getter', () => {
  beforeEach(setupTmpRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('lazy-loads config on first access', () => {
    const loader = new WorkflowLoader(tmpRoot);
    // _config starts null — getter triggers load()
    assert.equal(loader._config, null);
    const config = loader.config;
    assert.ok(config && typeof config === 'object', 'config returned after lazy load');
    assert.equal(config.tracker.type, 'markdown');
  });

  it('returns same object on repeated access (no reload)', () => {
    const loader = new WorkflowLoader(tmpRoot);
    const first = loader.config;
    const second = loader.config;
    assert.equal(first, second, 'same reference returned on repeated access');
  });
});

describe('WorkflowLoader.promptTemplate getter', () => {
  beforeEach(setupTmpRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('returns the markdown body (without frontmatter)', () => {
    const loader = new WorkflowLoader(tmpRoot);
    const template = loader.promptTemplate;
    assert.ok(typeof template === 'string', 'promptTemplate is a string');
    assert.ok(template.includes('{{issue.title}}'), 'template contains issue.title placeholder');
    assert.ok(!template.includes('tracker:'), 'template does not contain frontmatter');
  });
});

describe('WorkflowLoader.renderPrompt()', () => {
  beforeEach(setupTmpRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('interpolates issue data into the template', () => {
    const loader = new WorkflowLoader(tmpRoot);
    const issue = { title: 'Fix the bug', priority: 0 };
    const rendered = loader.renderPrompt(issue);
    assert.ok(rendered.includes('Fix the bug'), 'issue.title interpolated');
    assert.ok(rendered.includes('0'), 'issue.priority interpolated');
    assert.ok(!rendered.includes('{{'), 'no unresolved placeholders remain');
  });

  it('accepts extra vars alongside issue', () => {
    const loader = new WorkflowLoader(tmpRoot);
    writeFileSync(
      resolve(tmpRoot, 'WORKFLOW.md'),
      `---\ntracker:\n  type: markdown\n---\n{{issue.title}} for {{team}}\n`,
      'utf8'
    );
    // Reload with fresh instance
    const loader2 = new WorkflowLoader(tmpRoot);
    const rendered = loader2.renderPrompt({ title: 'Task A' }, { team: 'Alpha' });
    assert.ok(rendered.includes('Task A'), 'issue.title present');
    assert.ok(rendered.includes('Alpha'), 'extra var team present');
  });
});
