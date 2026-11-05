import { resolve } from 'node:path';
import { loadManifest, loadIndexJson } from './indexer.mjs';

const HAS_CJK = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const SEARCH_EQUIVALENT_GROUPS = [
  ['vault', '볼트'],
  ['rebalancing', '리밸런싱'],
  ['strategy', '전략'],
  ['allocation', '배분', '할당'],
  ['liquidity', '유동성'],
  ['bridge', '브리지'],
];

const SEARCH_EQUIVALENTS = (() => {
  const map = new Map();
  for (const group of SEARCH_EQUIVALENT_GROUPS) {
    const normalizedGroup = [...new Set(group.map((term) => normalizeSearchText(term)).filter(Boolean))];
    for (const term of normalizedGroup) {
      map.set(term, normalizedGroup.filter((candidate) => candidate !== term));
    }
  }
  return map;
})();

function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenizeQuery(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  return [...new Set(normalized.split(' ').filter((term) =>
    term.length >= 3 || (term.length >= 2 && HAS_CJK.test(term))
  ))];
}

function expandedTerms(term) {
  return [term, ...(SEARCH_EQUIVALENTS.get(term) ?? [])];
}

function expandedQueryGroups(query) {
  return tokenizeQuery(query).map((term) => [...new Set(expandedTerms(term))]);
}

function expandedQueryPhrases(normalizedQuery) {
  const terms = normalizedQuery.split(' ').filter(Boolean);
  if (terms.length === 0) return [];

  const optionsPerTerm = terms.map((term) => [...new Set(expandedTerms(term))].slice(0, 4));
  const limit = 24;
  const phrases = [];

  function walk(index, acc) {
    if (phrases.length >= limit) return;
    if (index === optionsPerTerm.length) {
      phrases.push(acc.join(' '));
      return;
    }
    for (const option of optionsPerTerm[index]) {
      walk(index + 1, [...acc, option]);
      if (phrases.length >= limit) return;
    }
  }

  walk(0, []);
  return [...new Set(phrases)];
}

function tokenMatches(term, terms) {
  return terms.some((candidate) => {
    if (candidate === term) return true;
    const minLen = (HAS_CJK.test(term) || HAS_CJK.test(candidate)) ? 2 : 4;
    if (term.length < minLen || candidate.length < minLen) return false;
    return candidate.startsWith(term) || term.startsWith(candidate);
  });
}

function buildFallbackSearchDoc(item) {
  return {
    text: [
      item.id,
      item.title,
      item.type,
      item.area ?? '',
      item.status ?? '',
      item.owner ?? '',
      item.author ?? '',
      item.entities.map((entity) => entity.canonical).join(' '),
      (item.sources ?? []).map((s) => `${s.kind} ${s.ref}`).join(' ')
    ]
      .filter(Boolean)
      .join(' ')
  };
}

export function textScore(item, query, searchDoc) {
  if (!query) return 0;

  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;
  const queryPhrases = expandedQueryPhrases(normalizedQuery);

  const doc = searchDoc ?? buildFallbackSearchDoc(item);
  const idText = normalizeSearchText(item.id);
  const titleText = normalizeSearchText(item.title);
  const corpus = normalizeSearchText(doc.text);
  const corpusTerms = corpus ? corpus.split(' ').filter(Boolean) : [];
  const titleTerms = normalizeSearchText(`${item.id} ${item.title}`).split(' ').filter(Boolean);

  if (!corpus) return 0;
  if (queryPhrases.some((phrase) => idText.includes(phrase))) return 1;
  if (queryPhrases.some((phrase) => titleText.includes(phrase))) return 0.95;
  if (queryPhrases.some((phrase) => corpus.includes(phrase))) return 0.85;

  const termGroups = expandedQueryGroups(query);
  if (termGroups.length === 0) return 0;

  let matchedTerms = 0;
  let titleMatches = 0;

  for (const alternatives of termGroups) {
    if (alternatives.some((term) => tokenMatches(term, corpusTerms))) matchedTerms += 1;
    if (alternatives.some((term) => tokenMatches(term, titleTerms))) titleMatches += 1;
  }

  if (matchedTerms === 0) return 0;

  const coverage = matchedTerms / termGroups.length;
  if (termGroups.length > 1 && coverage < 0.6 && matchedTerms < 2) return 0;

  const titleBoost = Math.min(0.15, titleMatches / termGroups.length * 0.15);
  return Math.min(0.84, coverage * 0.7 + titleBoost);
}

function buildSearchDocumentMap(repoRoot) {
  const payload = loadIndexJson(repoRoot, 'search.flex.json', { documents: [] });
  const documents = Array.isArray(payload?.documents) ? payload.documents : [];
  const map = new Map();

  for (const document of documents) {
    if (!document || typeof document.id !== 'string') continue;
    map.set(document.id, document);
  }

  return map;
}

function textQueryProvided(query) {
  return String(query ?? '').trim() !== '';
}

