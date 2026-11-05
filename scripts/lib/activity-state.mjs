import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { generateUlid } from './scaffold.mjs';

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonFile(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function activityStateRoot(repoRoot, config) {
  return resolve(repoRoot, config.runtime?.state_dir ?? '.hey/external-activity');
}

export function logStatePath(repoRoot, config, workspace, date) {
  return resolve(activityStateRoot(repoRoot, config), 'logs', workspace, `${date}.json`);
}

export function loadLogState(repoRoot, config, workspace, date) {
  return readJsonFile(logStatePath(repoRoot, config, workspace, date), { workspace, date, items: [] });
}

export function saveLogState(repoRoot, config, workspace, date, state) {
  writeJsonFile(logStatePath(repoRoot, config, workspace, date), state);
}

export function candidateDir(repoRoot, config) {
  return resolve(activityStateRoot(repoRoot, config), 'candidates');
}

export function listCandidates(repoRoot, config, status = null) {
  const dir = candidateDir(repoRoot, config);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJsonFile(join(dir, name), null))
    .filter(Boolean)
    .filter((candidate) => !status || candidate.status === status)
    .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
}

export function writeCandidate(repoRoot, config, candidate) {
  const dir = candidateDir(repoRoot, config);
  ensureDir(dir);
  const id = candidate.id ?? `candidate_${generateUlid().toLowerCase()}`;
  const next = {
    ...candidate,
    id,
    updated_at: new Date().toISOString(),
  };
  writeJsonFile(join(dir, `${id}.json`), next);
  return next;
}

export function appendEventHistory(repoRoot, config, events) {
  const historyPath = resolve(activityStateRoot(repoRoot, config), 'events.jsonl');
  ensureDir(dirname(historyPath));
  for (const event of events) {
    appendFileSync(historyPath, JSON.stringify(event) + '\n', 'utf8');
  }
}

function activitySignatureStatePath(repoRoot, config) {
  return resolve(activityStateRoot(repoRoot, config), 'processed-signatures.json');
}

export function loadActivitySignatureState(repoRoot, config) {
  const state = readJsonFile(activitySignatureStatePath(repoRoot, config), { signatures: {} });
  return {
    ...state,
    signatures: state && typeof state.signatures === 'object' && state.signatures ? state.signatures : {},
  };
}

function saveActivitySignatureState(repoRoot, config, state) {
  writeJsonFile(activitySignatureStatePath(repoRoot, config), state);
}

export function markActivitySignatures(repoRoot, config, signatures, stage, metadata = {}) {
  const unique = [...new Set((signatures ?? []).map(s).filter(Boolean))];
  if (unique.length === 0) return { marked: 0 };

  const now = new Date().toISOString();
  const state = loadActivitySignatureState(repoRoot, config);
  for (const signature of unique) {
    state.signatures[signature] = {
      ...(state.signatures[signature] ?? {}),
      ...metadata,
      signature,
      last_stage: stage,
      [`${stage}_at`]: now,
    };
  }
  state.updated_at = now;
  saveActivitySignatureState(repoRoot, config, state);
  return { marked: unique.length };
}

// ── Knowledge index (durable, git-tracked pointers) ──────────────────────────

function knowledgeDir(repoRoot) {
  return resolve(repoRoot, 'workspace', 'fisher', 'knowledge');
}

function knowledgeFilePath(repoRoot, date) {
  const month = String(date ?? '').slice(0, 7); // YYYY-MM
  return resolve(knowledgeDir(repoRoot), `${month || 'unknown'}.jsonl`);
}

function s(value) {
  if (value == null || value === 'null') return '';
  return String(value).trim();
}

function normalizeKnowledgeEvent(event) {
  const ev = event?.event_data ?? event ?? {};
  return {
    source: s(ev.source).toLowerCase(),
    object_id: s(ev.object_id),
    object_type: s(ev.object_type),
    object_title: s(ev.object_title ?? ev.title),
    object_url: s(ev.object_url ?? ev.url),
    actor: s(ev.actor),
    workspace_owner: s(ev.workspace_owner).toLowerCase(),
    summary: s(ev.summary),
    changed_at: s(ev.changed_at ?? ev.time) || new Date().toISOString(),
    kst_date: s(ev.kst_date ?? ev.date),
    signature: s(ev.signature),
  };
}

function missingKnowledgeFields(entry) {
  return ['source', 'object_id', 'title', 'date', 'signature'].filter((field) => !s(entry[field]));
}

function isValidKnowledgeEntry(entry) {
  return entry && missingKnowledgeFields(entry).length === 0;
}

function isExcludedKnowledgeEntry(entry) {
  return s(entry?.source).toLowerCase() === 'github' &&
    s(entry?.object_type).toLowerCase() === 'github-commit';
}

