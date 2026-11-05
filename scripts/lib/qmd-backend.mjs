// qmd local semantic backend — derived, per-developer, fully optional.
// See decision_adr-qmd-local-retrieval-backend.
//
// Non-interference: this module NEVER imports qmd at the top level. qmd is
// installed into a gitignored runtime dir (.hey/qmd/runtime) and dynamically
// imported only inside the functions below. With qmd absent, importing this
// module is free and every entry point degrades to "not available".
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, readdirSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const QMD_VERSION = '2.5.3';
// Full HuggingFace identifier (matches qmd's own DEFAULT_EMBED_MODEL for 2.5.3);
// pinning the full id keeps us stable even if qmd changes its default later.
export const EMBED_MODEL = 'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf';

export const qmdRuntimeDir = (repoRoot) => resolve(repoRoot, '.hey/qmd/runtime');
export const qmdIndexPath = (repoRoot) => resolve(repoRoot, '.hey/qmd/index.sqlite');
const qmdRuntimeFingerprintPath = (repoRoot) => resolve(qmdRuntimeDir(repoRoot), '.hey-native-runtime.json');
const fisherKnowledgeDir = (repoRoot) => resolve(repoRoot, 'workspace/fisher/knowledge');
const fisherChunksDir = (repoRoot) => resolve(repoRoot, '.hey/qmd/fisher-knowledge');
const qmdEntry = (repoRoot) => resolve(qmdRuntimeDir(repoRoot), 'node_modules/@tobilu/qmd/dist/index.js');

export const isQmdInstalled = (repoRoot) => existsSync(qmdEntry(repoRoot));
export const isQmdIndexBuilt = (repoRoot) => existsSync(qmdIndexPath(repoRoot));

// Native dependencies such as better-sqlite3 are tied to Node's module ABI as
// well as the host platform/architecture. A runtime may still look installed
// after nvm/mise/Homebrew switches Node, but loading it will fail with
// ERR_DLOPEN_FAILED. Persist the build environment so setup can repair that
// state before qmd is imported.
export const qmdRuntimeFingerprint = () => ({
  qmd_version: QMD_VERSION,
  node_modules_abi: process.versions.modules,
  platform: process.platform,
  arch: process.arch,
});

export function isQmdRuntimeCompatible(repoRoot) {
  if (!isQmdInstalled(repoRoot)) return false;
  try {
    const recorded = JSON.parse(readFileSync(qmdRuntimeFingerprintPath(repoRoot), 'utf8'));
    return JSON.stringify(recorded) === JSON.stringify(qmdRuntimeFingerprint());
  } catch {
    // Existing runtimes predate the fingerprint. Rebuild them once so their
    // native modules are known to match the active environment.
    return false;
  }
}

function recordQmdRuntimeFingerprint(repoRoot) {
  writeFileSync(qmdRuntimeFingerprintPath(repoRoot), `${JSON.stringify(qmdRuntimeFingerprint(), null, 2)}\n`);
}

// Artifacts-only corpus, mirroring the lexical manifest. Logs/inbox excluded.
// The fisher-knowledge collection (derived row-level chunks) is added only when
// buildFisherChunks has materialized it — see buildFisherChunks/buildQmdIndex.
function collectionsConfig(repoRoot) {
  const md = '**/*.md';
  const cfg = {};
  if (existsSync(resolve(repoRoot, 'content'))) cfg.content = { path: resolve(repoRoot, 'content'), pattern: md };
  if (existsSync(resolve(repoRoot, 'docs'))) cfg.docs = { path: resolve(repoRoot, 'docs'), pattern: md };
  if (existsSync(resolve(repoRoot, 'workspace'))) cfg.workspace = { path: resolve(repoRoot, 'workspace'), pattern: md, ignore: ['**/logs/**', '**/inbox/**'] };
  if (existsSync(fisherChunksDir(repoRoot))) cfg.fisher_knowledge = { path: fisherChunksDir(repoRoot), pattern: md };
  return cfg;
}

