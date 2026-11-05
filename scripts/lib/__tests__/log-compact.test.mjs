import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { compactLogs, logStats, scanLogs, extractLogData } from '../log-compact.mjs';

function makeTmpRepo() {
  const dir = resolve(tmpdir(), `log-compact-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeDailyLog(repoRoot, member, date, content) {
  const logsDir = resolve(repoRoot, 'workspace', member, 'logs');
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(resolve(logsDir, `${date}.md`), content, 'utf8');
}

const RICH_LOG = (date) => `# ${date}

## Plan
- Focus on task_bridge-aggregator and task_keeper-update

## Log
<!-- Time-stamped entries in KST. Format: "- HH:MM — description" -->
- 09:30 — Started work on task_bridge-aggregator integration
- 10:15 — Fixed RPC routing for D'Cent wallet
- 11:00 — Deployed to QA (commit abc123)
- 14:00 — Code review with jared on keeper changes
- 15:30 — Merged task_keeper-update PR #42

## External Signals
<!-- external-activity:start -->
- 10:17 — [slack] #superearn_dev Discussion about bridge | URL: https://example.com/slack1 | Actor: jared.lee | Summary: Bridge discussion | Native IDs: msg_123
- 11:52 — [confluence] Product spec updated | URL: https://example.com/conf1 | Actor: terence.kim | Summary: Spec update | Native IDs: page_456
- 12:30 — [slack] #superearn-internal Deploy confirmed | URL: https://example.com/slack2 | Actor: jared.lee | Summary: Deploy OK | Native IDs: msg_789
- 13:00 — [slack] #superearn-internal QA passed | URL: https://example.com/slack3 | Actor: oliver | Summary: QA green | Native IDs: msg_012
<!-- external-activity:end -->

## Reflection

### State Changes
- **task_bridge-aggregator** — deployed to QA, all flows passing
- **task_keeper-update** — PR merged, ready for prod

### Observations
1. **RPC routing** needs chain-aware caching for D'Cent wallet performance
`;

const MINIMAL_LOG = (date) => `# ${date}

## Plan

## Log
<!-- Time-stamped entries in KST. Format: "- HH:MM — description" -->

## External Signals
<!-- external-activity:start -->
<!-- external-activity:end -->
`;

describe('scanLogs()', () => {
  let repoRoot;
  beforeEach(() => { repoRoot = makeTmpRepo(); });
  afterEach(() => { rmSync(repoRoot, { recursive: true, force: true }); });

  it('returns empty for missing member', () => {
    const result = scanLogs(repoRoot, 'nobody');
    assert.deepEqual(result, []);
  });

  it('scans daily logs and extracts dates', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', '# 2026-01-05');
    writeDailyLog(repoRoot, 'alice', '2026-01-06', '# 2026-01-06');
    const result = scanLogs(repoRoot, 'alice');
    assert.equal(result.length, 2);
    assert.equal(result[0].date, '2026-01-05');
    assert.equal(result[1].date, '2026-01-06');
  });

  it('handles non-standard filenames like YYYY-MM-DD-suffix.md', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', '# 2026-01-05');
    // Write a suffixed file manually
    const logsDir = resolve(repoRoot, 'workspace', 'alice', 'logs');
    writeFileSync(resolve(logsDir, '2026-01-05-dcent-fixes.md'), '# fixes', 'utf8');
    const result = scanLogs(repoRoot, 'alice');
    assert.equal(result.length, 2);
    // Both should parse to 2026-01-05
    assert.ok(result.every((r) => r.date === '2026-01-05'));
  });
});

describe('compactLogs()', () => {
  let repoRoot;
  beforeEach(() => { repoRoot = makeTmpRepo(); });
  afterEach(() => { rmSync(repoRoot, { recursive: true, force: true }); });

  it('skips current week', () => {
    // Write a log for today
    writeDailyLog(repoRoot, 'alice', '2026-03-27', MINIMAL_LOG('2026-03-27'));
    const result = compactLogs({ repoRoot, member: 'alice', today: '2026-03-27' });
    assert.equal(result.created.length, 0);
  });

  it('creates weekly summary for completed week', () => {
    // Write logs for a week in January (well before "today")
    writeDailyLog(repoRoot, 'alice', '2026-01-05', RICH_LOG('2026-01-05'));
    writeDailyLog(repoRoot, 'alice', '2026-01-06', RICH_LOG('2026-01-06'));
    writeDailyLog(repoRoot, 'alice', '2026-01-07', MINIMAL_LOG('2026-01-07'));

    const result = compactLogs({ repoRoot, member: 'alice', today: '2026-03-27' });

    const weeklies = result.created.filter((c) => c.tier === 'weekly');
    assert.ok(weeklies.length >= 1, 'should create at least one weekly summary');

    // Verify file was written
    assert.ok(existsSync(weeklies[0].path));
    const content = readFileSync(weeklies[0].path, 'utf8');
    assert.ok(content.includes('# Weekly Summary:'));
    assert.ok(content.includes('task_bridge-aggregator'));
  });

  it('creates monthly summary for completed month', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', RICH_LOG('2026-01-05'));
    writeDailyLog(repoRoot, 'alice', '2026-01-12', RICH_LOG('2026-01-12'));
    writeDailyLog(repoRoot, 'alice', '2026-01-19', MINIMAL_LOG('2026-01-19'));

    const result = compactLogs({ repoRoot, member: 'alice', today: '2026-03-27' });

    const monthlies = result.created.filter((c) => c.tier === 'monthly');
    assert.ok(monthlies.length >= 1, 'should create monthly summary');
    const content = readFileSync(monthlies[0].path, 'utf8');
    assert.ok(content.includes('# Monthly Summary: 2026-01'));
    assert.ok(content.includes('Working days: 3'));
  });

  it('creates yearly summary for completed year', () => {
    writeDailyLog(repoRoot, 'alice', '2025-10-13', RICH_LOG('2025-10-13'));
    writeDailyLog(repoRoot, 'alice', '2025-11-05', MINIMAL_LOG('2025-11-05'));

    const result = compactLogs({ repoRoot, member: 'alice', today: '2026-03-27' });

    const yearlies = result.created.filter((c) => c.tier === 'yearly');
    assert.ok(yearlies.length === 1, 'should create yearly summary for 2025');
    const content = readFileSync(yearlies[0].path, 'utf8');
    assert.ok(content.includes('# Yearly Summary: 2025'));
  });

  it('is idempotent — skips existing summaries without --force', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', RICH_LOG('2026-01-05'));

    const first = compactLogs({ repoRoot, member: 'alice', today: '2026-03-27' });
    assert.ok(first.created.length > 0);

    const second = compactLogs({ repoRoot, member: 'alice', today: '2026-03-27' });
    assert.equal(second.created.length, 0);
    assert.ok(second.skipped.length > 0);
  });

  it('regenerates with --force', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', RICH_LOG('2026-01-05'));

    compactLogs({ repoRoot, member: 'alice', today: '2026-03-27' });
    const second = compactLogs({ repoRoot, member: 'alice', today: '2026-03-27', force: true });
    assert.ok(second.created.length > 0, 'force should regenerate');
    assert.equal(second.skipped.length, 0);
  });

  it('dry-run does not write files', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', RICH_LOG('2026-01-05'));

    const result = compactLogs({ repoRoot, member: 'alice', today: '2026-03-27', dryRun: true });
    assert.ok(result.created.length > 0);
    // Content should be returned in dry-run
    assert.ok(result.created[0].content);
    // But file should not exist
    assert.ok(!existsSync(result.created[0].path));
  });

  it('handles logs with missing sections gracefully', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', MINIMAL_LOG('2026-01-05'));

    const result = compactLogs({ repoRoot, member: 'alice', today: '2026-03-27' });
    assert.ok(result.created.length > 0);
    const content = readFileSync(result.created[0].path, 'utf8');
    assert.ok(content.includes('(no log entries)'));
  });

  it('extracts task references correctly', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', RICH_LOG('2026-01-05'));

    const result = compactLogs({ repoRoot, member: 'alice', today: '2026-03-27' });
    const weekly = result.created.find((c) => c.tier === 'weekly');
    const content = readFileSync(weekly.path, 'utf8');
    assert.ok(content.includes('task_bridge-aggregator'));
    assert.ok(content.includes('task_keeper-update'));
  });

  it('condenses external signals — drops verbose fields', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', RICH_LOG('2026-01-05'));

    const result = compactLogs({ repoRoot, member: 'alice', today: '2026-03-27' });
    const weekly = result.created.find((c) => c.tier === 'weekly');
    const content = readFileSync(weekly.path, 'utf8');
    // Should NOT contain raw URLs or Native IDs
    assert.ok(!content.includes('Native IDs:'));
    assert.ok(!content.includes('https://example.com/slack1'));
    // Should contain condensed form
    assert.ok(content.includes('[slack]'));
  });
});

describe('extractLogData()', () => {
  let repoRoot;
  beforeEach(() => { repoRoot = makeTmpRepo(); });
  afterEach(() => { rmSync(repoRoot, { recursive: true, force: true }); });

  it('returns structured JSON with summaries array', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', RICH_LOG('2026-01-05'));
    writeDailyLog(repoRoot, 'alice', '2026-01-06', RICH_LOG('2026-01-06'));

    const result = extractLogData({ repoRoot, member: 'alice', today: '2026-03-27' });
    assert.equal(result.member, 'alice');
    assert.ok(Array.isArray(result.summaries));
    assert.ok(result.summaries.length >= 1);

    const week = result.summaries[0];
    assert.equal(week.tier, 'weekly');
    assert.ok(Array.isArray(week.taskRefs));
    assert.ok(Array.isArray(week.days));
    assert.equal(week.days.length, 2);

    const day = week.days[0];
    assert.equal(day.date, '2026-01-05');
    assert.ok(Array.isArray(day.taskRefs));
    assert.ok(Array.isArray(day.logEntries));
    assert.ok(Array.isArray(day.condensedSignals));
    assert.ok(Array.isArray(day.reflectionHighlights));
  });

  it('filters by specific week period', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', RICH_LOG('2026-01-05'));
    writeDailyLog(repoRoot, 'alice', '2026-02-09', RICH_LOG('2026-02-09'));

    const result = extractLogData({ repoRoot, member: 'alice', period: '2026-W02', today: '2026-03-27' });
    assert.equal(result.summaries.length, 1);
    assert.equal(result.summaries[0].key, '2026-W02');
  });

  it('filters by specific month period', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', RICH_LOG('2026-01-05'));
    writeDailyLog(repoRoot, 'alice', '2026-02-10', RICH_LOG('2026-02-10'));

    const result = extractLogData({ repoRoot, member: 'alice', period: '2026-01', today: '2026-03-27' });
    // Should only include January data
    const allDates = result.summaries.flatMap((s) => s.days.map((d) => d.date));
    assert.ok(allDates.every((d) => d.startsWith('2026-01')));
  });

  it('returns empty summaries for member with no logs', () => {
    const result = extractLogData({ repoRoot, member: 'nobody', today: '2026-03-27' });
    assert.deepEqual(result.summaries, []);
  });

  it('does not contain verbose URL or Native ID fields', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', RICH_LOG('2026-01-05'));
    const json = JSON.stringify(extractLogData({ repoRoot, member: 'alice', today: '2026-03-27' }));
    assert.ok(!json.includes('Native IDs'));
    assert.ok(!json.includes('https://example.com/slack1'));
  });
});

describe('logStats()', () => {
  let repoRoot;
  beforeEach(() => { repoRoot = makeTmpRepo(); });
  afterEach(() => { rmSync(repoRoot, { recursive: true, force: true }); });

  it('returns stats for all members with logs', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', '# test');
    writeDailyLog(repoRoot, 'alice', '2026-01-06', '# test');
    writeDailyLog(repoRoot, 'bob', '2026-02-01', '# test');

    const stats = logStats(repoRoot);
    assert.equal(stats.length, 2);

    const alice = stats.find((s) => s.member === 'alice');
    assert.equal(alice.dailyLogs, 2);
    assert.equal(alice.dateRange, '2026-01-05 to 2026-01-06');
    assert.deepEqual(alice.summaries, { weekly: 0, monthly: 0, yearly: 0 });
  });

  it('counts summaries after compaction', () => {
    writeDailyLog(repoRoot, 'alice', '2026-01-05', RICH_LOG('2026-01-05'));
    writeDailyLog(repoRoot, 'alice', '2026-01-12', RICH_LOG('2026-01-12'));

    compactLogs({ repoRoot, member: 'alice', today: '2026-03-27' });

    const stats = logStats(repoRoot);
    const alice = stats.find((s) => s.member === 'alice');
    assert.ok(alice.summaries.weekly > 0);
    assert.ok(alice.summaries.monthly > 0);
  });
});
