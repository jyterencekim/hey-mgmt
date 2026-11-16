import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { configureConnector } from '../desk-connectors.mjs';
import { completeCronJob, listCronJobs, preflightCronJob, renderCronJob } from '../desk-cron.mjs';

let tmpRoot;

function write(path, content) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

describe('desk-cron', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `desk-cron-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    write(resolve(tmpRoot, '.env'), 'MEMBER=mina\nLANGUAGE=ko\n');
    write(
      resolve(tmpRoot, 'content', 'policies', 'external-activity.yml'),
      'sources:\n  slack:\n    enabled: false\n  github:\n    enabled: false\n',
    );
    write(
      resolve(tmpRoot, 'content', 'policies', 'meeting-ingestion.yml'),
      'gmail:\n  enabled: false\nnotion:\n  enabled: false\n',
    );
    write(resolve(tmpRoot, 'workspace', 'fisher', 'config', 'external-activity.yml'), 'collector:\n  channels: []\n');
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('lists standard jobs and renders stateless CRON_TZ prompts without OS daemons', () => {
    const jobs = listCronJobs();
    assert.deepEqual(jobs.map((j) => j.id), ['activity-sync', 'desk-morning-prep', 'desk-evening-scaffold']);

    configureConnector(tmpRoot, 'github', { mode: 'api-token', enabled: true, repos: 'acme/api' });
    configureConnector(tmpRoot, 'drive', { mode: 'agent-mcp', enabled: true, folders: 'fld-1' });

    const rendered = renderCronJob(tmpRoot, { job: 'activity-sync', tz: 'Asia/Seoul' });
    assert.equal(rendered.member, 'mina');
    assert.equal(rendered.cron_with_tz, 'CRON_TZ=Asia/Seoul */30 9-19 * * 1-5');
    assert.match(rendered.prompt, /activity poll github/);
    assert.match(rendered.prompt, /activity push-events --stdin/);
    assert.match(rendered.prompt, /Do NOT install or edit OS `launchd` or `crontab`/);
  });

  it('enforces lock and cooldown via preflightCronJob and completeCronJob', () => {
    const t0 = Date.parse('2026-11-16T00:00:00.000Z');
    const first = preflightCronJob(tmpRoot, { job: 'activity-sync', cooldownMinutes: 20, now: t0 });
    assert.equal(first.should_run, true);

    const whileLocked = preflightCronJob(tmpRoot, { job: 'activity-sync', cooldownMinutes: 20, now: t0 + 60_000 });
    assert.equal(whileLocked.should_run, false);
    assert.equal(whileLocked.reason, 'locked');

    completeCronJob(tmpRoot, {
      job: 'activity-sync',
      status: 'ok',
      completedAt: new Date(t0 + 120_000).toISOString(),
    });

    const withinCooldown = preflightCronJob(tmpRoot, { job: 'activity-sync', cooldownMinutes: 20, now: t0 + 5 * 60_000 });
    assert.equal(withinCooldown.should_run, false);
    assert.equal(withinCooldown.reason, 'cooldown');

    const afterCooldown = preflightCronJob(tmpRoot, { job: 'activity-sync', cooldownMinutes: 20, now: t0 + 25 * 60_000 });
    assert.equal(afterCooldown.should_run, true);
  });
});