// Row-level chunker for Fisher "knowledge" (workspace/fisher/knowledge/*.jsonl,
// one JSON object per line). qmd indexes whole files, so a multi-MB JSONL would
// be one giant chunk; we instead emit one derived markdown doc per row into the
// gitignored .hey/qmd/fisher-knowledge/<file>/<rowid>.md so qmd indexes per row.
// Each doc carries a stable frontmatter `id` (the row id, or a hash fallback) so
// the result→artifact mapper resolves it. Malformed lines are skipped. No-op
// when there are no JSONL files. Returns the count of rows written.
export function buildFisherChunks(repoRoot) {
  const srcDir = fisherKnowledgeDir(repoRoot);
  if (!existsSync(srcDir)) return 0;
  const files = readdirSync(srcDir).filter((f) => f.endsWith('.jsonl'));
  if (files.length === 0) return 0;

  const outRoot = fisherChunksDir(repoRoot);
  rmSync(outRoot, { recursive: true, force: true });

  let written = 0;
  for (const file of files) {
    const stem = basename(file, '.jsonl');
    const lines = readFileSync(resolve(srcDir, file), 'utf8').split('\n');
    const outDir = resolve(outRoot, stem);
    let dirReady = false;
    lines.forEach((line, lineNo) => {
      const raw = line.trim();
      if (!raw) return;
      let row;
      try { row = JSON.parse(raw); } catch { return; }
      if (!row || typeof row !== 'object') return;

      const id = typeof row.id === 'string' && row.id
        ? row.id
        : `fisherknowledge_${createHash('sha1').update(`${stem}:${lineNo}:${raw}`).digest('hex').slice(0, 16)}`;
      const md = fisherRowMarkdown(id, row);
      if (!dirReady) { mkdirSync(outDir, { recursive: true }); dirReady = true; }
      writeFileSync(resolve(outDir, `${safeRowFilename(id, lineNo)}.md`), md);
      written += 1;
    });
  }
  return written;
}

const safeRowFilename = (id, lineNo) => `${String(id).replace(/[^A-Za-z0-9_-]+/g, '-')}-${lineNo}`;

// Render one knowledge row as a markdown doc: frontmatter id + the row's text
// fields as body so qmd has something to embed and rank.
function fisherRowMarkdown(id, row) {
  const fields = ['title', 'summary', 'source', 'date', 'url', 'repository', 'branch', 'path'];
  const fm = [`---`, `id: ${id}`, `type: fisher_knowledge`];
  if (typeof row.title === 'string' && row.title) fm.push(`title: ${JSON.stringify(row.title)}`);
  fm.push('---', '');
  const body = [];
  for (const key of fields) { if (typeof row[key] === 'string' && row[key]) body.push(`${key}: ${row[key]}`); }
  if (Array.isArray(row.topics) && row.topics.length) body.push(`topics: ${row.topics.join(', ')}`);
  if (Array.isArray(row.actors) && row.actors.length) body.push(`actors: ${row.actors.join(', ')}`);
  if (typeof row.content === 'string' && row.content.trim()) body.push(`content:\n\n${row.content.trim()}`);
  return `${fm.join('\n')}${body.join('\n\n')}\n`;
}

// Preflight: returns { ok, problems[] } without throwing.
export function preflightQmd() {
  const problems = [];
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) problems.push(`Node ${process.versions.node} < 22 (qmd requires Node >= 22).`);
  try { execFileSync('sqlite3', ['--version'], { stdio: 'ignore' }); }
  catch { problems.push('sqlite3 not found. On macOS: `brew install sqlite`.'); }
  return { ok: problems.length === 0, problems };
}

// Install qmd into the gitignored runtime dir (idempotent).
export function ensureQmdInstalled(repoRoot, { log = console.error, run = execFileSync } = {}) {
  const dir = qmdRuntimeDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  if (!isQmdInstalled(repoRoot)) {
    log(`[qmd] installing @tobilu/qmd@${QMD_VERSION} into ${dir} (one-time; ~native build) ...`);
    run('npm', ['install', `@tobilu/qmd@${QMD_VERSION}`, '--prefix', dir, '--no-audit', '--no-fund', '--loglevel=error'], { stdio: 'inherit' });
    if (isQmdInstalled(repoRoot)) recordQmdRuntimeFingerprint(repoRoot);
    return isQmdInstalled(repoRoot);
  }

  if (!isQmdRuntimeCompatible(repoRoot)) {
    log(`[qmd] runtime environment changed; rebuilding native dependencies for Node ABI ${process.versions.modules} (${process.platform}-${process.arch}) ...`);
    run('npm', ['rebuild', '--prefix', dir, '--no-audit', '--no-fund', '--loglevel=error'], { stdio: 'inherit' });
    recordQmdRuntimeFingerprint(repoRoot);
  }
  return isQmdInstalled(repoRoot);
}

