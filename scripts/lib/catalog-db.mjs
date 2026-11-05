import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadManifest, loadIndexJson, buildIndexes, manifestNeedsBuild } from './indexer.mjs';
import { loadMergedKnowledgeEntries } from './activity-state.mjs';

const DEFAULT_DB_PATH = '.hey/catalog.sqlite';

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;

    DROP TABLE IF EXISTS items;
    DROP TABLE IF EXISTS relations;
    DROP TABLE IF EXISTS entities;
    DROP TABLE IF EXISTS tags;
    DROP TABLE IF EXISTS sources;
    DROP TABLE IF EXISTS feedback;

    CREATE TABLE items (
      id TEXT PRIMARY KEY,
      type TEXT,
      title TEXT,
      path TEXT,
      created_at TEXT,
      updated_at TEXT,
      area TEXT,
      status TEXT,
      priority TEXT,
      phase TEXT,
      owner TEXT,
      due_date TEXT,
      timeline_start TEXT,
      timeline_end TEXT,
      iteration TEXT,
      meta_json TEXT,
      content_hash TEXT
    );

    CREATE INDEX idx_items_type ON items(type);
    CREATE INDEX idx_items_area ON items(area);
    CREATE INDEX idx_items_status ON items(status);
    CREATE INDEX idx_items_owner ON items(owner);
    CREATE INDEX idx_items_updated_at ON items(updated_at);

    CREATE TABLE relations (
      src_id TEXT,
      rel_type TEXT,
      dst_id TEXT
    );

    CREATE INDEX idx_relations_dst ON relations(dst_id);
    CREATE INDEX idx_relations_src ON relations(src_id);

    CREATE TABLE entities (
      item_id TEXT,
      entity_type TEXT,
      canonical TEXT
    );

    CREATE INDEX idx_entities_canonical ON entities(canonical);

    CREATE TABLE tags (
      item_id TEXT,
      tag TEXT
    );

    CREATE INDEX idx_tags_tag ON tags(tag);

    CREATE TABLE sources (
      item_id TEXT,
      kind TEXT,
      ref TEXT,
      note TEXT
    );

    CREATE TABLE feedback (
      target_id TEXT,
      adopt INTEGER,
      reject INTEGER,
      warn INTEGER,
      score REAL
    );

    DROP TABLE IF EXISTS knowledge;
    CREATE TABLE knowledge (
      id TEXT PRIMARY KEY,
      source TEXT,
      object_id TEXT,
      object_type TEXT,
      title TEXT,
      summary TEXT,
      url TEXT,
      actors TEXT,
      workspace_owner TEXT,
      date TEXT,
      changed_at TEXT,
      topics TEXT,
      classification TEXT,
      status TEXT,
      linked_artifact TEXT,
      agent_reason TEXT,
      relevance_score REAL,
      signature TEXT UNIQUE
    );
    CREATE INDEX idx_knowledge_source ON knowledge(source);
    CREATE INDEX idx_knowledge_date ON knowledge(date);
    CREATE INDEX idx_knowledge_status ON knowledge(status);
    CREATE INDEX idx_knowledge_owner ON knowledge(workspace_owner);
    CREATE INDEX idx_knowledge_relevance ON knowledge(relevance_score);
  `);
}

function insertRows(db, manifest, feedbackAgg) {
  const insertItem = db.prepare(`
    INSERT INTO items (
      id, type, title, path, created_at, updated_at, area, status, priority,
      phase, owner, due_date, timeline_start, timeline_end, iteration, meta_json, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRelation = db.prepare('INSERT INTO relations (src_id, rel_type, dst_id) VALUES (?, ?, ?)');
  const insertEntity = db.prepare('INSERT INTO entities (item_id, entity_type, canonical) VALUES (?, ?, ?)');
  const insertTag = db.prepare('INSERT INTO tags (item_id, tag) VALUES (?, ?)');
  const insertProv = db.prepare('INSERT INTO sources (item_id, kind, ref, note) VALUES (?, ?, ?, ?)');
  const insertFeedback = db.prepare('INSERT INTO feedback (target_id, adopt, reject, warn, score) VALUES (?, ?, ?, ?, ?)');

  db.exec('BEGIN');
  try {
    for (const item of manifest) {
      insertItem.run(
        item.id,
        item.type,
        item.title,
        item.path,
        item.created_at,
        item.updated_at,
        item.area,
        item.status,
        item.priority,
        item.phase,
        item.owner,
        item.due_date,
        item.timeline_start,
        item.timeline_end,
        item.iteration,
        JSON.stringify(item),
        item.hashes.content_hash
      );

      for (const relation of item.relations_out) {
        insertRelation.run(item.id, relation.type, relation.target);
      }

      for (const entity of item.entities) {
        insertEntity.run(item.id, entity.type, entity.canonical);
      }

      for (const tag of (item.tags ?? [])) {
        insertTag.run(item.id, tag);
      }

      for (const prov of item.sources) {
        const kind = prov.kind ?? (prov.url ? 'url' : null);
        const ref = prov.ref ?? prov.url ?? null;
        const note = prov.note ?? prov.title ?? null;
        insertProv.run(item.id, kind, ref, note);
      }
    }

    for (const [targetId, feedback] of Object.entries(feedbackAgg)) {
      insertFeedback.run(targetId, feedback.adopt, feedback.reject, feedback.warn, feedback.score);
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function hasRequiredKnowledgeMetadata(entry) {
  return ['source', 'object_id', 'title', 'date', 'signature']
    .every((field) => String(entry?.[field] ?? '').trim() !== '');
}

function insertKnowledgeRows(db, entries) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO knowledge (
      id, source, object_id, object_type, title, summary, url, actors,
      workspace_owner, date, changed_at, topics, classification, status,
      linked_artifact, agent_reason, relevance_score, signature
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const e of entries.filter(hasRequiredKnowledgeMetadata)) {
    stmt.run(
      e.id ?? '',
      e.source ?? '',
      e.object_id ?? '',
      e.object_type ?? '',
      e.title ?? '',
      e.summary ?? '',
      e.url ?? '',
      JSON.stringify(e.actors ?? []),
      e.workspace_owner ?? '',
      e.date ?? '',
      e.changed_at ?? '',
      JSON.stringify(e.topics ?? []),
      e.classification ?? '',
      e.status ?? '',
      e.linked_artifact ?? null,
      e.agent_reason ?? '',
      e.relevance_score ?? 0.5,
      e.signature ?? ''
    );
  }
}

function normalizeSqlParam(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value instanceof Uint8Array) {
    return value;
  }
  return String(value);
}

function isReaderQuery(sql) {
  return /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql);
}

