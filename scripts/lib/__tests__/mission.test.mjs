import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { compileMissionBrief, renderMissionMarkdown } from '../mission.mjs';

let tmpRoot;

function writeTask() {
  const taskPath = resolve(tmpRoot, 'content/tasks/2026/05/task_test.md');
  mkdirSync(resolve(tmpRoot, 'content/tasks/2026/05'), { recursive: true });
  writeFileSync(taskPath, [
    '---',
    'id: task_test',
    'type: task',
    'title: Test mission compile',
    'created_at: 2026-05-07',
    'updated_at: 2026-05-07',
    'status: ready',
    'owner: terence',
    'area: Team',
    'priority: plan',
    'definition_of_done:',
    '  - Compile context',
    'relations:',
    '  - type: links_to',
    '    target: initiative_harness-v1-execution-harness',
    '---',
    '',
    '## Context',
    'Use ./hey to compile a mission.',
    '',
  ].join('\n'), 'utf8');
}

describe('compileMissionBrief()', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-mission-${Date.now()}`);
    mkdirSync(resolve(tmpRoot, 'index'), { recursive: true });
    mkdirSync(resolve(tmpRoot, 'workspace/terence'), { recursive: true });
    writeTask();
    writeFileSync(resolve(tmpRoot, 'workspace/terence/profile.md'), '# Terence\n\n## Repos\n\n- hey-mgmt\n', 'utf8');
    const manifest = {
      id: 'task_test',
      type: 'task',
      title: 'Test mission compile',
      path: 'content/tasks/2026/05/task_test.md',
      created_at: '2026-05-07',
      updated_at: '2026-05-07',
      area: 'Team',
      status: 'ready',
      priority: 'plan',
      phase: null,
      owner: 'terence',
      due_date: null,
      iteration: null,
      tags: [],
      entities: [],
      relations_out: [{ type: 'links_to', target: 'initiative_harness-v1-execution-harness' }],
      links_out: ['initiative_harness-v1-execution-harness'],
      sources: [],
      hashes: { content_hash: 'hash' },
      feedback: { adopt: 0, reject: 0, warn: 0, score: 0.5 },
      unresolved_entities: [],
    };
    writeFileSync(resolve(tmpRoot, 'index/manifest.jsonl'), `${JSON.stringify(manifest)}\n`, 'utf8');
    writeFileSync(resolve(tmpRoot, 'index/dependencies.json'), '{"generated_at":null,"dependencies":[]}\n', 'utf8');
    writeFileSync(resolve(tmpRoot, 'index/backlinks.json'), '{}\n', 'utf8');
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('compiles task context into a mission brief', () => {
    const mission = compileMissionBrief(tmpRoot, { taskId: 'task_test' });
    assert.equal(mission.task.id, 'task_test');
    assert.ok(mission.derived.runtime_targets.repos.includes('hey-mgmt'));
    assert.ok(mission.derived.evidence_checklist.includes('./hey validate result for hey-mgmt artifact changes'));
    assert.equal(mission.related_artifacts[0].id, 'initiative_harness-v1-execution-harness');

    const markdown = renderMissionMarkdown(mission);
    assert.match(markdown, /Mission Brief/);
    assert.match(markdown, /Evidence Checklist/);
  });
});