function textMatchScore(item, query, searchDocs, mode) {
  const queryScore = textScore(item, query, searchDocs.get(item.id));
  const score =
    queryScore * 0.7 +
    (item.feedback?.score ?? 0.5) * 0.15 +
    recencyScore(item.updated_at) * 0.15;

  return {
    queryScore,
    score: score * modeMultiplier(item, mode)
  };
}

export function recencyScore(updatedAt) {
  const updatedMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedMs)) return 0;

  const ageDays = (Date.now() - updatedMs) / (1000 * 60 * 60 * 24);
  if (ageDays <= 1) return 1;
  if (ageDays <= 7) return 0.9;
  if (ageDays <= 30) return 0.7;
  if (ageDays <= 90) return 0.5;
  if (ageDays <= 180) return 0.3;
  return 0.1;
}

function modeMultiplier(item, mode) {
  if (mode === 'explore') {
    if (['note', 'meeting'].includes(item.type)) return 1.2;
    return 1;
  }

  if ((item.sources ?? []).length === 0) return 0.6;
  if (['decision', 'task'].includes(item.type)) return 1.2;
  return 1;
}

function applyFilters(items, filters) {
  return items.filter((item) => {
    if (filters.type && item.type !== filters.type) return false;
    if (filters.area && item.area !== filters.area) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.owner && item.owner !== filters.owner) return false;
    if (filters.author && item.author !== filters.author && item.owner !== filters.author) return false;
    if (filters.entity && !item.entities.some((entity) => entity.canonical === filters.entity)) return false;
    return true;
  });
}

function randomContextId() {
  const stamp = Date.now().toString(36).toUpperCase().padStart(10, '0').slice(-10);
  const tail = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `cp_${stamp}${tail}`;
}

export function searchRepository(query, filters = {}, options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const mode = options.mode ?? 'explore';
  const limit = options.limit ?? 20;

  const manifest = loadManifest(repoRoot);
  const searchDocs = buildSearchDocumentMap(repoRoot);
  const filtered = applyFilters(manifest, filters);
  const hasQuery = textQueryProvided(query);

  return filtered
    .map((item) => {
      const { queryScore, score } = textMatchScore(item, query, searchDocs, mode);
      return { item, queryScore, score };
    })
    .filter(({ queryScore }) => !hasQuery || queryScore > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score }) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      area: item.area,
      status: item.status,
      owner: item.owner,
      score: Number(score.toFixed(4))
    }));
}

// Async search entry point. Uses the local qmd semantic backend when available
// (auto-detect), else lexical. Per decision_adr-qmd-local-retrieval-backend.
// backend: 'auto' (default) | 'lexical' | 'qmd'. Any qmd failure → lexical.
export async function searchRepositoryAdaptive(query, filters = {}, options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const limit = options.limit ?? 20;
  const backend = options.backend ?? process.env.HEY_SEARCH_BACKEND ?? 'auto';

  if (textQueryProvided(query) && backend !== 'lexical') {
    const qmd = await tryQmdSearch(repoRoot, query, filters, limit);
    if (qmd) return qmd;
  }
  return searchRepository(query, filters, { ...options, repoRoot, limit });
}

// Returns qmd-ranked artifact results in the same shape as searchRepository, or
// null to signal "fall back to lexical" (qmd not installed, no results, or any
// error). A stale index is refreshed in place rather than dropped. qmd-backend
// is dynamically imported so the lexical path never loads it.
async function tryQmdSearch(repoRoot, query, filters, limit) {
  try {
    const { ensureFreshIndex, searchQmdHybrid } = await import('./qmd-backend.mjs');
    // Prioritize qmd: refresh a stale index in place (incremental, ~seconds)
    // rather than serving lexical. Returns false only when qmd isn't installed.
    if (!(await ensureFreshIndex(repoRoot))) return null;
    const hits = await searchQmdHybrid(repoRoot, query, { limit: Math.max(limit, 50) });
    if (!hits.length) return null;
    const byId = new Map(loadManifest(repoRoot).map((m) => [m.id, m]));
    const scoreById = new Map(hits.map((h) => [h.id, h.score]));
    const items = hits.map((h) => byId.get(h.id)).filter(Boolean); // drop non-artifacts
    return applyFilters(items, filters).slice(0, limit).map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      area: item.area,
      status: item.status,
      owner: item.owner,
      score: scoreById.get(item.id) ?? 0,
    }));
  } catch (error) {
    if (process.env.HEY_DEBUG) console.error(`[qmd] search failed, using lexical: ${error.message}`);
    return null;
  }
}

