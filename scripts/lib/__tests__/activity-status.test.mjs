import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gatherStatus, buildStatusBlocks } from '../activity-status.mjs';

let tmpRoot;

beforeEach(() => {
  tmpRoot = resolve(tmpdir(), `status-${Date.now()}`);
  mkdirSync(resolve(tmpRoot, '.hey', 'external-activity'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'workspace', 'fisher', 'knowledge'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'workspace', 'fisher', 'observations'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('gatherStatus', () => {
  it('returns status with empty repo', () => {
    const config = {
      reflection: { enabled: true, promotion_confidence_threshold: 0.8, observation_confidence_threshold: 0.5 },
      digest: { enabled: true, schedule: ['12:00', '18:00'] },
    };
    const status = gatherStatus(tmpRoot, config);
    assert.ok(status.timestamp);
    assert.ok(status.kst_date);
    assert.equal(typeof status.sources, 'object');
    assert.equal(status.knowledge.total, 0);
    assert.equal(status.observations.total, 0);
    assert.equal(status.config.reflection_enabled, true);
  });

  it('reads source health from events.jsonl', () => {
    const recentTime = new Date().toISOString();
    const events = [
      JSON.stringify({ source: 'slack', changed_at: recentTime, object_id: '1' }),
      JSON.stringify({ source: 'drive', changed_at: recentTime, object_id: '2' }),
    ].join('\n');
    writeFileSync(resolve(tmpRoot, '.hey', 'external-activity', 'events.jsonl'), events);

    const status = gatherStatus(tmpRoot, { reflection: {}, digest: {} });
    assert.equal(status.sources.slack.recent_count, 1);
    assert.equal(status.sources.slack.stale, false);
    assert.equal(status.sources.drive.recent_count, 1);
    assert.equal(status.sources.confluence.recent_count, 0);
  });

  it('marks sources stale when no events file exists', () => {
    const status = gatherStatus(tmpRoot, { reflection: {}, digest: {} });
    for (const src of ['slack', 'confluence', 'drive', 'github']) {
      assert.equal(status.sources[src].stale, true);
      assert.equal(status.sources[src].last_event_at, null);
    }
  });

  it('counts knowledge entries by status', () => {
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const month = kstNow.toISOString().slice(0, 7);
    const base = {
      source: 'slack',
      object_id: 'obj',
      title: 'Status item',
      date: `${month}-01`,
      changed_at: new Date().toISOString(),
    };
    const entries = [
      JSON.stringify({ ...base, object_id: 'obj-a', status: 'linked', linked_artifact: 'task_a', signature: 'a' }),
      JSON.stringify({ ...base, object_id: 'obj-b', status: 'pending', signature: 'b' }),
      JSON.stringify({ ...base, object_id: 'obj-b', status: 'linked', linked_artifact: 'task_b', signature: 'b' }),
      JSON.stringify({ ...base, object_id: 'obj-c', status: 'indexed', signature: 'c' }),
      JSON.stringify({ ...base, object_id: 'obj-d', status: 'revoked', signature: 'd' }),
    ].join('\n');
    writeFileSync(resolve(tmpRoot, 'workspace', 'fisher', 'knowledge', `${month}.jsonl`), entries);

    const status = gatherStatus(tmpRoot, { reflection: {}, digest: {} });
    assert.equal(status.knowledge.linked, 2);
    assert.equal(status.knowledge.pending, 0);
    assert.equal(status.knowledge.indexed, 1);
    assert.equal(status.knowledge.revoked, 1);
    assert.equal(status.knowledge.total, 4);
  });

  it('surfaces config summary defaults', () => {
    const status = gatherStatus(tmpRoot, {});
    assert.equal(status.config.reflection_enabled, false);
    assert.equal(status.config.promotion_threshold, 0.8);
    assert.equal(status.config.observation_threshold, 0.5);
    assert.equal(status.config.digest_enabled, false);
    assert.deepEqual(status.config.digest_schedule, []);
    assert.equal(status.config.digest_channel, null);
  });
});

describe('buildStatusBlocks', () => {
  it('returns Block Kit blocks with all sections', () => {
    const status = {
      timestamp: new Date().toISOString(),
      kst_date: '2026-04-09',
      sources: {
        slack: { last_event_at: new Date().toISOString(), age_hours: 0.5, recent_count: 10, stale: false },
        confluence: { last_event_at: null, age_hours: null, recent_count: 0, stale: true },
        drive: { last_event_at: new Date().toISOString(), age_hours: 2.1, recent_count: 5, stale: true },
        github: { last_event_at: null, age_hours: null, recent_count: 0, stale: true },
      },
      knowledge: { indexed: 5, pending: 0, linked: 10, rejected: 2, revoked: 1, total: 18 },
      observations: { date: '2026-04-09', promoted: 3, observed: 7, total: 10 },
      config: {
        reflection_enabled: true,
        promotion_threshold: 0.8,
        observation_threshold: 0.5,
        digest_enabled: true,
        digest_schedule: ['12:00', '18:00'],
        digest_channel: 'C123',
      },
    };
    const blocks = buildStatusBlocks(status);
    assert.ok(blocks.length >= 4);
    assert.equal(blocks[0].type, 'header');
    assert.equal(blocks[0].text.text, 'Fisher Status Report');
    const text = JSON.stringify(blocks);
    assert.ok(text.includes('slack'));
    assert.ok(text.includes('Knowledge'));
    assert.ok(text.includes('Observations'));
    assert.ok(text.includes(':warning:'));
    assert.ok(text.includes(':white_check_mark:'));
  });
});