async function loadQmd(repoRoot) {
  return import(pathToFileURL(qmdEntry(repoRoot)).href);
}

// Build/refresh the qmd index over the artifact corpus. Models land in
// ~/.cache/qmd (machine-global, ~318MB first run). Returns a summary.
export async function buildQmdIndex(repoRoot, { log = console.error } = {}) {
  const pf = preflightQmd();
  if (!pf.ok) { const e = new Error(`qmd preflight failed:\n  - ${pf.problems.join('\n  - ')}`); e.preflight = pf; throw e; }
  ensureQmdInstalled(repoRoot, { log });
  const fisherRows = buildFisherChunks(repoRoot);
  if (fisherRows) log(`[qmd] derived ${fisherRows} fisher-knowledge row chunk(s)`);
  process.env.QMD_EMBED_MODEL ??= EMBED_MODEL;
  const { createStore } = await loadQmd(repoRoot);
  const collections = collectionsConfig(repoRoot);
  const names = Object.keys(collections);
  log(`[qmd] building index at ${qmdIndexPath(repoRoot)} over: ${names.join(', ')}`);
  const store = await createStore({ dbPath: qmdIndexPath(repoRoot), config: { collections } });
  const upd = await store.update({ collections: names });
  log(`[qmd] indexed ${upd.indexed} / updated ${upd.updated} / unchanged ${upd.unchanged} / needsEmbedding ${upd.needsEmbedding}`);
  log(`[qmd] embedding (first run downloads ${EMBED_MODEL} ~318MB to ~/.cache/qmd) ...`);
  const emb = await store.embed({});
  await store.close();
  // NB: spread upd first — it carries its own numeric `collections` count that
  // would otherwise clobber our collection-name array.
  return { index_path: qmdIndexPath(repoRoot), ...upd, collections: names, chunks_embedded: emb.chunksEmbedded };
}

// ---- search ----
const PREFIX = /^(task|note|decision|meeting|playbook|initiative)-/;
// Parse the canonical frontmatter `id:` out of a chunk body. Returns null when
// absent so callers fall back to displayPath reconstruction.
export const parseId = (body) => { const m = String(body || '').match(/(?:^|\n)id:\s*([A-Za-z0-9_-]+)/); return m ? m[1] : null; };
// Reconstruct an artifact id from a path stem. qmd mangles the type-prefix
// underscore to a hyphen (decision_foo -> decision-foo); restore it. A stem with
// no known type prefix is returned unchanged.
export const fromPath = (p) => { const stem = String(p || '').split('/').pop()?.replace(/\.md$/, '') ?? ''; return PREFIX.test(stem) ? stem.replace(PREFIX, (m) => `${m.slice(0, -1)}_`) : stem; };
export const resultId = (r) => parseId(r.body) || fromPath(r.displayPath || r.path);

// Reciprocal-rank fusion of ranked id lists. Returns [[id, score], ...] sorted
// by fused score descending; length is the union of the input lists.
export function rrf(lists, k = 60) {
  const score = {};
  for (const list of lists) list.forEach((id, i) => { score[id] = (score[id] || 0) + 1 / (k + i + 1); });
  return Object.entries(score).sort((a, b) => b[1] - a[1]);
}