const STATUS_RANK = {
  rejected: 6,
  revoked: 6,
  linked: 5,
  pending: 3,
  indexed: 2,
};

function mergeArray(left, right) {
  return [...new Set([...(left ?? []), ...(right ?? [])].map(s).filter(Boolean))];
}

function statusRank(entry) {
  return STATUS_RANK[entry?.status] ?? 1;
}

function entryDateMs(entry) {
  const ms = Date.parse(entry?.changed_at);
  return Number.isNaN(ms) ? 0 : ms;
}

export function mergeKnowledgeEntry(existing, incoming) {
  if (!existing) return incoming;
  const terminal = existing.status === 'revoked' || existing.status === 'rejected' ||
    incoming.status === 'revoked' || incoming.status === 'rejected';
  const terminalStatus = existing.status === 'revoked' || existing.status === 'rejected'
    ? existing.status
    : incoming.status;
  const incomingWins = statusRank(incoming) > statusRank(existing) ||
    (statusRank(incoming) === statusRank(existing) && entryDateMs(incoming) >= entryDateMs(existing));
  const base = incomingWins ? existing : incoming;
  const overlay = incomingWins ? incoming : existing;
  const next = {
    ...base,
    ...Object.fromEntries(Object.entries(overlay).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value != null && value !== '';
    })),
    id: existing.id || incoming.id,
    actors: mergeArray(existing.actors, incoming.actors),
    topics: mergeArray(existing.topics, incoming.topics),
    linked_artifact: incoming.linked_artifact ?? existing.linked_artifact ?? null,
  };
  if (terminal) {
    next.status = terminalStatus;
    next.linked_artifact = null;
  }
  if (next.status === 'linked' && !next.linked_artifact) {
    next.status = 'indexed';
    next.relevance_score = Number((Number(next.relevance_score || 0.5) / 1.2).toFixed(6));
  }
  return next;
}

function knowledgeEntryKey(entry) {
  if (s(entry?.signature)) return `signature:${s(entry.signature)}`;
  if (s(entry?.source) && s(entry?.object_id) && s(entry?.date)) {
    return `object:${s(entry.source).toLowerCase()}:${s(entry.object_id)}:${s(entry.date)}`;
  }
  return null;
}

function normalizeKnowledgeEntry(entry) {
  return {
    ...entry,
    source: s(entry.source).toLowerCase(),
    object_id: s(entry.object_id),
    object_type: s(entry.object_type),
    title: s(entry.title),
    summary: s(entry.summary),
    url: s(entry.url),
    actors: Array.isArray(entry.actors) ? mergeArray([], entry.actors) : [],
    workspace_owner: s(entry.workspace_owner).toLowerCase(),
    date: s(entry.date),
    changed_at: s(entry.changed_at),
    topics: Array.isArray(entry.topics) ? mergeArray([], entry.topics) : [],
    classification: s(entry.classification),
    status: s(entry.status) || 'indexed',
    linked_artifact: s(entry.linked_artifact) || null,
    agent_reason: s(entry.agent_reason),
    repository: s(entry.repository),
    branch: s(entry.branch),
    path: s(entry.path),
    content: s(entry.content),
    relevance_score: Number(entry.relevance_score) || 0.5,
    signature: s(entry.signature),
  };
}

function computeRelevanceScore(classification, confidence) {
  const c = Number(confidence) || 0;
  switch (classification) {
    case 'skip': return Math.max(0.05, 1.0 - c);
    case 'match': return c * 0.6;
    case 'distill': return c * 0.7;
    default: return 0.5;
  }
}

export function appendKnowledgeEntry(repoRoot, entry) {
  if (!isValidKnowledgeEntry(entry) || isExcludedKnowledgeEntry(entry)) return null;

  const path = knowledgeFilePath(repoRoot, entry.date);
  ensureDir(dirname(path));
  appendFileSync(path, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

export function buildKnowledgeEntry({ event, classification, confidence, agentReason, status, linkedArtifact = null }) {
  const normalized = normalizeKnowledgeEvent(event);
  const entry = {
    id: `kn_${generateUlid().toLowerCase()}`,
    source: normalized.source,
    object_id: normalized.object_id,
    object_type: normalized.object_type,
    title: normalized.object_title,
    summary: normalized.summary,
    url: normalized.object_url,
    actors: [normalized.actor].filter(Boolean),
    workspace_owner: normalized.workspace_owner,
    date: normalized.kst_date,
    changed_at: normalized.changed_at,
    topics: [],
    classification,
    status: status ?? (classification === 'skip' ? 'indexed' : 'pending'),
    linked_artifact: linkedArtifact,
    agent_reason: agentReason ?? '',
    relevance_score: computeRelevanceScore(classification, confidence),
    signature: normalized.signature,
  };
  if (!isValidKnowledgeEntry(entry)) return null;
  return {
    ...entry,
  };
}

export function updateKnowledgeEntryStatus(repoRoot, signature, status, linkedArtifact) {
  const dir = knowledgeDir(repoRoot);
  if (!existsSync(dir)) return false;
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().reverse();
  let target = null;
  for (const file of files) {
    const filePath = join(dir, file);
    const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const normalized = normalizeKnowledgeEntry(entry);
        if (isExcludedKnowledgeEntry(normalized)) continue;
        if (entry.signature === signature) {
          target = mergeKnowledgeEntry(target, normalized);
        }
      } catch { /* skip malformed */ }
    }
  }
  if (!target) return false;

  const next = {
    ...target,
    id: `kn_${generateUlid().toLowerCase()}`,
    status,
    linked_artifact: status === 'revoked' || status === 'rejected' ? null : (linkedArtifact ?? target.linked_artifact ?? null),
    changed_at: new Date().toISOString(),
  };
  if (status === 'linked') {
    next.relevance_score = computeRelevanceScore(next.classification, 1.0) * 1.2;
  }
  if (status === 'revoked') {
    next.relevance_score = Number((Number(target.relevance_score || 0.5) / 1.2).toFixed(6));
  }
  appendKnowledgeEntry(repoRoot, next);
  return true;
}