export function compileContextPack(input) {
  const repoRoot = resolve(input.repoRoot ?? process.cwd());
  const manifest = loadManifest(repoRoot);
  const backlinks = loadIndexJson(repoRoot, 'backlinks.json', {});
  const searchDocs = buildSearchDocumentMap(repoRoot);

  const timeWindowDays = input.time_window_days ?? 90;
  const oldest = Date.now() - timeWindowDays * 24 * 60 * 60 * 1000;
  const typesAllowed = input.types_allowed ?? ['task', 'decision', 'meeting', 'note', 'playbook'];

  const candidatesBase = manifest.filter((item) => {
    if (input.area && item.area !== input.area) return false;
    if (!typesAllowed.includes(item.type)) return false;

    const updatedMs = Date.parse(item.updated_at);
    if (!Number.isNaN(updatedMs) && updatedMs < oldest) return false;

    if (input.entities?.length) {
      const entitySet = new Set(item.entities.map((entity) => entity.canonical));
      const hasMatch = input.entities.some((entity) => entitySet.has(entity));
      if (!hasMatch) return false;
    }

    return true;
  });

  const ranked = candidatesBase
    .map((item) => {
      const queryBonus = input.query ? textScore(item, input.query, searchDocs.get(item.id)) : 0;
      const score =
        (item.feedback?.score ?? 0.5) * 0.4 +
        recencyScore(item.updated_at) * 0.4 +
        queryBonus * 0.2;

      return { item, score: score * modeMultiplier(item, input.mode) };
    })
    .sort((a, b) => b.score - a.score);

  const seedLimit = input.limit ?? 12;
  const seeds = ranked.slice(0, seedLimit);
  const expanded = new Map();

  for (const seed of seeds) {
    expanded.set(seed.item.id, {
      item: seed.item,
      score: seed.score,
      why: 'direct rank match'
    });

    const linked = new Set([
      ...seed.item.links_out,
      ...seed.item.relations_out.map((relation) => relation.target),
      ...(backlinks[seed.item.id] ?? [])
    ]);

    for (const linkedId of linked) {
      const linkedItem = manifest.find((entry) => entry.id === linkedId);
      if (!linkedItem) continue;
      const score = seed.score * 0.75;
      const existing = expanded.get(linkedId);
      if (!existing || existing.score < score) {
        expanded.set(linkedId, {
          item: linkedItem,
          score,
          why: `graph neighbor of ${seed.item.id}`
        });
      }
    }
  }

  const ordered = [...expanded.values()].sort((a, b) => b.score - a.score).slice(0, seedLimit);
  const openQuestions = [];
  const requiredActions = [];
  const sourcesBundle = new Set();

  for (const entry of ordered) {
    if ((entry.item.unresolved_entities ?? []).length > 0) {
      openQuestions.push(`${entry.item.id}: unresolved entities -> ${entry.item.unresolved_entities.join(', ')}`);
    }

    if (input.mode === 'decide' && (entry.item.sources ?? []).length === 0) {
      requiredActions.push(`${entry.item.id}: add sources before decision-grade use`);
    }

    for (const prov of entry.item.sources ?? []) {
      sourcesBundle.add(prov.ref);
    }
  }

  return {
    id: randomContextId(),
    mode: input.mode,
    intent: input.intent,
    scope: {
      area: input.area,
      time_window_days: timeWindowDays,
      types_allowed: typesAllowed,
    },
    candidates: ordered.map(({ item, score, why }) => ({
      id: item.id,
      why,
      snippet: `${item.title} (${item.type})`,
      score: Number(score.toFixed(4))
    })),
    open_questions: [...new Set(openQuestions)],
    required_actions: [...new Set(requiredActions)],
    sources_bundle: [...sourcesBundle]
  };
}

export async function searchUnified(query, filters = {}, options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const limit = options.limit ?? 20;

  // Artifact results
  const artifactFilters = {};
  if (filters.type) artifactFilters.type = filters.type;
  if (filters.area) artifactFilters.area = filters.area;
  if (filters.status) artifactFilters.status = filters.status;
  if (filters.owner && filters.owner !== '*') artifactFilters.owner = filters.owner;
  const artifactResults = (await searchRepositoryAdaptive(query, artifactFilters, {
    repoRoot,
    limit,
    mode: options.mode ?? 'explore',
    backend: options.backend,
  }))
    .map((r) => ({ ...r, result_type: 'artifact' }));

  // Knowledge results (dynamic import to avoid circular deps at module load)
  let knowledgeResults = [];
  try {
    const { searchKnowledgeAdaptive } = await import('./knowledge-search.mjs');
    knowledgeResults = (await searchKnowledgeAdaptive(query, filters, {
      repoRoot,
      limit,
    }))
      .map((r) => ({ ...r, result_type: 'knowledge', score: Number(((r.score ?? 0) * 0.8).toFixed(4)) }));
  } catch {
    // knowledge-search not available or DB missing — continue with artifacts only
  }

  // Dedup: if knowledge entry has linked_artifact matching an artifact result, drop the knowledge entry
  const artifactIds = new Set(artifactResults.map((r) => r.id));
  const deduped = knowledgeResults.filter((r) => !r.linked_artifact || !artifactIds.has(r.linked_artifact));

  return [...artifactResults, ...deduped]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}