// Hybrid (BM25 + vector, RRF) search. Returns [{ id, score }] of canonical
// artifact ids, deduped (best chunk per id). Throws on any qmd failure — the
// caller (adapter) catches and falls back to lexical.
export async function searchQmdHybrid(repoRoot, query, { limit = 20 } = {}) {
  process.env.QMD_EMBED_MODEL ??= EMBED_MODEL;
  const { createStore } = await loadQmd(repoRoot);
  const store = await createStore({ dbPath: qmdIndexPath(repoRoot) });
  try {
    const dedupe = (rs) => { const seen = new Set(), out = []; for (const r of rs) { const id = resultId(r); if (id && !seen.has(id)) { seen.add(id); out.push(id); } } return out; };
    const bm = dedupe(await store.searchLex(query, { limit: 50 }));
    const vec = dedupe(await store.searchVector(query, { limit: 50 }));
    const fused = rrf([bm, vec]);
    const max = fused[0]?.[1] || 1;
    return fused.slice(0, limit).map(([id, s]) => ({ id, score: Number((s / max).toFixed(4)) }));
  } finally {
    await store.close();
  }
}

// Freshness: index built after the newest content change?
// Fresh iff the index is newer than every source the corpus actually indexes:
// content/ + docs/ + workspace artifacts (logs/inbox pruned) + the Fisher
// knowledge .jsonl that the chunker derives from. Walking content/ alone would
// miss docs/workspace/fisher edits and leave a silently-stale index.
const PRUNE_DIRS = new Set(['logs', 'inbox', 'node_modules', '.git', '.hey']);
export function isQmdIndexFresh(repoRoot) {
  if (!isQmdIndexBuilt(repoRoot)) return false;
  try {
    const idxMtime = statSync(qmdIndexPath(repoRoot)).mtimeMs;
    let newest = 0;
    const walk = (dir, accept) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (!PRUNE_DIRS.has(e.name)) walk(resolve(dir, e.name), accept);
        } else if (accept(e.name)) {
          newest = Math.max(newest, statSync(resolve(dir, e.name)).mtimeMs);
        }
      }
    };
    const md = (n) => n.endsWith('.md');
    walk(resolve(repoRoot, 'content'), md);
    walk(resolve(repoRoot, 'docs'), md);
    walk(resolve(repoRoot, 'workspace'), md);
    walk(fisherKnowledgeDir(repoRoot), (n) => n.endsWith('.jsonl'));
    return idxMtime >= newest;
  } catch { return false; }
}

export const isQmdAvailable = (repoRoot) => isQmdInstalled(repoRoot) && isQmdIndexBuilt(repoRoot);

// Point-of-use recommendation: when a member runs a real query without qmd
// installed, nudge them to enable it — at most once/day, silenced once installed.
// Writes to stderr so JSON stdout stays clean. Throttle marker lives in the
// gitignored .hey/, so each machine nudges independently. Never throws.
export function recommendQmdInstall(repoRoot) {
  if (isQmdInstalled(repoRoot)) return;
  try {
    const marker = resolve(repoRoot, '.hey/qmd-install-hint');
    const today = new Date().toISOString().slice(0, 10);
    let last = '';
    try { last = readFileSync(marker, 'utf8').trim(); } catch { /* first run */ }
    if (last === today) return;
    mkdirSync(resolve(repoRoot, '.hey'), { recursive: true });
    writeFileSync(marker, today);
    process.stderr.write(
      '\nTip: enable local semantic search for much better question & keyword results.\n' +
      '  one-time: ./hey index build --qmd   (~318MB, fully local, opt-in; macOS: brew install sqlite)\n' +
      '  why: decision_adr-qmd-local-retrieval-backend / note_qmd-benchmark-2026-06-02\n\n'
    );
  } catch { /* a hint must never break search */ }
}

// Prioritize qmd: ensure the index reflects current content before a query.
// Returns false only when qmd isn't installed (caller → lexical). When installed
// but stale, refreshes in place (incremental, ~seconds) rather than serving a
// stale index or dropping to lexical. Throws only on a genuine build failure
// (caller catches → lexical).
export async function ensureFreshIndex(repoRoot, { log = () => {} } = {}) {
  if (!isQmdInstalled(repoRoot)) return false;
  // The index can remain fresh across a Node/platform change while native qmd
  // dependencies become unloadable. Validate/repair the runtime before every
  // qmd-backed search, not only when an index rebuild happens to be needed.
  ensureQmdInstalled(repoRoot, { log });
  if (!isQmdIndexBuilt(repoRoot) || !isQmdIndexFresh(repoRoot)) {
    await buildQmdIndex(repoRoot, { log });
  }
  return true;
}
