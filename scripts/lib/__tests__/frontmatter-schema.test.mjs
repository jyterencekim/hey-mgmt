import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateArtifacts } from '../validate.mjs';

function makeArtifact(frontmatter) {
  return {
    id: frontmatter.id,
    type: frontmatter.type,
    title: frontmatter.title,
    relativePath: `${frontmatter.id}.md`,
    frontmatter,
    relationsOut: [],
    linksOut: [],
    body: 'body text long enough to count as non-thin content',
    hashes: { content_hash: 'hash' }
  };
}

const vocab = {
  tags: { tags: ['Ops', 'PM', 'ChangeImpact'] },
  entities: {
    entities: [
      { canonical: 'TeamOS', aliases: [], type: 'project' },
      { canonical: 'Keeper', aliases: ['keeper bot'], type: 'module' }
    ]
  },
  members: { members: [{ name: 'alice' }, { name: 'team' }] },
  areas: { areas: [{ name: 'TeamOSCore' }] },
  repos: { repos: [{ name: 'hey-mgmt', remote: 'https://github.com/example-org/hey-mgmt' }] }
};

describe('validateArtifacts()', () => {
  it('rejects alias fields that break the canonical schema', () => {
    const artifact = makeArtifact({
      id: 'task_due-field-test',
      type: 'task',
      title: 'Due Field Test',
      created_at: '2026-03-06',
      updated_at: '2026-03-06',
      status: 'ready',
      owner: 'alice',
      area: 'TeamOSCore',
      priority: 'plan',
      due: '2026-03-15',
      iteration: '2026-W10',
      definition_of_done: ['Ship']
    });

    const report = validateArtifacts([artifact], {}, vocab);
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.message.includes("field 'due' is not supported")));
  });

  it('allows namespaced extension fields without breaking validation', () => {
    const artifact = makeArtifact({
      id: 'task_extension-test',
      type: 'task',
      title: 'Extension Test',
      created_at: '2026-03-06',
      updated_at: '2026-03-06',
      status: 'ready',
      owner: 'alice',
      area: 'TeamOSCore',
      priority: 'plan',
      iteration: '2026-W10',
      definition_of_done: ['Ship'],
      x_runtime_hint: 'orchestration-only'
    });

    const report = validateArtifacts([artifact], {}, vocab);
    assert.equal(report.ok, true);
  });

  it('accepts a watchers array of member names', () => {
    const artifact = makeArtifact({
      id: 'task_watchers-ok',
      type: 'task',
      title: 'Watchers OK',
      created_at: '2026-03-06',
      updated_at: '2026-03-06',
      status: 'ready',
      owner: 'alice',
      watchers: ['team'],
      area: 'TeamOSCore',
      priority: 'plan',
      iteration: '2026-W10',
      definition_of_done: ['Ship']
    });

    const report = validateArtifacts([artifact], {}, vocab);
    assert.equal(report.ok, true);
  });

  it('rejects a watchers field that is not a string array', () => {
    const artifact = makeArtifact({
      id: 'task_watchers-bad',
      type: 'task',
      title: 'Watchers Bad',
      created_at: '2026-03-06',
      updated_at: '2026-03-06',
      status: 'ready',
      owner: 'alice',
      watchers: 'team',
      area: 'TeamOSCore',
      priority: 'plan',
      iteration: '2026-W10',
      definition_of_done: ['Ship']
    });

    const report = validateArtifacts([artifact], {}, vocab);
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.message.includes('watchers must be an array')));
  });

  it('warns (but does not fail) on a watcher not in the members registry', () => {
    const artifact = makeArtifact({
      id: 'task_watchers-unknown',
      type: 'task',
      title: 'Watchers Unknown',
      created_at: '2026-03-06',
      updated_at: '2026-03-06',
      status: 'ready',
      owner: 'alice',
      watchers: ['ghost'],
      area: 'TeamOSCore',
      priority: 'plan',
      iteration: '2026-W10',
      definition_of_done: ['Ship']
    });

    const report = validateArtifacts([artifact], {}, vocab);
    assert.equal(report.ok, true);
    assert.ok(report.issues.some((issue) => issue.message.includes("watchers entry 'ghost' not in members registry")));
  });

  it('requires iteration for ready/blocked/doing execution tasks', () => {
    const artifact = makeArtifact({
      id: 'task_missing-iteration',
      type: 'task',
      title: 'Missing Iteration',
      created_at: '2026-03-06',
      updated_at: '2026-03-06',
      status: 'ready',
      owner: 'alice',
      area: 'TeamOSCore',
      priority: 'plan',
      definition_of_done: ['Ship']
    });

    const report = validateArtifacts([artifact], {}, vocab);
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.message.includes('must declare iteration')));
  });

  it('rejects task with retired status names (active, in_progress)', () => {
    const artifact = makeArtifact({
      id: 'task_old-status',
      type: 'task',
      title: 'Old Status',
      created_at: '2026-03-06',
      updated_at: '2026-03-06',
      status: 'active',
      owner: 'alice',
      area: 'TeamOSCore',
      priority: 'plan',
      iteration: '2026-W10',
      definition_of_done: ['Ship']
    });
    const report = validateArtifacts([artifact], {}, vocab);
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.message.includes('status must be one of')));
  });

  it('accepts non-task artifacts with status: active (artifact lifecycle)', () => {
    const artifact = makeArtifact({
      id: 'note_in-force',
      type: 'note',
      title: 'In-force note',
      created_at: '2026-03-06',
      updated_at: '2026-03-06',
      status: 'active',
      owner: 'alice',
      area: 'TeamOSCore'
    });
    const report = validateArtifacts([artifact], {}, vocab);
    assert.equal(report.ok, true);
  });

  it('rejects malformed dependency notes', () => {
    const artifact = makeArtifact({
      id: 'note_dependency-surface',
      type: 'note',
      title: 'Dependency surface',
      created_at: '2026-03-06',
      updated_at: '2026-03-06',
      status: 'active',
      owner: 'alice',
      area: 'TeamOSCore',
      tags: ['ChangeImpact'],
      x_change_contract: {
        triggers: {
          repos: ['unknown-repo'],
          terms: []
        },
        obligations: []
      },
      sources: [],
      relations: []
    });

    artifact.relativePath = 'notes/dependencies/note_dependency-surface.md';
    const report = validateArtifacts([artifact], {}, vocab);
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.message.includes('requires at least one source')));
    assert.ok(report.issues.some((issue) => issue.message.includes('obligations[]')));
    assert.ok(report.issues.some((issue) => issue.message.includes('unknown-repo')));
    // terms[] is an optional precision booster (decision_adr-kb-wide-change-contracts):
    // recall comes from qmd + title/body matching, so empty terms alone is NOT an error.
    assert.ok(!report.issues.some((issue) => issue.message.includes('terms[]')));
  });

  it('warns when a contract carrier lacks the ChangeImpact opt-in tag', () => {
    // Without the tag the contract never enters the deps pool — that silent
    // dead-weight class (bit note_kaia-miniapp-service-version-r for 3 months)
    // must be surfaced, not left to rot.
    const artifact = makeArtifact({
      id: 'decision_untagged-contract',
      type: 'decision',
      title: 'Untagged contract carrier',
      created_at: '2026-08-10',
      updated_at: '2026-08-10',
      status: 'active',
      owner: 'alice',
      area: 'TeamOSCore',
      decision_status: 'accepted',
      tags: ['Ops'],
      x_change_contract: {
        triggers: { repos: ['hey-mgmt'] },
        obligations: [{ title: 'Follow up', severity: 'required', actions: ['Do the follow-up.'] }]
      }
    });

    const report = validateArtifacts([artifact], {}, vocab);
    const warning = report.issues.find((issue) => issue.message.includes('will not enter the deps check pool'));
    assert.ok(warning, 'expected the dead-weight contract warning');
    assert.equal(warning.level, 'warning');
  });
});