export function loadMergedKnowledgeEntries(repoRoot) {
  const dir = knowledgeDir(repoRoot);
  if (!existsSync(dir)) return [];

  const byKey = new Map();
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  for (const file of files) {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = normalizeKnowledgeEntry(JSON.parse(line));
        if (!isValidKnowledgeEntry(entry) || isExcludedKnowledgeEntry(entry)) continue;
        const key = knowledgeEntryKey(entry);
        if (!key) continue;
        byKey.set(key, mergeKnowledgeEntry(byKey.get(key), entry));
      } catch {
        console.warn(`[knowledge] skipping malformed knowledge line in ${file}`);
      }
    }
  }
  return [...byKey.values()];
}

function ageHours(timestamp, now) {
  const ms = Date.parse(timestamp ?? '');
  if (Number.isNaN(ms)) return Infinity;
  return (now.getTime() - ms) / 3_600_000;
}

export function collectActivitySignatureSets(repoRoot, config, { now = new Date(), preparedTtlHours = 6 } = {}) {
  const prepared = new Set();
  const finalized = new Set();
  const state = loadActivitySignatureState(repoRoot, config);

  for (const [signature, entry] of Object.entries(state.signatures)) {
    if (entry?.finalized_at) finalized.add(signature);
    if (entry?.prepared_at && ageHours(entry.prepared_at, now) <= preparedTtlHours) prepared.add(signature);
  }

  for (const candidate of listCandidates(repoRoot, config)) {
    for (const event of candidate.events ?? []) {
      if (event?.signature) finalized.add(event.signature);
    }
  }

  for (const entry of loadMergedKnowledgeEntries(repoRoot)) {
    if (entry.signature) finalized.add(entry.signature);
  }

  return {
    prepared,
    finalized,
    processed: new Set([...prepared, ...finalized]),
  };
}

export function inspectKnowledgeCompaction(repoRoot) {
  const dir = knowledgeDir(repoRoot);
  if (!existsSync(dir)) {
    return {
      raw_rows: 0,
      logical_rows: 0,
      superseded_rows: 0,
      superseded_ratio: 0,
      files: 0,
      bytes: 0,
    };
  }

  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  let bytes = 0;
  const rawRows = files.reduce((count, file) => {
    const content = readFileSync(join(dir, file), 'utf8');
    bytes += Buffer.byteLength(content, 'utf8');
    return count + content.split('\n').filter(Boolean).length;
  }, 0);
  const logicalRows = loadMergedKnowledgeEntries(repoRoot).length;
  const supersededRows = Math.max(0, rawRows - logicalRows);
  return {
    raw_rows: rawRows,
    logical_rows: logicalRows,
    superseded_rows: supersededRows,
    superseded_ratio: rawRows > 0 ? Number((supersededRows / rawRows).toFixed(6)) : 0,
    files: files.length,
    bytes,
  };
}

export function compactKnowledgeEntries(repoRoot) {
  const dir = knowledgeDir(repoRoot);
  if (!existsSync(dir)) return { read: 0, written: 0, files: 0 };

  const entries = loadMergedKnowledgeEntries(repoRoot);
  const byMonth = new Map();
  for (const entry of entries.sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)) || a.signature.localeCompare(b.signature))) {
    const month = entry.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(entry);
  }

  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const read = files.reduce((count, file) => count + readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).length, 0);
  for (const file of files) rmSync(join(dir, file), { force: true });
  for (const [month, rows] of [...byMonth.entries()].sort()) {
    writeFileSync(join(dir, `${month}.jsonl`), rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  }

  return { read, written: entries.length, files: byMonth.size };
}
