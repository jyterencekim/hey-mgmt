import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { applySetup, inspectSetupStatus, parseEnvFile, upsertEnvVariables } from '../desk-setup.mjs';

let sandboxDir;

function writeFile(filePath, content) {
  mkdirSync(resolve(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function buildStarterFixture(root) {
  writeFile(
    resolve(root, '.env.example'),
    [
      'MEMBER=alice',
      'LANGUAGE=en',
      'HEY_TONE=concise',
      '# SLACK_BOT_TOKEN=xoxb-placeholder',
      '# NOTION_TOKEN=ntn_placeholder',
    ].join('\n') + '\n',
  );
  writeFile(
    resolve(root, 'content', 'vocab', 'members.yml'),
    [
      '# Roster',
      'interaction_preference_default: balanced',
      'members:',
      '  - name: alice',
      '    role: lead',
      '    interaction_preference: balanced',
      '  - name: bob',
      '    role: engineer',
      '    interaction_preference: balanced',
      '  - name: team',
      '    role: shared',
      '  - name: fisher',
      '    role: agent-runtime',
      '  - name: agent',
      '    role: automation',
    ].join('\n') + '\n',
  );
  writeFile(
    resolve(root, 'content', 'vocab', 'areas.yml'),
    'areas:\n  - name: Core\n    description: Core services\n  - name: Team\n    description: Team OS\n',
  );
  writeFile(resolve(root, 'content', 'vocab', 'tags.yml'), 'tags:\n  - Onboarding\n  - Operations\n');
  writeFile(resolve(root, 'content', 'vocab', 'entities.yml'), 'entities:\n  - canonical: HeyMgmt\n    type: module\n');
  writeFile(
    resolve(root, 'content', 'vocab', 'repos.yml'),
    'orgs:\n  - id: example-org\n    relationship: primary\nrepos:\n  - name: hey-mgmt\n    org: example-org\n    status: active\nsituations: []\n',
  );
  writeFile(resolve(root, 'content', 'policies', 'governance.yml'), 'version: 1\nsources_policy:\n  decision:\n    min_refs: 2\n');
  writeFile(
    resolve(root, 'content', 'policies', 'external-activity.yml'),
    'sources:\n  slack:\n    enabled: false\napproval:\n  artifact_owner_fallback: alice\nlogging:\n  fallback_workspace: alice\n',
  );
  writeFile(
    resolve(root, 'content', 'policies', 'meeting-ingestion.yml'),
    'defaults:\n  default_owner: alice\nmembers:\n  alice:\n    gmail_addresses: [alice@example.com]\n  bob:\n    gmail_addresses: [bob@example.com]\n',
  );
  writeFile(
    resolve(root, 'workspace', 'fisher', 'config', 'external-activity.yml'),
    'collector:\n  dm_allowlist: [alice, bob]\napproval:\n  default_approver: alice\nmembers:\n  alice:\n    slack_user_id: ""\n  bob:\n    slack_user_id: ""\n',
  );
  writeFile(resolve(root, 'workspace', 'alice', 'profile.md'), '# Alice\n');
  writeFile(resolve(root, 'workspace', 'bob', 'profile.md'), '# Bob\n');
  writeFile(
    resolve(root, 'content', 'goals', 'goal_team-os.md'),
    `---\nid: goal_team-os\ntype: goal\ntitle: Adopt Team OS\ncreated_at: '2026-11-05'\nupdated_at: '2026-11-05'\nstatus: active\nowner: alice\narea: Team\n---\n\n## Outcome\nTest.\n`,
  );
  writeFile(
    resolve(root, 'content', 'initiatives', '2026', '11', 'initiative_onboarding.md'),
    `---\nid: initiative_onboarding\ntype: initiative\ntitle: Onboarding\ncreated_at: '2026-11-05'\nupdated_at: '2026-11-05'\nstatus: active\nowner: alice\narea: Team\nx_initiative_kind: ops\ndefinition_of_done:\n  - Complete onboarding\nrelations:\n  - type: contributes_to\n    target: goal_team-os\n---\n\n## Objective\nTest.\n`,
  );
  writeFile(
    resolve(root, 'content', 'tasks', '2026', '11', 'task_starter-check.md'),
    `---\nid: task_starter-check\ntype: task\ntitle: Starter check\ncreated_at: '2026-11-05'\nupdated_at: '2026-11-05'\nstatus: ready\nowner: bob\narea: Team\npriority: do\niteration: 2026-W47\ndefinition_of_done:\n  - Verify setup\nrelations:\n  - type: child_of\n    target: initiative_onboarding\n---\n\n## Steps\nVerify.\n`,
  );
}

describe('desk-setup', () => {
  beforeEach(() => {
    sandboxDir = resolve(tmpdir(), `desk-setup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(sandboxDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(sandboxDir, { recursive: true, force: true });
  });

  it('upserts .env variables while preserving comments and unrelated secrets', () => {
    const repo = resolve(sandboxDir, 'repo');
    buildStarterFixture(repo);
    const envPath = resolve(repo, '.env');

    const first = upsertEnvVariables(envPath, {
      MEMBER: 'mina',
      LANGUAGE: 'ko',
      SLACK_BOT_TOKEN: 'xoxb-secret-123',
    });
    assert.deepEqual(first.updated_keys, ['MEMBER', 'LANGUAGE', 'SLACK_BOT_TOKEN']);
    assert.equal(JSON.stringify(first).includes('xoxb-secret-123'), false);

    upsertEnvVariables(envPath, { HEY_TONE: 'coaching', LANGUAGE: 'en' });
    const parsed = parseEnvFile(envPath);
    assert.equal(parsed.MEMBER, 'mina');
    assert.equal(parsed.LANGUAGE, 'en');
    assert.equal(parsed.HEY_TONE, 'coaching');
    assert.equal(parsed.SLACK_BOT_TOKEN, 'xoxb-secret-123');
    assert.match(readFileSync(envPath, 'utf8'), /# NOTION_TOKEN=ntn_placeholder/);
  });

  it('detects starter init state vs initialized join state', () => {
    const repo = resolve(sandboxDir, 'hey-mgmt');
    buildStarterFixture(repo);

    const before = inspectSetupStatus(repo, { scanParent: false, skipRemoteCheck: true });
    assert.equal(before.needs_bootstrap, true);
    assert.equal(before.is_starter_state, true);
    assert.equal(before.mode_recommendation, 'init');
  });

  it('applies init mode with starter pruning, sibling scan, and clean validation, then supports join mode', () => {
    const repo = resolve(sandboxDir, 'hey-mgmt');
    const sibling = resolve(sandboxDir, 'core-api');
    buildStarterFixture(repo);
    mkdirSync(resolve(sibling, '.git'), { recursive: true });

    const res = applySetup(repo, {
      mode: 'init',
      member: 'mina',
      role: 'engineering-lead',
      lang: 'ko',
      tone: 'warm',
      areas: 'Product,Infra',
      pruneStarters: true,
      scanSiblings: true,
      runUpgrade: true,
    });

    assert.equal(res.ok, true);
    assert.equal(res.mode, 'init');
    assert.equal(res.tone, 'coaching');
    assert.equal(res.validation.errors, 0);
    assert.equal(res.validation.warnings, 0);
    assert.equal(existsSync(resolve(repo, 'workspace', 'alice')), false);
    assert.equal(existsSync(resolve(repo, 'workspace', 'bob')), false);
    assert.equal(existsSync(resolve(repo, 'workspace', 'mina', 'profile.md')), true);
    assert.equal(existsSync(resolve(repo, 'workspace', 'mina', 'repos.yml')), true);
    assert.match(readFileSync(resolve(repo, 'workspace', 'mina', 'repos.yml'), 'utf8'), /core-api/);
    assert.match(readFileSync(resolve(repo, 'content', 'tasks', '2026', '11', 'task_starter-check.md'), 'utf8'), /owner: mina/);
    assert.match(readFileSync(resolve(repo, 'content', 'goals', 'goal_team-os.md'), 'utf8'), /owner: mina/);
    assert.equal(existsSync(resolve(repo, 'index', 'manifest.jsonl')), true);
    assert.equal(existsSync(resolve(repo, '.hey', 'catalog.sqlite')), true);

    const statusAfter = inspectSetupStatus(repo, { scanParent: false, skipRemoteCheck: true });
    assert.equal(statusAfter.needs_bootstrap, false);
    assert.equal(statusAfter.is_starter_state, false);
    assert.equal(statusAfter.mode_recommendation, 'join');

    // Preserve a secret across a join setup
    upsertEnvVariables(resolve(repo, '.env'), { NOTION_TOKEN: 'ntn-keep-me' });
    const joinRes = applySetup(repo, {
      mode: 'join',
      member: 'liam',
      lang: 'en',
      tone: 'terse',
      scanSiblings: false,
      runUpgrade: true,
    });
    assert.equal(joinRes.ok, true);
    assert.equal(joinRes.mode, 'join');
    assert.equal(joinRes.tone, 'concise');
    const envAfterJoin = parseEnvFile(resolve(repo, '.env'));
    assert.equal(envAfterJoin.MEMBER, 'liam');
    assert.equal(envAfterJoin.NOTION_TOKEN, 'ntn-keep-me');
  });
});
