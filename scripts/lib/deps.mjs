import { resolve } from 'node:path';
import { loadIndexJson, loadManifest } from './indexer.mjs';
import { normalizeText, uniqueStrings } from './text-utils.mjs';

const PATH_SCORE = 3.0;
const REPO_SCORE = 2.0;
const ENTITY_SCORE = 1.5;
const AREA_SCORE = 1.0;
const TERM_SCORE = 1.4;

function normalizeArray(values) {
  if (!values) return [];
  if (Array.isArray(values)) return uniqueStrings(values);
  return uniqueStrings(String(values).split(','));
}

function normalizePath(value) {
  return String(value ?? '').trim().replace(/\\/g, '/');
}

function extractPathsFromText(text) {
  const matches = String(text ?? '').match(/[A-Za-z0-9_./-]*\/[A-Za-z0-9_./*-]+/g) ?? [];
  return uniqueStrings(matches.map(normalizePath));
}

const HAS_CJK = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function tokenize(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return [...new Set(normalized.split(' ').filter((token) =>
    token.length >= 3 || (token.length >= 2 && HAS_CJK.test(token))
  ))];
}

function phraseMatch(text, phrase) {
  const normalizedText = normalizeText(text);
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedText || !normalizedPhrase) return false;
  if (normalizedText.includes(normalizedPhrase)) return true;

  const textTokens = new Set(tokenize(normalizedText));
  const phraseTokens = tokenize(normalizedPhrase);
  if (phraseTokens.length < 2) return false;
  return phraseTokens.every((token) => textTokens.has(token));
}

function fuzzyPhraseMatch(inputTokens, phrase) {
  const phraseTokens = tokenize(phrase);
  if (phraseTokens.length === 0) return false;

  const scores = phraseTokens.map((token) => bestTokenScore(token, inputTokens));
  const matched = scores.filter((score) => score > 0);
  if (matched.length === 0) return false;

  if (phraseTokens.length === 1) {
    return matched[0] >= 0.75;
  }

  const avg = matched.reduce((sum, score) => sum + score, 0) / matched.length;
  return matched.length >= Math.min(phraseTokens.length, 2) && avg >= 0.7;
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern) {
  let out = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // consume optional trailing slash: **/ means "any directory prefix"
        if (pattern[i + 2] === '/') {
          out += '(.+/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }

    out += escapeRegex(char);
  }

  out += '$';
  return new RegExp(out);
}

function pathGlobMatch(inputPath, pattern) {
  return globToRegex(normalizePath(pattern)).test(normalizePath(inputPath));
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // Early exit when length difference alone exceeds any useful threshold
  if (Math.abs(a.length - b.length) > 3) return Math.abs(a.length - b.length);

  const prev = Array.from({ length: b.length + 1 }, (_, idx) => idx);
  const next = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(
        prev[j] + 1,
        next[j - 1] + 1,
        prev[j - 1] + cost
      );
    }

    for (let j = 0; j < next.length; j += 1) {
      prev[j] = next[j];
    }
  }

  return prev[b.length];
}

function trigramSet(value) {
  const normalized = `  ${normalizeText(value)}  `;
  const grams = new Set();
  for (let i = 0; i <= normalized.length - 3; i += 1) {
    grams.add(normalized.slice(i, i + 3));
  }
  return grams;
}

