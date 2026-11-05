import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
// NB: only pure logic + the chunker's filesystem behavior is tested. The qmd
// package is never imported here (CI has no qmd); these helpers never touch it.
import {
  parseId,
  fromPath,
  resultId,
  rrf,
  buildFisherChunks,
  ensureQmdInstalled,
  isQmdRuntimeCompatible,
  qmdRuntimeFingerprint,
} from '../qmd-backend.mjs';

describe('native runtime compatibility', () => {
  let repoRoot;

  beforeEach(() => {
    repoRoot = resolve(tmpdir(), `qmd-runtime-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(resolve(repoRoot, '.hey/qmd/runtime/node_modules/@tobilu/qmd/dist'), { recursive: true });
    writeFileSync(resolve(repoRoot, '.hey/qmd/runtime/node_modules/@tobilu/qmd/dist/index.js'), 'export {};\n');
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('rebuilds an existing unmarked runtime once, then reuses it', () => {
    const calls = [];
    const run = (...args) => calls.push(args);

    ensureQmdInstalled(repoRoot, { log: () => {}, run });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'npm');
    assert.equal(calls[0][1][0], 'rebuild');
    assert.equal(isQmdRuntimeCompatible(repoRoot), true);

    ensureQmdInstalled(repoRoot, { log: () => {}, run });
    assert.equal(calls.length, 1, 'matching ABI/platform runtime must not rebuild again');
  });

  it('rebuilds when the recorded Node ABI differs', () => {
    const marker = resolve(repoRoot, '.hey/qmd/runtime/.hey-native-runtime.json');
    writeFileSync(marker, JSON.stringify({ ...qmdRuntimeFingerprint(), node_modules_abi: 'incompatible-abi' }));
    const calls = [];

    ensureQmdInstalled(repoRoot, { log: () => {}, run: (...args) => calls.push(args) });

    assert.equal(calls.length, 1);
    assert.equal(calls[0][1][0], 'rebuild');
    assert.equal(isQmdRuntimeCompatible(repoRoot), true);
  });
});

describe('id mapping', () => {
  it('parses the frontmatter id from a chunk body', () => {
    const body = '---\nid: decision_adr-foo-bar\ntype: decision\n---\n\nsome text';
    assert.equal(parseId(body), 'decision_adr-foo-bar');
  });

  it('returns null when no frontmatter id is present', () => {
    assert.equal(parseId('just body text, no id field'), null);
  });

  it('reconstructs the type-prefix underscore qmd mangles to a hyphen', () => {
    // qmd renders decision_adr-foo-bar as decision-adr-foo-bar in the path stem;
    // only the *type prefix* underscore is restored, not later hyphens.
    assert.equal(fromPath('content/decisions/decision-adr-foo-bar.md'), 'decision_adr-foo-bar');
    assert.equal(fromPath('note-x.md'), 'note_x');
  });

  it('returns a stem with no known type prefix unchanged', () => {
    assert.equal(fromPath('random-doc-name.md'), 'random-doc-name');
  });

  it('prefers the frontmatter id over the path fallback', () => {
    const r = { body: '---\nid: task_real-id\n---\n', displayPath: 'task-wrong-id.md' };
    assert.equal(resultId(r), 'task_real-id');
  });

  it('falls back to path reconstruction when body has no id', () => {
    assert.equal(resultId({ body: 'no id here', displayPath: 'meeting-weekly-sync.md' }), 'meeting_weekly-sync');
  });
});

describe('rrf fusion', () => {
  it('ranks a shared item first and unions both lists', () => {
    // `shared` appears high in both lists; nothing else does, so RRF must rank it
    // first. The fused length is the union of the inputs (dedup of shared).
    const bm = ['shared', 'a', 'b'];
    const vec = ['c', 'shared', 'd'];
    const fused = rrf([bm, vec]);
    assert.equal(fused[0][0], 'shared');
    const ids = fused.map(([id]) => id);
    assert.equal(ids.length, new Set([...bm, ...vec]).size);
    assert.deepEqual(new Set(ids), new Set([...bm, ...vec]));
  });
});

describe('buildFisherChunks', () => {
  let repoRoot;

  beforeEach(() => {
    repoRoot = resolve(tmpdir(), `qmd-fisher-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(resolve(repoRoot, 'workspace/fisher/knowledge'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('emits one .md per valid row and skips malformed lines', () => {
    const jsonl = [
      JSON.stringify({ id: 'kn_aaa', title: 'First Row', summary: 'a summary', topics: ['x'], date: '2026-06-01' }),
      '{ this is not valid json',
      JSON.stringify({ id: 'kn_bbb', title: 'Second Row', summary: 'another summary' }),
      '', // blank line, ignored
    ].join('\n');
    writeFileSync(resolve(repoRoot, 'workspace/fisher/knowledge/2026-06.jsonl'), jsonl);

    const written = buildFisherChunks(repoRoot);
    assert.equal(written, 2, 'two valid rows; malformed + blank skipped');

    const outDir = resolve(repoRoot, '.hey/qmd/fisher-knowledge/2026-06');
    const files = readdirSync(outDir).filter((f) => f.endsWith('.md'));
    assert.equal(files.length, 2);

    // Each derived doc carries a parseable frontmatter id matching a row id.
    const ids = files.map((f) => parseId(readFileSync(resolve(outDir, f), 'utf8')));
    assert.deepEqual(new Set(ids), new Set(['kn_aaa', 'kn_bbb']));
  });

  it('hashes a stable fallback id when a row has no id', () => {
    writeFileSync(
      resolve(repoRoot, 'workspace/fisher/knowledge/x.jsonl'),
      JSON.stringify({ title: 'No Id Row', summary: 's' }),
    );
    const written = buildFisherChunks(repoRoot);
    assert.equal(written, 1);
    const outDir = resolve(repoRoot, '.hey/qmd/fisher-knowledge/x');
    const id = parseId(readFileSync(resolve(outDir, readdirSync(outDir)[0]), 'utf8'));
    assert.match(id, /^fisherknowledge_[0-9a-f]{16}$/);
  });

  it('is a no-op when there are no JSONL files', () => {
    // knowledge dir exists (from beforeEach) but holds no .jsonl files.
    assert.equal(buildFisherChunks(repoRoot), 0);
    assert.equal(existsSync(resolve(repoRoot, '.hey/qmd/fisher-knowledge')), false);
  });

  it('is a no-op when the knowledge dir is absent', () => {
    rmSync(resolve(repoRoot, 'workspace/fisher/knowledge'), { recursive: true, force: true });
    assert.equal(buildFisherChunks(repoRoot), 0);
  });
});
