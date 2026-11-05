import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDependencyRecord, buildEntityRegistry, buildRepoRegistry, isDependencyArtifact } from '../dependency-utils.mjs';

const CONTRACT = {
  triggers: {
    repos: [],
    paths: ['config/strategies/*.json'],
    areas: [],
    entities: [],
    intents: [],
    terms: []
  },
  obligations: [
    {
      title: 'Sync frontend portfolio logic',
      severity: 'required',
      actions: ['Reflect the changed strategy-config assumptions in frontend portfolio logic.']
    }
  ],
  verification: ['Ethereum portfolio flow renders correctly.']
};

function makeArtifact(overrides = {}) {
  return {
    id: 'decision_example-change-contract',
    type: 'decision',
    title: 'Example decision carrying a change contract',
    body: 'Changing the strategy config requires a frontend portfolio follow-up.',
    relativePath: 'decisions/decision_example-change-contract.md',
    relationsOut: [],
    linksOut: [],
    frontmatter: {
      status: 'active',
      tags: ['ChangeImpact'],
      x_change_contract: CONTRACT,
      ...overrides.frontmatter
    },
    ...overrides
  };
}

describe('KB-wide dependency pool membership', () => {
  // The pool is opt-in by tag + contract anywhere in content/ — NOT by living
  // under notes/dependencies/. This is what lets existing decisions/playbooks
  // carry obligations without a parallel hand-maintained note.
  it('accepts a contract-bearing artifact outside notes/dependencies/', () => {
    assert.equal(isDependencyArtifact(makeArtifact()), true);
  });

  it('rejects workspace artifacts — contracts are team-level knowledge', () => {
    assert.equal(isDependencyArtifact(makeArtifact({ _workspaceMember: 'charlie' })), false);
  });

  // A done/archived/cancelled artifact's obligations are historical record,
  // not binding checks on new work.
  it('rejects terminal-status artifacts', () => {
    for (const status of ['done', 'archived', 'cancelled']) {
      const artifact = makeArtifact({ frontmatter: { status, tags: ['ChangeImpact'], x_change_contract: CONTRACT } });
      assert.equal(isDependencyArtifact(artifact), false, `status=${status} must not bind`);
    }
  });

  it('rejects artifacts without the ChangeImpact opt-in tag', () => {
    const artifact = makeArtifact({ frontmatter: { status: 'active', tags: [], x_change_contract: CONTRACT } });
    assert.equal(isDependencyArtifact(artifact), false);
  });
});

describe('terms-free contracts stay retrievable', () => {
  // terms[]/intents[] are optional precision boosters now that qmd is the
  // primary recall channel: a contract with no hand-authored terms must still
  // produce lexical search_terms from its title/body/paths so non-qmd machines
  // degrade to body-text matching instead of losing the record.
  it('builds a record with search terms derived from title/body/paths', () => {
    const record = buildDependencyRecord(makeArtifact(), {
      repoRegistry: buildRepoRegistry({ repos: [] }),
      entityLookup: buildEntityRegistry({ entities: [] })
    });

    assert.ok(record, 'contract-bearing decision must index');
    assert.equal(record.contract.triggers.terms.length, 0);
    assert.ok(record.search_terms.includes('Example decision carrying a change contract'));
    assert.ok(record.search_terms.includes('config/strategies/*.json'));
    assert.equal(record.body_text, 'Changing the strategy config requires a frontend portfolio follow-up.');
  });
});