export function resolveDbPath(repoRoot, dbPath = DEFAULT_DB_PATH) {
  return resolve(repoRoot, dbPath);
}

export function buildCatalogDatabase(repoRoot, dbPath = DEFAULT_DB_PATH) {
  const root = resolve(repoRoot ?? process.cwd());
  const path = resolveDbPath(root, dbPath);
  ensureParent(path);

  const manifest = loadManifest(root);
  const feedbackAgg = loadIndexJson(root, 'feedback_agg.json', {});

  const knowledgeEntries = loadMergedKnowledgeEntries(root);

  const db = new DatabaseSync(path);
  try {
    createSchema(db);
    insertRows(db, manifest, feedbackAgg);
    if (knowledgeEntries.length > 0) {
      insertKnowledgeRows(db, knowledgeEntries);
    }
  } finally {
    db.close();
  }

  return path;
}

export function queryCatalog({ repoRoot, sql, params = [], dbPath = DEFAULT_DB_PATH }) {
  const root = resolve(repoRoot ?? process.cwd());
  const path = resolveDbPath(root, dbPath);

  if (!existsSync(path)) {
    throw new Error(`Catalog DB not found at ${path}. Run 'hey db build' first.`);
  }

  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const stmt = db.prepare(sql);
    const normalized = params.map((value) => normalizeSqlParam(value));
    if (isReaderQuery(sql)) {
      return stmt.all(...normalized);
    }

    stmt.run(...normalized);
    return [];
  } finally {
    db.close();
  }
}

export function dbExists(repoRoot, dbPath = DEFAULT_DB_PATH) {
  return existsSync(resolveDbPath(resolve(repoRoot ?? process.cwd()), dbPath));
}

function newestJsonlMtime(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .reduce((max, name) => Math.max(max, statSync(join(dir, name)).mtimeMs), 0);
}

function fileMtime(path) {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

export function catalogDbNeedsBuild(repoRoot, dbPath = DEFAULT_DB_PATH) {
  const root = resolve(repoRoot ?? process.cwd());
  const path = resolveDbPath(root, dbPath);
  if (!existsSync(path)) return true;

  const dbMtime = statSync(path).mtimeMs;
  const newestSource = Math.max(
    fileMtime(resolve(root, 'index', 'manifest.jsonl')),
    fileMtime(resolve(root, 'index', 'feedback_agg.json')),
    newestJsonlMtime(resolve(root, 'workspace', 'fisher', 'knowledge')),
  );

  return newestSource > dbMtime;
}

export function readDbFile(repoRoot, dbPath = DEFAULT_DB_PATH) {
  return readFileSync(resolveDbPath(resolve(repoRoot ?? process.cwd()), dbPath));
}

export function ensureCatalogFresh(repoRoot, dbPath = DEFAULT_DB_PATH) {
  const root = resolve(repoRoot ?? process.cwd());
  const rebuilt = { manifest: false, db: false };

  if (manifestNeedsBuild(root)) {
    try {
      buildIndexes(root);
      rebuilt.manifest = true;
    } catch (error) {
      // buildIndexes throws when validateRepository surfaces any load-issue
      // (which it tags `level: 'error'`, even for things `./hey validate`
      // happily prints with exit-code 1). A read-only `db query` shouldn't
      // be blocked by that — fall through to whatever manifest already
      // exists and let the caller surface the build error via stderr so
      // the user knows to run `./hey validate`.
      console.error(`[ensureCatalogFresh] manifest rebuild skipped: ${error.message}. Falling back to existing index/manifest.jsonl. Run \`./hey validate\` for details.`);
    }
  }

  if (catalogDbNeedsBuild(root, dbPath)) {
    try {
      buildCatalogDatabase(root, dbPath);
      rebuilt.db = true;
    } catch (error) {
      console.error(`[ensureCatalogFresh] catalog rebuild skipped: ${error.message}. Falling back to existing .hey/catalog.sqlite.`);
    }
  }

  return rebuilt;
}
