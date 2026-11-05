import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DIGEST_END, DIGEST_START, buildDigestLogSection } from '../loop-digest.mjs';
import { SCAFFOLD_END, SCAFFOLD_START, applyMarkedSection } from '../log-scaffold.mjs';

function digestFixture(overrides = {}) {
  return {
    generated_at: '2026-08-19T08:30:00.000Z',
    today: '2026-08-19',
    member: 'charlie',
    inputs: { git_head: 'abc1234', manifest_built_at: '2026-08-18T23:30:00.000Z' },
    planned_today: [{ id: 'task_a', title: 'Planned thing', status: 'ready', priority: 'do' }],
    missed_plans: [],
    overdue: [],
    recommendations: [],
    board_counts: {},
    iteration_view: null,
    inbox: { open: [], new_count: 0, last_digest_at: null },
    due_packets: [],
    active_runs: [],
    ...overrides,
  };
}

describe('buildDigestLogSection()', () => {
  it('never emits a `## Plan` — a commitment is member-authored, not Fisher-authored', () => {
    // This is the load-bearing property. The 21:30 double-check reads "log
    // exists but has no ## Plan" as "the machine ran, the human did not
    // commit". If the digest ever wrote a Plan, that signal would silently
    // report success on days nobody planned anything.
    const section = buildDigestLogSection(digestFixture());
    assert.equal(/^#+ Plan\b/m.test(section), false);
  });

  it('demotes its own headings so they nest under the log date instead of competing with it', () => {
    const section = buildDigestLogSection(digestFixture());
    assert.match(section, /^### Planned today \(1\)$/m);
    // The digest's standalone `# Digest — …` title has no place inside a log.
    assert.equal(/^# Digest/m.test(section), false);
  });

  it('marks the section machine-owned at both ends so a human knows what is safe to edit', () => {
    const section = buildDigestLogSection(digestFixture());
    assert.ok(section.startsWith(DIGEST_START));
    assert.ok(section.trimEnd().endsWith(DIGEST_END));
    assert.match(section, /not a commitment/);
  });
});

describe('digest + scaffold sharing one log', () => {
  let root;

  function setup() {
    root = resolve(tmpdir(), `test-digest-log-${Date.now()}-${Math.floor(process.hrtime()[1] / 1000)}`);
    mkdirSync(resolve(root, 'workspace/charlie/logs'), { recursive: true });
    return root;
  }

  it('creates the log when absent, so an unattended pass always leaves evidence it ran', () => {
    setup();
    const result = applyMarkedSection(root, {
      member: 'charlie',
      date: '2026-08-19',
      section: buildDigestLogSection(digestFixture()),
      startMarker: DIGEST_START,
      endMarker: DIGEST_END,
      label: 'digest',
    });
    assert.equal(result.created, true);
    const text = readFileSync(result.path, 'utf8');
    assert.match(text, /^# 2026-08-19$/m);
    assert.match(text, /### Planned today/);
    rmSync(root, { recursive: true, force: true });
  });

  it('replaces only its own markers and leaves member-authored lines untouched', () => {
    // The whole point of marker scoping: the member writes judgment into this
    // same file all day, and a re-run at any hour must not eat it.
    setup();
    const logPath = resolve(root, 'workspace/charlie/logs/2026-08-19.md');
    writeFileSync(logPath, [
      '# 2026-08-19',
      '',
      '## Plan',
      '',
      '- member-authored commitment',
      '',
      DIGEST_START,
      '## Loop Control — auto (stale)',
      'stale machine text',
      DIGEST_END,
      '',
      '## Log',
      '- 09:00 — member-authored entry',
      '',
    ].join('\n'), 'utf8');

    applyMarkedSection(root, {
      member: 'charlie',
      date: '2026-08-19',
      section: buildDigestLogSection(digestFixture()),
      startMarker: DIGEST_START,
      endMarker: DIGEST_END,
      label: 'digest',
    });

    const text = readFileSync(logPath, 'utf8');
    assert.match(text, /- member-authored commitment/);
    assert.match(text, /- 09:00 — member-authored entry/);
    assert.match(text, /^## Plan$/m);
    assert.equal(text.includes('stale machine text'), false);
    rmSync(root, { recursive: true, force: true });
  });

  it('does not disturb the scaffold section written by the 21:30 job', () => {
    // Two unattended writers share the file. Each owns one marker pair; if the
    // digest re-run clobbered the scaffold, the day's pastward facts would be
    // lost every morning.
    setup();
    const logPath = resolve(root, 'workspace/charlie/logs/2026-08-19.md');
    writeFileSync(logPath, [
      '# 2026-08-19',
      '',
      SCAFFOLD_START,
      '## Auto scaffold',
      'pastward facts',
      SCAFFOLD_END,
      '',
    ].join('\n'), 'utf8');

    applyMarkedSection(root, {
      member: 'charlie',
      date: '2026-08-19',
      section: buildDigestLogSection(digestFixture()),
      startMarker: DIGEST_START,
      endMarker: DIGEST_END,
      label: 'digest',
    });

    const text = readFileSync(logPath, 'utf8');
    assert.match(text, /pastward facts/);
    assert.match(text, /### Planned today/);
    rmSync(root, { recursive: true, force: true });
  });

  it('fails loud on unbalanced markers instead of guessing which half to keep', () => {
    setup();
    const logPath = resolve(root, 'workspace/charlie/logs/2026-08-19.md');
    writeFileSync(logPath, `# 2026-08-19\n\n${DIGEST_START}\nhalf-written\n`, 'utf8');
    assert.throws(
      () => applyMarkedSection(root, {
        member: 'charlie',
        date: '2026-08-19',
        section: buildDigestLogSection(digestFixture()),
        startMarker: DIGEST_START,
        endMarker: DIGEST_END,
        label: 'digest',
      }),
      /unbalanced digest markers/,
    );
    rmSync(root, { recursive: true, force: true });
  });
});
