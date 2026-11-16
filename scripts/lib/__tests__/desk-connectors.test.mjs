import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import {
  checkStaleConnectors,
  configureConnector,
  extractDriveFolderId,
  inspectConnectorsStatus,
  renderSlackAppManifest,
  testConnector,
} from '../desk-connectors.mjs';
import { pushAgentActivityEvents } from '../activity-runner.mjs';

let tmpRoot;

function write(path, content) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function setupRepo() {
  tmpRoot = resolve(tmpdir(), `desk-conn-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  write(resolve(tmpRoot, 'content', 'vocab', 'members.yml'), 'members:\n  - name: alice\n    role: lead\n');
  write(resolve(tmpRoot, 'content', 'vocab', 'areas.yml'), 'areas:\n  - name: Core\n');
  write(resolve(tmpRoot, 'content', 'vocab', 'tags.yml'), 'tags: []\n');
  write(resolve(tmpRoot, 'content', 'vocab', 'entities.yml'), 'entities: []\n');
  write(
    resolve(tmpRoot, 'content', 'policies', 'external-activity.yml'),
    'sources:\n  slack:\n    enabled: false\n    channels: []\n  drive:\n    enabled: false\n    shared_drives: []\n  github:\n    enabled: false\n    repos: []\nruntime:\n  state_dir: .hey/external-activity\n',
  );
  write(
    resolve(tmpRoot, 'content', 'policies', 'meeting-ingestion.yml'),
    'defaults:\n  default_owner: alice\ngmail:\n  enabled: false\n  query: from:gemini-notes@google.com\nnotion:\n  enabled: false\n  known_databases: []\n',
  );
  write(
    resolve(tmpRoot, 'workspace', 'fisher', 'config', 'external-activity.yml'),
    'collector:\n  channels: []\ndrive:\n  enabled: false\n  folders: []\n  shared_drives: []\ngithub:\n  enabled: false\n  repos: []\nmeeting:\n  enabled: false\n',
  );
  mkdirSync(resolve(tmpRoot, 'workspace', 'alice'), { recursive: true });
}

describe('desk-connectors', () => {
  beforeEach(setupRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('extracts Google Drive folder IDs from URLs and bare IDs', () => {
    assert.equal(
      extractDriveFolderId('https://drive.google.com/drive/folders/1AbC_dEf-123?usp=sharing'),
      '1AbC_dEf-123',
    );
    assert.equal(
      extractDriveFolderId('https://drive.google.com/open?id=9ZyX_wVu-456&authuser=0'),
      '9ZyX_wVu-456',
    );
    assert.equal(extractDriveFolderId('bareFolderId789'), 'bareFolderId789');
  });

  it('renders a Slack App manifest with required scopes', () => {
    const out = renderSlackAppManifest({ botName: 'acme-desk' });
    assert.equal(out.source, 'slack');
    assert.equal(out.create_app_url, 'https://api.slack.com/apps?new_app=1');
    assert.equal(out.manifest.display_information.name, 'acme-desk');
    assert.ok(out.manifest.oauth_config.scopes.bot.includes('channels:history'));
    assert.ok(out.manifest.oauth_config.scopes.bot.includes('users:read'));
  });

  it('configures connectors atomically without leaking secret values in status', () => {
    const slackRes = configureConnector(tmpRoot, 'slack', {
      mode: 'api-token',
      enabled: true,
      channels: 'C111,C222',
      envUpdates: ['SLACK_BOT_TOKEN=xoxb-top-secret-token'],
    });
    assert.equal(slackRes.ok, true);
    assert.deepEqual(slackRes.env_updated_keys, ['SLACK_BOT_TOKEN']);

    const driveRes = configureConnector(tmpRoot, 'drive', {
      mode: 'api-token',
      enabled: true,
      folders: 'https://drive.google.com/drive/folders/FolderXYZ?usp=drive_link',
    });
    assert.equal(driveRes.ok, true);

    const notionRes = configureConnector(tmpRoot, 'notion', {
      mode: 'agent-mcp',
      enabled: true,
      databases: 'db-uuid-1234',
    });
    assert.equal(notionRes.ok, true);

    const fisherCfg = parseYaml(readFileSync(resolve(tmpRoot, 'workspace', 'fisher', 'config', 'external-activity.yml'), 'utf8'));
    assert.deepEqual(fisherCfg.drive.folders, ['FolderXYZ']);
    assert.equal(fisherCfg.meeting.enabled, true);

    const meetingCfg = parseYaml(readFileSync(resolve(tmpRoot, 'content', 'policies', 'meeting-ingestion.yml'), 'utf8'));
    assert.equal(meetingCfg.notion.enabled, true);
    assert.equal(meetingCfg.notion.database_id, 'db-uuid-1234');
    assert.deepEqual(meetingCfg.notion.known_databases, ['db-uuid-1234']);

    const status = inspectConnectorsStatus(tmpRoot);
    assert.equal(JSON.stringify(status).includes('xoxb-top-secret-token'), false);
    const slackEntry = status.connectors.find((c) => c.source === 'slack');
    assert.equal(slackEntry.enabled, true);
    assert.equal(slackEntry.credentials_ready, true);
    assert.deepEqual(slackEntry.targets, ['C111', 'C222']);
  });

  it('supports agent-mcp test and ergonomic pushAgentActivityEvents with watermark freshness', async () => {
    configureConnector(tmpRoot, 'notion', {
      mode: 'agent-mcp',
      enabled: true,
      databases: 'db-1',
    });

    const testRes = await testConnector(tmpRoot, 'notion');
    assert.equal(testRes.ok, true);
    assert.equal(testRes.mode, 'agent-mcp');

    const beforeStale = checkStaleConnectors(tmpRoot, { maxAgeMinutes: 120 });
    assert.equal(beforeStale.length, 1);
    assert.equal(beforeStale[0].stale_reason, 'never_polled');

    const nowIso = '2026-11-16T03:00:00.000Z';
    const pushRes = await pushAgentActivityEvents({
      repoRoot: tmpRoot,
      defaultWorkspaceOwner: 'alice',
      prepare: true,
      rawInput: JSON.stringify([
        {
          source: 'notion',
          id: 'page-99',
          title: 'Architecture Sync Notes',
          url: 'https://notion.so/page-99',
          changed_at: nowIso,
          summary: 'Agreed to adopt agent-managed crons',
        },
      ]),
    });

    assert.equal(pushRes.event_count, 1);
    assert.equal(pushRes.sources.notion, 1);
    assert.ok(pushRes.prepared);

    const freshCheck = checkStaleConnectors(tmpRoot, {
      maxAgeMinutes: 120,
      now: Date.now() + 5 * 60_000,
    });
    assert.equal(freshCheck.length, 0);

    const staleLater = checkStaleConnectors(tmpRoot, {
      maxAgeMinutes: 120,
      now: Date.now() + 180 * 60_000,
    });
    assert.equal(staleLater.length, 1);
    assert.equal(staleLater[0].stale_reason, 'stale');
  });
});