function trigramJaccard(a, b) {
  const aSet = trigramSet(a);
  const bSet = trigramSet(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;

  let intersection = 0;
  for (const gram of aSet) {
    if (bSet.has(gram)) intersection += 1;
  }

  return intersection / (aSet.size + bSet.size - intersection);
}

function bestTokenScore(token, candidateTokens) {
  let best = 0;

  for (const candidate of candidateTokens) {
    if (candidate === token) return 1.0;
    if (candidate.startsWith(token) || token.startsWith(candidate) || candidate.includes(token) || token.includes(candidate)) {
      best = Math.max(best, 0.85);
    }

    if (token.length >= 5 && token.length <= 7 && levenshteinDistance(token, candidate) <= 1) {
      best = Math.max(best, 0.75);
    }

    if (token.length >= 8 && levenshteinDistance(token, candidate) <= 2) {
      best = Math.max(best, 0.65);
    }

    if (trigramJaccard(token, candidate) >= 0.5) {
      best = Math.max(best, 0.55);
    }
  }

  return best;
}

function buildInputHints(input) {
  const intent = String(input.intent ?? '').trim();
  const normalizedIntent = normalizeText(intent);

  return {
    intent,
    normalized_intent: normalizedIntent,
    repos: normalizeArray(input.repos).map((value) => normalizeText(value)),
    paths: uniqueStrings([...normalizeArray(input.paths).map(normalizePath), ...extractPathsFromText(intent)]),
    entities: normalizeArray(input.entities).map((value) => normalizeText(value)),
    area: input.area ? String(input.area).trim() : null,
    tokens: tokenize(intent),
  };
}

function isValidDependencyRecord(record) {
  return record && typeof record === 'object' && typeof record.id === 'string' && typeof record.title === 'string';
}

function loadDependencyPayload(repoRoot) {
  const payload = loadIndexJson(repoRoot, 'dependencies.json', { generated_at: null, dependencies: [] });
  if (!Array.isArray(payload?.dependencies)) return { generated_at: null, dependencies: [] };
  return {
    generated_at: payload.generated_at ?? null,
    dependencies: payload.dependencies.filter(isValidDependencyRecord),
  };
}

function buildCandidateTokens(record) {
  return tokenize([record.title, record.body_text, ...(record.search_terms ?? [])].join(' '));
}

function obligationKey(obligation) {
  return `${normalizeText(obligation.title)}|${normalizeText((obligation.actions ?? []).join(' '))}`;
}

function buildRelatedArtifacts(record, manifestById, backlinks) {
  const linkedIds = new Set([
    ...(record.relations_out ?? []).map((relation) => relation.target),
    ...(record.links_out ?? []),
    ...(backlinks[record.id] ?? []),
  ]);

  const related = [];
  for (const id of linkedIds) {
    const item = manifestById.get(id);
    if (!item) continue;
    related.push({
      id: item.id,
      title: item.title,
      type: item.type,
      path: item.path,
      context: 'graph neighbor',
    });
  }

  related.sort((a, b) => a.id.localeCompare(b.id));
  return related;
}

function scoreDependency(record, hints, semanticById = null) {
  const evidenceTypes = new Set();
  const reasons = [];
  let structuredScore = 0;

  const exactPathMatches = [];
  for (const inputPath of hints.paths) {
    for (const pattern of record.contract?.triggers?.paths ?? []) {
      if (pathGlobMatch(inputPath, pattern)) {
        exactPathMatches.push(`${inputPath} -> ${pattern}`);
      }
    }
  }
  if (exactPathMatches.length > 0) {
    structuredScore += PATH_SCORE;
    evidenceTypes.add('path');
    reasons.push(`exact path match (${exactPathMatches[0]})`);
  }

  const repoTerms = uniqueStrings([...(record.contract?.triggers?.repos ?? []), ...(record.trigger_repo_terms ?? [])]);
  const repoMatch =
    hints.repos.some((repo) => repoTerms.some((term) => normalizeText(term) === repo)) ||
    repoTerms.some((term) => phraseMatch(hints.normalized_intent, term) || fuzzyPhraseMatch(hints.tokens, term));
  if (repoMatch) {
    structuredScore += REPO_SCORE;
    evidenceTypes.add('repo');
    reasons.push('repo or repo-slug match');
  }

  const entityTerms = uniqueStrings([...(record.contract?.triggers?.entities ?? []), ...(record.trigger_entity_terms ?? [])]);
  const entityMatch =
    hints.entities.some((entity) => entityTerms.some((term) => normalizeText(term) === entity)) ||
    entityTerms.some((term) => phraseMatch(hints.normalized_intent, term) || fuzzyPhraseMatch(hints.tokens, term));
  if (entityMatch) {
    structuredScore += ENTITY_SCORE;
    evidenceTypes.add('entity');
    reasons.push('entity match');
  }

  if (hints.area && (record.contract?.triggers?.areas ?? []).some((area) => area === hints.area)) {
    structuredScore += AREA_SCORE;
    evidenceTypes.add('area');
    reasons.push(`area match (${hints.area})`);
  }

  const termPhrases = uniqueStrings([...(record.contract?.triggers?.intents ?? []), ...(record.contract?.triggers?.terms ?? [])]);
  if (termPhrases.some((term) => phraseMatch(hints.normalized_intent, term) || fuzzyPhraseMatch(hints.tokens, term))) {
    structuredScore += TERM_SCORE;
    evidenceTypes.add('term');
    reasons.push('trigger term or intent phrase match');
  }

  const candidateTokens = buildCandidateTokens(record);
  const tokenScores = hints.tokens
    .map((token) => ({ token, score: bestTokenScore(token, candidateTokens) }))
    .filter(({ score }) => score > 0);
  const topScores = tokenScores
    .map(({ score }) => score)
    .sort((a, b) => b - a)
    .slice(0, 6);
  const textScore = topScores.length > 0 ? topScores.reduce((sum, score) => sum + score, 0) / topScores.length : 0;
  if (textScore > 0) {
    evidenceTypes.add('text');
    reasons.push(`${tokenScores.length} fuzzy lexical token match(es)`);
  }

  // Optional semantic recall channel (qmd). Lets a free-text intent surface a
  // dependency whose trigger terms don't lexically overlap. Off (0) unless a
  // semanticById map is supplied — preserving the structured-first behavior.
  const semanticScore = semanticById ? (semanticById.get(record.id) ?? 0) : 0;
  if (semanticScore > 0) {
    evidenceTypes.add('semantic');
    reasons.push(`semantic relevance ${semanticScore.toFixed(2)} (qmd)`);
  }

  const totalScore = structuredScore + textScore + semanticScore;
  const accept =
    exactPathMatches.length > 0 ||
    (totalScore >= 2.2 && evidenceTypes.size >= 2) ||
    (totalScore >= 1.8 && tokenScores.length >= 3) ||
    (semanticScore >= 0.75);

  return {
    accept,
    reasons,
    evidence_types: [...evidenceTypes],
    structured_score: Number(structuredScore.toFixed(4)),
    text_score: Number(textScore.toFixed(4)),
    semantic_score: Number(semanticScore.toFixed(4)),
    total_score: Number(totalScore.toFixed(4)),
    matched_tokens: tokenScores.length,
  };
}

function filterDependencyRecord(record, filters) {
  const repo = filters.repo ? normalizeText(filters.repo) : null;
  const area = filters.area ? String(filters.area).trim() : null;
  const entity = filters.entity ? normalizeText(filters.entity) : null;

  if (repo) {
    const repoTerms = new Set(
      [...(record.contract?.triggers?.repos ?? []), ...(record.trigger_repo_terms ?? []), ...(record.obligation_repo_terms ?? [])]
        .map((value) => normalizeText(value))
    );
    if (!repoTerms.has(repo)) return false;
  }

  if (area) {
    const areaTerms = new Set([record.area, ...(record.contract?.triggers?.areas ?? [])].filter(Boolean));
    if (!areaTerms.has(area)) return false;
  }

  if (entity) {
    const entityTerms = new Set(
      [...(record.contract?.triggers?.entities ?? []), ...(record.trigger_entity_terms ?? []), ...(record.obligation_entity_terms ?? [])]
        .map((value) => normalizeText(value))
    );
    if (!entityTerms.has(entity)) return false;
  }

  return true;
}

export function listDependencies(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const payload = loadDependencyPayload(repoRoot);

  return payload.dependencies
    .filter((record) => filterDependencyRecord(record, options))
    .sort((a, b) => (a.updated_at === b.updated_at ? a.id.localeCompare(b.id) : b.updated_at.localeCompare(a.updated_at)))
    .map((record) => ({
      id: record.id,
      title: record.title,
      path: record.path,
      area: record.area || null,
      owner: record.owner || null,
      updated_at: record.updated_at,
      triggers: record.contract?.triggers ?? {},
    }));
}

export function showDependency(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const payload = loadDependencyPayload(repoRoot);
  const record = payload.dependencies.find((entry) => entry.id === options.id);
  if (!record) return null;

  const manifest = loadManifest(repoRoot);
  const manifestById = new Map(manifest.map((item) => [item.id, item]));
  const backlinks = loadIndexJson(repoRoot, 'backlinks.json', {});

  return {
    ...record,
    related_artifacts: buildRelatedArtifacts(record, manifestById, backlinks),
  };
}

export function checkDependencies(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const payload = loadDependencyPayload(repoRoot);
  const hints = buildInputHints(options);
  const manifest = loadManifest(repoRoot);
  const manifestById = new Map(manifest.map((item) => [item.id, item]));
  const backlinks = loadIndexJson(repoRoot, 'backlinks.json', {});
  const limit = Number(options.limit ?? 10);
  const semanticById = options.semanticById ?? null;

  const ranked = payload.dependencies
    .map((record) => {
      const score = scoreDependency(record, hints, semanticById);
      return {
        ...score,
        record,
        related_artifacts: buildRelatedArtifacts(record, manifestById, backlinks),
      };
    })
    .filter((entry) => entry.accept)
    .sort((a, b) => {
      if (b.structured_score !== a.structured_score) return b.structured_score - a.structured_score;
      if (b.total_score !== a.total_score) return b.total_score - a.total_score;
      if (b.record.updated_at !== a.record.updated_at) return b.record.updated_at.localeCompare(a.record.updated_at);
      return a.record.id.localeCompare(b.record.id);
    })
    .slice(0, limit);

  const aggregatedObligations = new Map();
  const aggregatedVerification = new Map();

  for (const match of ranked) {
    for (const obligation of match.record.contract?.obligations ?? []) {
      const key = obligationKey(obligation);
      const existing = aggregatedObligations.get(key);
      if (existing) {
        existing.source_ids.push(match.record.id);
        continue;
      }

      aggregatedObligations.set(key, {
        ...obligation,
        source_ids: [match.record.id],
      });
    }

    for (const check of match.record.contract?.verification ?? []) {
      const key = normalizeText(check);
      const existing = aggregatedVerification.get(key);
      if (existing) {
        existing.source_ids.push(match.record.id);
        continue;
      }

      aggregatedVerification.set(key, {
        check,
        source_ids: [match.record.id],
      });
    }
  }

  return {
    intent: hints.intent,
    hints: {
      repos: hints.repos,
      paths: hints.paths,
      area: hints.area,
      entities: hints.entities,
    },
    matches: ranked.map((match) => ({
      id: match.record.id,
      title: match.record.title,
      path: match.record.path,
      area: match.record.area || null,
      owner: match.record.owner || null,
      score: match.total_score,
      structured_score: match.structured_score,
      text_score: match.text_score,
      matched_tokens: match.matched_tokens,
      evidence_types: match.evidence_types,
      reasons: match.reasons,
      obligations: match.record.contract?.obligations ?? [],
      verification: match.record.contract?.verification ?? [],
      related_artifacts: match.related_artifacts,
    })),
    obligations: [...aggregatedObligations.values()],
    verification: [...aggregatedVerification.values()],
  };
}
