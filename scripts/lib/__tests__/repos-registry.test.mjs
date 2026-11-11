import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRepoRegistry } from '../dependency-utils.mjs';
import {
  enrichReposVocab,
  repoSlugFromRemote,
  resolveSituations,
  validateReposVocab,
} from '../repos.mjs';

describe('repoSlugFromRemote & buildRepoRegistry', () => {
  it('extracts owner/repo from HTTPS, standard SSH, and SSH host-alias remotes', () => {
    assert.equal(repoSlugFromRemote('https://github.com/superearn-io/superearn-auditor'), 'superearn-io/superearn-auditor');
    assert.equal(repoSlugFromRemote('https://github.com/superearn-io/onchain-analysis.git'), 'superearn-io/onchain-analysis');
    assert.equal(repoSlugFromRemote('git@github.com:onrampto/cdp-monorepo.git'), 'onrampto/cdp-monorepo');
    assert.equal(repoSlugFromRemote('git@github.com-superearn:superearn-io/jpyc-swapper.git'), 'superearn-io/jpyc-swapper');
    assert.equal(repoSlugFromRemote(null), null);
    assert.equal(repoSlugFromRemote(''), null);
  });

  it('indexes aliases, local_dir, and SSH slugs in buildRepoRegistry search_terms', () => {
    const registry = buildRepoRegistry({
      repos: [
        {
          name: 'superearn-core',
          remote: 'git@github.com-superearn:superearn-io/superearn-core.git',
          local_dir: 'private-superearn-contract',
          aliases: ['contracts', 'origin-vault'],
        },
      ],
    });
    const entry = registry.get('superearn-core');
    assert.ok(entry);
    assert.equal(entry.slug, 'superearn-io/superearn-core');
    assert.ok(entry.search_terms.includes('private-superearn-contract'));
    assert.ok(entry.search_terms.includes('contracts'));
    assert.ok(entry.search_terms.includes('origin-vault'));
  });
});

describe('validateReposVocab', () => {
  it('accepts minimal backward-compatible repos[] without orgs or situations', () => {
    const issues = validateReposVocab({
      repos: [{ name: 'hey-mgmt', remote: 'https://github.com/example/hey-mgmt' }],
    });
    assert.equal(issues.length, 0);
  });

  it('validates orgs, repos, situations, target repos, and playbook artifact references', () => {
    const validVocab = {
      orgs: [
        { id: 'team-org', relationship: 'primary' },
        { id: 'partner-org', relationship: 'partner' },
      ],
      repos: [
        { name: 'team-mgmt', org: 'team-org', status: 'active', access: 'read-write' },
        { name: 'data-auditor', org: 'team-org', status: 'active', access: 'api-or-mcp' },
        { name: 'domain-research', org: 'team-org', status: 'active', access: 'read-only' },
        { name: 'partner-sdk', org: 'partner-org', status: 'reference', access: 'read-only' },
      ],
      situations: [
        {
          id: 'metrics-and-audit',
          title: 'Metrics and audit verification',
          when: 'Checking financial metrics, TVL, or lineage-backed facts',
          targets: [
            { repo: 'data-auditor', mode: 'primary', how: 'Query HTTP API or inspect repo' },
            { repo: 'domain-research', mode: 'reference', how: 'Cross-check strategy research docs' },
          ],
          playbooks: ['playbook_audit-queries'],
        },
      ],
    };

    const okIssues = validateReposVocab(validVocab, new Set(['playbook_audit-queries']));
    assert.equal(okIssues.length, 0);

    const brokenIssues = validateReposVocab(
      {
        orgs: [{ id: 'team-org', relationship: 'invalid-rel' }],
        repos: [{ name: 'team-mgmt', org: 'missing-org', status: 'bogus', access: 'bogus' }],
        situations: [
          {
            id: 'broken-sit',
            when: '',
            targets: [{ repo: 'nonexistent-repo', mode: 'bogus-mode' }],
            playbooks: ['playbook_missing'],
          },
        ],
      },
      new Set(['playbook_audit-queries'])
    );

    const messages = brokenIssues.map((i) => i.message).join('\n');
    assert.match(messages, /invalid relationship/);
    assert.match(messages, /references unknown org 'missing-org'/);
    assert.match(messages, /invalid status 'bogus'/);
    assert.match(messages, /invalid access 'bogus'/);
    assert.match(messages, /requires a non-empty 'when'/);
    assert.match(messages, /target repo 'nonexistent-repo' is not in repos\[\]/);
    assert.match(messages, /invalid mode 'bogus-mode'/);
    assert.match(messages, /unknown playbook\/artifact 'playbook_missing'/);
  });
});

describe('enrichReposVocab & resolveSituations', () => {
  it('resolves member path overrides, sibling local_dir paths, and situational matches', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'hey-repos-test-'));
    try {
      const mgmtRoot = join(sandbox, 'team-mgmt');
      const siblingResearch = join(sandbox, 'onchain-analysis');
      const customAuditor = join(sandbox, 'custom', 'auditor-clone');
      mkdirSync(join(mgmtRoot, 'workspace', 'alice'), { recursive: true });
      mkdirSync(siblingResearch, { recursive: true });
      mkdirSync(customAuditor, { recursive: true });

      writeFileSync(
        join(mgmtRoot, 'workspace', 'alice', 'repos.yml'),
        `repos:\n  - name: data-auditor\n    path: ${customAuditor}\n`,
        'utf8'
      );

      const vocab = {
        orgs: [{ id: 'team-org', relationship: 'primary' }],
        repos: [
          { name: 'team-mgmt', org: 'team-org', status: 'active' },
          {
            name: 'data-auditor',
            org: 'team-org',
            status: 'active',
            aliases: ['auditor', 'observatory'],
            entrypoints: ['docs/GLOSSARY.md'],
          },
          {
            name: 'domain-research',
            org: 'team-org',
            status: 'active',
            local_dir: 'onchain-analysis',
            aliases: ['oa'],
            entrypoints: ['strategies/catalog.md'],
          },
        ],
        situations: [
          {
            id: 'yield-research',
            title: 'DeFi yield & strategy research',
            when: 'Evaluating protocol yields, risk assessments, or strategy S-NNN catalog',
            keywords: ['yield', 'strategy', 'onchain-analysis', 'risk'],
            targets: [
              {
                repo: 'domain-research',
                mode: 'primary',
                how: 'Read strategies/ and insights/ or query oa:* in hey graph',
                entrypoints: ['insights/'],
              },
              {
                repo: 'data-auditor',
                mode: 'api-or-mcp',
                how: 'Check promoted protocol-knowledge facts',
              },
            ],
          },
        ],
      };

      const enriched = enrichReposVocab(vocab, { repoRoot: mgmtRoot, member: 'alice' });
      const auditorRepo = enriched.repoByName.get('data-auditor');
      const researchRepo = enriched.repoByName.get('domain-research');
      assert.equal(auditorRepo.local_path, customAuditor);
      assert.equal(auditorRepo.cloned, true);
      assert.equal(researchRepo.local_path, siblingResearch);
      assert.equal(researchRepo.cloned, true);

      const matches = resolveSituations(vocab, 'auditor yield strategy oa', {
        repoRoot: mgmtRoot,
        member: 'alice',
      });
      assert.equal(matches.length, 1);
      assert.equal(matches[0].id, 'yield-research');
      assert.deepEqual(matches[0].targets[0].entrypoints, ['insights/', 'strategies/catalog.md']);
      assert.equal(matches[0].targets[1].local_path, customAuditor);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
