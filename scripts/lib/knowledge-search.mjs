import { resolve } from 'node:path';
import { textScore, recencyScore } from './retrieval.mjs';
import { queryCatalog, buildCatalogDatabase, catalogDbNeedsBuild } from './catalog-db.mjs';

function ensureDb(repoRoot, dbPath) {
  if (catalogDbNeedsBuild(repoRoot, dbPath)) buildCatalogDatabase(repoRoot, dbPath);
}

function tryParseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function buildKnowledgeSearchDoc(entry) {
  const topics = typeof entry.topics === 'string' ? tryParseJson(entry.topics, []) : (entry.topics ?? []);
  const actors = typeof entry.actors === 'string' ? tryParseJson(entry.actors, []) : (entry.actors ?? []);
  return {
    text: [
      entry.title ?? '',
      entry.summary ?? '',
      topics.join(' '),
      actors.join(' '),
    ].filter(Boolean).join(' '),
  };
}

export function searchKnowledge(query, filters = {}, options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  ensureDb(repoRoot, options.dbPath);

  const limit = options.limit ?? 20;
  const minRelevance = filters.min_relevance ?? 0.15;
  const includePending = filters.include_pending ?? false;

  const conditions = [];
  const params = [];

  if (includePending) {
    conditions.push("status IN ('indexed', 'linked', 'pending')");
  } else {
    conditions.push("status IN ('indexed', 'linked')");
  }

  conditions.push('relevance_score >= ?');
  params.push(minRelevance);

  if (filters.source) {
    conditions.push('source = ?');
    params.push(filters.source);
  }

  if (filters.owner && filters.owner !== '*') {
    conditions.push('workspace_owner = ?');
    params.push(filters.owner);
  }

  if (filters.date_from) {
    conditions.push('date >= ?');
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conditions.push('date <= ?');
    params.push(filters.date_to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM knowledge ${where} ORDER BY changed_at DESC LIMIT 500`;

  let rows;
  try {
    rows = queryCatalog({ repoRoot, sql, params, dbPath: options.dbPath });
  } catch {
    return [];
  }

  if (!query || !String(query).trim()) {
    return rows.slice(0, limit).map((r) => formatResult(r));
  }

  const scored = rows.map((row) => {
    const searchDoc = buildKnowledgeSearchDoc(row);
    const item = { id: row.id, title: row.title ?? '' };
    const ts = textScore(item, query, searchDoc);
    const rs = recencyScore(row.changed_at);
    const rel = Number(row.relevance_score) || 0;
    const score = ts * 0.5 + rs * 0.2 + rel * 0.3;
    return { row, score, textScore: ts };
  })
    .filter(({ textScore: ts }) => ts > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ row, score }) => formatResult(row, score));
}

// Async knowledge-search entry point. Currently lexical-only; a local semantic
// backend (qmd) attaches here per decision_adr-qmd-local-retrieval-backend.
export async function searchKnowledgeAdaptive(query, filters = {}, options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const limit = options.limit ?? 20;
  return searchKnowledge(query, filters, { ...options, repoRoot, limit });
}

function formatResult(row, score) {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    summary: row.summary,
    url: row.url,
    date: row.date,
    workspace_owner: row.workspace_owner,
    classification: row.classification,
    status: row.status,
    linked_artifact: row.linked_artifact ?? null,
    relevance_score: Number(row.relevance_score) || 0,
    score: score != null ? Number(score.toFixed(4)) : undefined,
  };
}
