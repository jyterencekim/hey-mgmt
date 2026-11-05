import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readArtifacts, writeArtifact } from './content-io.mjs';
import { buildIndexes, loadManifest, validateRepository } from './indexer.mjs';
import { searchRepository } from './retrieval.mjs';
import { writeCandidate, listCandidates, appendKnowledgeEntry, buildKnowledgeEntry, updateKnowledgeEntryStatus, collectActivitySignatureSets, markActivitySignatures } from './activity-state.mjs';
import { materializeDistillCandidate, readRawSourceText } from './activity-distill.mjs';
import { processReflectionDecisions, classifyReflection } from './activity-reflection.mjs';
import { writeObservation } from './activity-observations.mjs';

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function todayKst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizeExternalRefEntries(value) {
  const refs = [];
  if (!value) return refs;

  if (typeof value === 'string') {
    const [source, objectId] = value.split(':');
    if (source && objectId) refs.push({ source, object_id: objectId });
    return refs;
  }

  if (Array.isArray(value)) {
    for (const entry of value) refs.push(...normalizeExternalRefEntries(entry));
    return refs;
  }

  if (typeof value === 'object') {
    if (typeof value.source === 'string' && typeof value.object_id === 'string') {
      refs.push({ source: value.source, object_id: value.object_id });
      return refs;
    }

    for (const [source, ids] of Object.entries(value)) {
      if (Array.isArray(ids)) {
        for (const id of ids) {
          if (typeof id === 'string') refs.push({ source, object_id: id });
          if (id && typeof id === 'object' && typeof id.object_id === 'string') refs.push({ source, object_id: id.object_id });
        }
        continue;
      }
      if (typeof ids === 'string') refs.push({ source, object_id: ids });
    }
  }

  return refs;
}

function uniqueOrdered(values) {
  return [...new Set(values.filter(Boolean))];
}

const KG_RELATIONS = new Set(['parent_of', 'child_of', 'blocks', 'blocked_by', 'mentions', 'supports', 'implements', 'implemented_by', 'evidenced_by']);

function kgPath(repoRoot, config) {
  if (config.matching?.kg_path) return resolve(repoRoot, config.matching.kg_path);
  if (process.env.KG_GRAPH_PATH) return resolve(process.env.KG_GRAPH_PATH);
  const localKg = resolve(repoRoot, '.kg', 'graph.sqlite');
  if (existsSync(localKg)) return localKg;
  return resolve(repoRoot, '..', 'superearn-intelligence', '.kg', 'graph.sqlite');
}

function kgRows(db, table) {
  try { return db.prepare(`SELECT * FROM ${table}`).all(); } catch { return []; }
}

function kgValue(row, names) {
  for (const name of names) if (row[name] !== undefined && row[name] !== null) return row[name];
  return null;
}

// The projection is disposable and read-only. Keep this adapter tolerant of
// additive schema changes in superearn-intelligence and fail closed on errors.
function readKgNeighbors({ repoRoot, config, seedIds }) {
  const path = kgPath(repoRoot, config);
  if (!existsSync(path) || !seedIds.length) return [];
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const nodes = kgRows(db, 'nodes');
    const nodeById = new Map(nodes.map((node) => [String(kgValue(node, ['id', 'node_id'])), node]));
    const edges = [...kgRows(db, 'edges'), ...kgRows(db, 'edges_derived')];
    const seeds = new Set(seedIds.map(String));
    const found = new Map();
    for (const edge of edges) {
      const src = String(kgValue(edge, ['src', 'src_id']) ?? '');
      const dst = String(kgValue(edge, ['dst', 'dst_id']) ?? '');
      const rel = String(kgValue(edge, ['rel', 'rel_type', 'relationship']) ?? '').toLowerCase();
      if (!KG_RELATIONS.has(rel)) continue;
      let neighborId = null;
      if (seeds.has(src)) neighborId = dst;
      else if (seeds.has(dst)) neighborId = src;
      if (!neighborId || seeds.has(neighborId)) continue;
      const node = nodeById.get(neighborId);
      if (!node) continue;
      const status = String(kgValue(edge, ['status', 'state']) ?? 'accepted').toLowerCase();
      const existing = found.get(neighborId);
      if (!existing || status === 'proposed' || status === 'heuristic_signal') {
        found.set(neighborId, { node, relation: rel, edge_status: status });
      }
    }
    return [...found.values()].map(({ node, relation, edge_status }) => {
      const id = String(kgValue(node, ['id', 'node_id']));
      const type = kgValue(node, ['kind', 'type']) ?? null;
      const title = kgValue(node, ['title', 'name']) ?? id;
      return {
        id: id.startsWith('mgmt:') ? id.slice('mgmt:'.length) : id,
        type,
        title,
        status: kgValue(node, ['status', 'lifecycle']) ?? null,
        owner: kgValue(node, ['owner']) ?? null,
        area: kgValue(node, ['area']) ?? null,
        score: 0.25,
        kg_relation: relation,
        kg_edge_status: edge_status,
        kg_distance: 1,
      };
    });
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch { /* read-only cleanup */ }
  }
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const left = Date.parse(a.changed_at);
    const right = Date.parse(b.changed_at);
    if (left === right) return String(a.signature).localeCompare(String(b.signature));
    return left - right;
  });
}

function mergeEvents(existing = [], incoming = []) {
  const bySignature = new Map();
  for (const event of [...existing, ...incoming]) {
    bySignature.set(event.signature, event);
  }
  return sortEvents([...bySignature.values()]);
}

function candidatePrimaryDay(events) {
  return uniqueOrdered(events.map((event) => event.kst_date))[0] ?? null;
}

function contentCandidateKey(artifactId, day) {
  return `content_update:${artifactId}:${day}`;
}

function unmatchedCandidateKey(event) {
  return `unmatched_mapping:${event.source}:${event.object_id}:${event.kst_date}`;
}

function distillCandidateKey(event) {
  return `distill_review:${event.source}:${event.object_id}:${event.kst_date}`;
}

function resolveArtifactApprovers(artifact, fallbackApprover) {
  const approvers = [];
  if (artifact.type === 'decision' && Array.isArray(artifact.frontmatter?.owners)) {
    approvers.push(...artifact.frontmatter.owners);
  } else if (typeof artifact.frontmatter?.owner === 'string') {
    approvers.push(artifact.frontmatter.owner);
  }
  if (fallbackApprover) approvers.push(fallbackApprover);
  return uniqueOrdered(approvers);
}

function resolveUnmatchedApprovers(events, fallbackApprover) {
  const approvers = [];
  const latest = sortEvents(events).at(-1);
  if (latest?.workspace_owner) approvers.push(latest.workspace_owner);
  if (fallbackApprover) approvers.push(fallbackApprover);
  return uniqueOrdered(approvers);
}

function chooseStatusPatch(events) {
  const hinted = sortEvents(events)
    .map((event) => event.content_hint?.status)
    .filter(Boolean);
  return hinted.at(-1) ?? null;
}

function candidateOwner(approvers, fallbackApprover) {
  return approvers[0] ?? fallbackApprover ?? 'jared';
}

function markSupersededCandidates(repoRoot, config, candidateKey, keepId) {
  const openCandidates = listCandidates(repoRoot, config, 'open')
    .filter((candidate) => candidate.candidate_key === candidateKey && candidate.id !== keepId);

  for (const candidate of openCandidates) {
    writeCandidate(repoRoot, config, {
      ...candidate,
      status: 'superseded',
      superseded_at: new Date().toISOString(),
      superseded_by: keepId,
    });
  }
}

function artifactRefs(artifact, config) {
  return normalizeExternalRefEntries(artifact.frontmatter?.[config.matching?.extension_field ?? 'x_external_refs'])
    .map((entry) => `${String(entry.source).toLowerCase()}:${entry.object_id}`);
}

function normalizeDraftText(value) {
  return String(value ?? '')
    .replace(/<!-- candidate:[^>]+-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function applyDraftUpdate(body, candidate) {
  const draft = candidate.update_draft;
  if (!draft?.content || !String(draft.content).trim()) return body;

  const section = `## ${draft.section}`;
  const marker = `<!-- candidate:${candidate.id} -->`;
  if (body.includes(marker)) return body;

  const entry = `${marker}\n${draft.content}`;
  const normalizedDraft = normalizeDraftText(draft.content);

  // Try to append to existing section
  if (body.includes(section)) {
    const idx = body.indexOf(section) + section.length;
    // Find the end of this section (next ## or end of body)
    const rest = body.slice(idx);
    const nextSection = rest.search(/\n## /);
    const insertAt = nextSection >= 0 ? idx + nextSection : body.length;
    const sectionBody = body.slice(idx, insertAt);
    if (normalizedDraft && normalizeDraftText(sectionBody).includes(normalizedDraft)) return body;
    return `${body.slice(0, insertAt).trimEnd()}\n${entry}\n${body.slice(insertAt)}`;
  }

  // Section doesn't exist — create it before External Signals or at the end
  const externalIdx = body.indexOf('## External Signals');
  if (externalIdx >= 0) {
    return `${body.slice(0, externalIdx).trimEnd()}\n\n${section}\n${entry}\n\n${body.slice(externalIdx)}`;
  }
  return `${body.trimEnd()}\n\n${section}\n${entry}\n`;
}

function appendExternalSignals(body, candidate) {
  const header = '## External Signals';
  const lines = candidate.events.map((event) => `- ${event.kst_date} — [${event.source}] ${event.object_title} | URL: ${event.object_url} | Summary: ${event.summary}`);
  const marker = `<!-- candidate:${candidate.id} -->`;
  if (body.includes(marker)) return body;
  const normalizedBody = normalizeDraftText(body);
  if (lines.length > 0 && lines.every((line) => normalizedBody.includes(normalizeDraftText(line)))) return body;

  const chunk = `${marker}\n${lines.join('\n')}`;
  if (!body.includes(header)) {
    return `${body.trimEnd()}\n\n${header}\n${chunk}\n`;
  }

  const idx = body.indexOf(header) + header.length;
  return `${body.slice(0, idx)}\n${chunk}\n${body.slice(idx)}`;
}

function buildCandidateSignature(artifactId, events) {
  return stableHash([artifactId, ...events.map((event) => event.signature).sort()]);
}

function decisionSignatures(decision) {
  return uniqueOrdered(decision?.event_signatures ?? []);
}

function filterReplayDecisions({ repoRoot, config, decisions }) {
  const { finalized } = collectActivitySignatureSets(repoRoot, config);
  const kept = [];
  const skipped = [];
  const seen = new Set();

  for (const decision of decisions) {
    const signatures = decisionSignatures(decision);
    if (signatures.length === 0) {
      kept.push(decision);
      continue;
    }

    const fresh = signatures.filter((signature) => !finalized.has(signature) && !seen.has(signature));
    if (fresh.length === 0) {
      skipped.push(...signatures);
      continue;
    }
    skipped.push(...signatures.filter((signature) => finalized.has(signature) || seen.has(signature)));
    for (const signature of fresh) seen.add(signature);
    kept.push({ ...decision, event_signatures: fresh });
  }

  return {
    decisions: kept,
    skipped_replayed_signatures: uniqueOrdered(skipped),
  };
}

// All candidate generation is delegated to the Hermes agent via the
// prepare-candidates → agent reasoning → finalize-candidates pipeline.
// This function only ingests events; no candidates are created here.
export async function generateContentUpdateCandidates({ repoRoot, config, events }) {
  if (events.length > 0) {
    console.log(`[candidates] ${events.length} event(s) ingested — awaiting Hermes agent classification`);
  }

  return [];
}

export function applyContentUpdateCandidate({ repoRoot, config, candidateId }) {
  const candidate = listCandidates(repoRoot, config).find((entry) => entry.id === candidateId);
  if (!candidate) throw new Error(`candidate not found: ${candidateId}`);
  if (candidate.status !== 'open') throw new Error(`candidate ${candidateId} is not open`);
  if (candidate.candidate_type !== 'content_update') {
    throw new Error(`candidate ${candidateId} is not a content_update candidate`);
  }

  const artifact = readArtifacts(resolve(repoRoot, 'content')).find((entry) => entry.id === candidate.artifact_id);
  if (!artifact) throw new Error(`artifact not found: ${candidate.artifact_id}`);

  const originalRaw = readFileSync(artifact.filePath, 'utf8');
  const nextFrontmatter = { ...artifact.frontmatter, updated_at: todayKst() };
  if (candidate.patch?.status && artifact.type === 'task') {
    nextFrontmatter.status = candidate.patch.status;
  }

  let nextBody;
  if (candidate.update_draft?.has_new_info && candidate.update_draft.section && candidate.update_draft.content) {
    // LLM-generated content update: append new info to the appropriate section
    nextBody = applyDraftUpdate(artifact.body, candidate);
  } else {
    // Fallback: append event metadata only
    nextBody = appendExternalSignals(artifact.body, candidate);
  }

  writeArtifact(artifact.filePath, nextFrontmatter, nextBody);
  const validation = validateRepository(repoRoot);
  if (!validation.report.ok) {
    writeFileSync(artifact.filePath, originalRaw, 'utf8');
    throw new Error(`candidate apply would break validation: ${validation.report.issues.map((issue) => issue.message).join('; ')}`);
  }

  // Update knowledge entry status to 'linked' on approval
  for (const ev of candidate.events ?? []) {
    if (ev.signature) updateKnowledgeEntryStatus(repoRoot, ev.signature, 'linked', candidate.artifact_id);
  }

  return writeCandidate(repoRoot, config, {
    ...candidate,
    status: 'applied',
    applied_at: new Date().toISOString(),
  });
}

export function applyDistillReviewCandidate({ repoRoot, config, candidateId }) {
  const candidate = listCandidates(repoRoot, config).find((entry) => entry.id === candidateId);
  if (!candidate) throw new Error(`candidate not found: ${candidateId}`);
  if (candidate.status !== 'open') throw new Error(`candidate ${candidateId} is not open`);
  if (candidate.candidate_type !== 'distill_review') {
    throw new Error(`candidate ${candidateId} is not a distill_review candidate`);
  }

  let artifactPath = null;
  let mirrorPath = null;
  try {
    const materialized = materializeDistillCandidate({ repoRoot, candidate });
    artifactPath = resolve(repoRoot, materialized.artifact_path);
    mirrorPath = materialized.mirror_path ? resolve(repoRoot, materialized.mirror_path) : null;
    const validation = validateRepository(repoRoot);
    if (!validation.report.ok) {
      throw new Error(`candidate apply would break validation: ${validation.report.issues.map((issue) => issue.message).join('; ')}`);
    }

    // Update knowledge entry status to 'linked' on distill approval
    for (const ev of candidate.events ?? []) {
      if (ev.signature) updateKnowledgeEntryStatus(repoRoot, ev.signature, 'linked', materialized.artifact_id);
    }

    return writeCandidate(repoRoot, config, {
      ...candidate,
      status: 'applied',
      applied_at: new Date().toISOString(),
      artifact_id: materialized.artifact_id,
      artifact_path: materialized.artifact_path,
      artifact_type: candidate.draft?.type ?? candidate.artifact_type ?? null,
      mirror_path: materialized.mirror_path ?? null,
    });
  } catch (error) {
    if (artifactPath) rmSync(artifactPath, { force: true });
    if (mirrorPath) rmSync(mirrorPath, { force: true });
    throw error;
  }
}

export function applyApprovedCandidate({ repoRoot, config, candidateId }) {
  const candidate = listCandidates(repoRoot, config).find((entry) => entry.id === candidateId);
  if (!candidate) throw new Error(`candidate not found: ${candidateId}`);
  if (candidate.candidate_type === 'content_update') {
    return applyContentUpdateCandidate({ repoRoot, config, candidateId });
  }
  if (candidate.candidate_type === 'distill_review') {
    return applyDistillReviewCandidate({ repoRoot, config, candidateId });
  }
  throw new Error(`candidate ${candidateId} is not approvable`);
}

export function rejectContentUpdateCandidate({ repoRoot, config, candidateId }) {
  const candidate = listCandidates(repoRoot, config).find((entry) => entry.id === candidateId);
  if (!candidate) throw new Error(`candidate not found: ${candidateId}`);

  // Update knowledge entry status to 'rejected'
  for (const ev of candidate.events ?? []) {
    if (ev.signature) updateKnowledgeEntryStatus(repoRoot, ev.signature, 'rejected', null);
  }

  return writeCandidate(repoRoot, config, {
    ...candidate,
    status: 'rejected',
    rejected_at: new Date().toISOString(),
  });
}

// ── Agent-oriented pipeline: prepare (exact match) + finalize (agent decisions) ──

// All events are sent to the Hermes agent for classification.
// No code-level exact matching or rule-based filtering — the LLM decides everything.
export function prepareCandidatesForAgent({ repoRoot, config, events }) {
  let searchIndexReady = false;
  try { buildIndexes(repoRoot); searchIndexReady = true; } catch { /* skip */ }
  const manifest = loadManifest(repoRoot);
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const limit = Math.min(10, Math.max(1, Number(config.matching?.llm_match_candidate_limit ?? 10)));
  const preparedTtlHours = Number(config.idempotency?.prepared_ttl_hours ?? 6);
  const { processed } = collectActivitySignatureSets(repoRoot, config, { preparedTtlHours });

  const needsAgentDecision = [];
  const seen = new Set();
  for (const event of events) {
    if (event.signature) {
      if (processed.has(event.signature) || seen.has(event.signature)) continue;
      seen.add(event.signature);
    }

    const sourceText = readRawSourceText(event.raw_ref);
    const query = [event.object_title, event.summary].filter(Boolean).join(' ');

    let searchCandidates = [];
    if (searchIndexReady) {
      const keywordResults = searchRepository(query, {}, { repoRoot, limit: 8, mode: 'explore' });
      const keywordIds = new Set(keywordResults.map((r) => r.id));
      const kgCandidates = readKgNeighbors({
        repoRoot,
        config,
        seedIds: keywordResults.flatMap((r) => [r.id, `mgmt:${r.id}`]),
      }).filter((candidate) => !keywordIds.has(candidate.id));
      const kgIds = new Set(kgCandidates.map((r) => r.id));
      const fallback = manifest
        .filter((m) => !keywordIds.has(m.id) && !kgIds.has(m.id) && ['ready', 'doing', 'blocked', 'plan'].includes(m.status) && Date.parse(m.updated_at) >= cutoff)
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
        .slice(0, Math.max(0, limit - keywordResults.length - kgCandidates.length))
        .map((m) => ({ id: m.id, title: m.title, type: m.type, area: m.area, status: m.status, owner: m.owner, score: 0 }));
      // Text hits retain priority; graph neighbors add structural context, and
      // the existing recent-artifact fallback fills the remaining budget.
      searchCandidates = [...keywordResults, ...kgCandidates, ...fallback].slice(0, limit);
    }

    needsAgentDecision.push({
      event: {
        source: event.source,
        object_id: event.object_id,
        object_type: event.object_type,
        object_title: event.object_title,
        object_url: event.object_url,
        summary: event.summary,
        changed_at: event.changed_at,
        kst_date: event.kst_date,
        signature: event.signature,
        raw_ref: event.raw_ref,
        workspace_owner: event.workspace_owner,
      },
      source_text: sourceText.slice(0, 50000),
      search_candidates: searchCandidates.map((c) => ({
        id: c.id,
        type: c.type,
        title: c.title,
        status: c.status ?? null,
        owner: c.owner ?? null,
        area: c.area ?? null,
        score: c.score ?? null,
        kg_relation: c.kg_relation ?? null,
        kg_edge_status: c.kg_edge_status ?? null,
        kg_distance: c.kg_distance ?? null,
      })),
    });
  }

  markActivitySignatures(
    repoRoot,
    config,
    needsAgentDecision.map((item) => item.event.signature),
    'prepared',
    { source: 'prepare-candidates' },
  );

  return {
    created_candidates: 0,
    candidates: [],
    needs_agent_decision: needsAgentDecision,
  };
}

export function finalizeAgentDecisions({ repoRoot, config, decisions }) {
  const replayFilter = filterReplayDecisions({ repoRoot, config, decisions });
  decisions = replayFilter.decisions;
  const artifacts = readArtifacts(resolve(repoRoot, 'content'));
  const existingOpen = listCandidates(repoRoot, config, 'open');
  const existingByKey = new Map(existingOpen.map((c) => [c.candidate_key, c]));
  const created = [];
  const finalizedSignatures = [];

  for (const decision of decisions) {
    const eventSignatures = decision.event_signatures ?? [];
    finalizedSignatures.push(...eventSignatures);
    // Find the original events from event history that match these signatures
    const allOpen = listCandidates(repoRoot, config);
    // Reconstruct minimal event objects from the decision
    const events = eventSignatures.map((sig) => ({ signature: sig, ...decision._event_data })).filter(Boolean);

    if (decision.decision === 'match' && decision.artifact_id) {
      const artifact = artifacts.find((a) => a.id === decision.artifact_id);
      if (!artifact) throw new Error(`Artifact not found: ${decision.artifact_id}`);

      const matchKey = contentCandidateKey(artifact.id, decision._event_data?.kst_date ?? todayKst());
      const matchExisting = existingByKey.get(matchKey);
      const mergedEvents = mergeEvents(matchExisting?.events, events);
      const signature = buildCandidateSignature(artifact.id, mergedEvents);
      const approvers = resolveArtifactApprovers(artifact, config.approval?.artifact_owner_fallback ?? 'jared');

      const candidate = writeCandidate(repoRoot, config, {
        id: matchExisting?.id,
        candidate_type: 'content_update',
        candidate_key: matchKey,
        signature,
        status: 'open',
        artifact_id: artifact.id,
        artifact_path: artifact.relativePath,
        artifact_type: artifact.type,
        owner: candidateOwner(approvers, config.approval?.artifact_owner_fallback ?? 'jared'),
        approvers,
        approval_policy: 'any_approver',
        reference_day: decision._event_data?.kst_date ?? todayKst(),
        matching_policy: 'llm_semantic_match',
        llm_match: {
          confidence: decision.confidence ?? 0,
          match_reason: decision.match_reason ?? '',
        },
        update_draft: decision.update_draft?.has_new_info ? decision.update_draft : null,
        events: mergedEvents,
        patch: { status: chooseStatusPatch(mergedEvents) },
        created_at: matchExisting?.created_at ?? new Date().toISOString(),
      });
      markSupersededCandidates(repoRoot, config, matchKey, candidate.id);
      created.push(candidate);

    } else if (decision.decision === 'distill') {
      const event = decision._event_data ?? {};
      const distillKey = `distill_review:${event.source ?? 'agent'}:${event.object_id ?? stableHash(eventSignatures)}:${event.kst_date ?? todayKst()}`;
      const distillExisting = existingByKey.get(distillKey);
      const approvers = uniqueOrdered([event.workspace_owner, config.approval?.artifact_owner_fallback ?? 'jared'].filter(Boolean));

      const highlights = decision.summary_points ?? [];
      const artifactType = decision.artifact_type ?? 'note';
      const title = decision.title ?? event.object_title ?? 'Untitled';

      const candidate = writeCandidate(repoRoot, config, {
        id: distillExisting?.id,
        candidate_type: 'distill_review',
        candidate_key: distillKey,
        signature: stableHash([distillKey, ...eventSignatures.sort()]),
        status: 'open',
        artifact_id: null,
        artifact_path: null,
        artifact_type: artifactType,
        owner: candidateOwner(approvers, config.approval?.artifact_owner_fallback ?? 'jared'),
        approvers,
        approval_policy: 'any_approver',
        reference_day: event.kst_date ?? todayKst(),
        matching_policy: 'agent_classification',
        domain_tag: decision.domain_tag ?? null,
        signal_score: Math.round((decision.confidence ?? 0) * 10),
        selection_reason: decision.match_reason ?? 'agent classification',
        suggested_artifact: { type: artifactType, title, owner: 'jared' },
        draft: {
          type: artifactType,
          title,
          summary_points: highlights,
          body: [
            '## Context',
            'Auto-distilled by Hermes agent from external activity. Human approval required.',
            '',
            '## Distilled Summary',
            ...highlights.map((h) => `- ${h}`),
            '',
            '## Source Trace',
            `- Source: \`${event.source ?? 'unknown'}:${event.object_id ?? 'unknown'}\``,
            `- URL: ${event.object_url ?? '-'}`,
          ].join('\n'),
          preview_source_text: decision._source_text?.slice(0, 4000) ?? '',
        },
        unmatched_ref: {
          source: event.source ?? 'unknown',
          object_id: event.object_id ?? 'unknown',
          object_type: event.object_type ?? 'unknown',
          object_title: event.object_title ?? '',
          object_url: event.object_url ?? '',
        },
        resolution: 'human_review_required',
        events,
        patch: null,
        created_at: distillExisting?.created_at ?? new Date().toISOString(),
      });
      markSupersededCandidates(repoRoot, config, distillKey, candidate.id);
      created.push(candidate);
    }

    // Write knowledge entry for ALL decisions (skip, match, distill)
    const knEvent = decision._event_data ?? {};
    if (knEvent.source && knEvent.kst_date) {
      const knEntry = buildKnowledgeEntry({
        event: knEvent,
        classification: decision.decision,
        confidence: decision.confidence ?? 0,
        agentReason: decision.skip_reason ?? decision.match_reason ?? decision.selection_reason ?? '',
        status: decision.decision === 'skip' ? 'indexed' : 'pending',
      });
      try {
        appendKnowledgeEntry(repoRoot, knEntry);
      } catch (err) {
        console.error(`[knowledge] failed to write entry: ${err.message}`);
      }
    }
  }

  markActivitySignatures(repoRoot, config, finalizedSignatures, 'finalized', { source: 'finalize-candidates' });

  return {
    candidates_created: created.length,
    candidates: created,
    skipped_replayed_signatures: replayFilter.skipped_replayed_signatures.length,
  };
}

/**
 * Build a signature→event lookup from events.jsonl.
 * Only loads events matching the requested signatures to bound memory usage.
 * Falls back to scanning the last N lines when no target set is given.
 */
function loadEventIndex(repoRoot, config, targetSignatures = null) {
  const historyPath = resolve(repoRoot, config.runtime?.state_dir ?? '.hey/external-activity', 'events.jsonl');
  if (!existsSync(historyPath)) return new Map();

  const raw = readFileSync(historyPath, 'utf8');
  const index = new Map();
  const targets = targetSignatures ? new Set(targetSignatures) : null;

  // Scan backwards from end for efficiency — most recent events are at the bottom.
  // When we have a target set, keep scanning until we find them all (up to a
  // generous cap) so enrichment doesn't silently drop events that are a few
  // pages back in the log.
  let end = raw.length;
  let found = 0;
  const limit = targets ? Math.max(targets.size * 20, 5000) : 500;

  while (end > 0 && found < limit) {
    const lineStart = raw.lastIndexOf('\n', end - 2) + 1;
    const line = raw.slice(lineStart, end).trim();
    end = lineStart;
    if (!line) continue;
    try {
      const ev = JSON.parse(line);
      const sig = ev.signature;
      if (!sig || index.has(sig)) continue;
      if (targets && !targets.has(sig)) continue;
      index.set(sig, ev);
      found++;
    } catch { /* skip malformed */ }
  }
  return index;
}

/**
 * Merge full event data into a decision's _event_data.
 * Agent decisions often have sparse _event_data (just source + object_id + kst_date).
 * The event index has the complete record (title, url, actor, changed_at, summary).
 */
function enrichDecisionEventData(decision, eventIndex) {
  const sigs = decision.event_signatures ?? [];
  if (sigs.length === 0) return decision;

  // Use first matching signature for the primary event data
  const fullEvent = sigs.reduce((found, sig) => found ?? eventIndex.get(sig), null);
  if (!fullEvent) return decision;

  const existing = decision._event_data ?? {};
  // Agent-provided non-empty values take priority over event history
  const agentOverrides = Object.fromEntries(
    Object.entries(existing).filter(([, v]) => v != null && v !== ''),
  );

  return {
    ...decision,
    _event_data: { ...fullEvent, ...agentOverrides },
  };
}

export function finalizeReflectionDecisions({ repoRoot, config, decisions }) {
  const reflectionConfig = config.reflection ?? {
    promotion_confidence_threshold: 0.8,
    observation_confidence_threshold: 0.5,
  };
  const replayFilter = filterReplayDecisions({ repoRoot, config, decisions });
  decisions = replayFilter.decisions;

  // Enrich decisions with full event data from events.jsonl
  const allSignatures = decisions.flatMap((d) => d.event_signatures ?? []).filter(Boolean);
  const eventIndex = loadEventIndex(repoRoot, config, allSignatures.length > 0 ? allSignatures : null);
  const enrichedDecisions = decisions.map((d) => enrichDecisionEventData(d, eventIndex));

  const { promoted, observed, filtered } = processReflectionDecisions(enrichedDecisions, reflectionConfig);

  let promotedCount = 0;
  let observedCount = 0;

  // Write observations for observed items + knowledge entries
  for (const item of observed) {
    writeObservation(repoRoot, item.observation);
    const entry = buildKnowledgeEntry({
      event: item.observation.event_data ?? item.observation,
      classification: 'observe',
      confidence: 0,
      agentReason: item.observation.reason,
      status: 'indexed',
    });
    appendKnowledgeEntry(repoRoot, entry);
    observedCount++;
  }

  // Auto-promote: write observation + apply content changes + knowledge entry
  for (const item of promoted) {
    const promo = item.promotion;
    const eventData = promo._event_data ?? item.observation.event_data ?? {};
    const signatures = promo.event_signatures ?? [];
    let linkedArtifact = null;

    try {
      if (promo.decision === 'match' && promo.artifact_id) {
        linkedArtifact = promo.artifact_id;
        // Reuse content update logic directly (without candidate wrapper)
        const artifact = readArtifacts(resolve(repoRoot, 'content')).find(a => a.id === promo.artifact_id);
        if (!artifact) throw new Error(`Artifact not found: ${promo.artifact_id}`);
        if (artifact && promo.update_draft?.has_new_info) {
          const originalRaw = readFileSync(artifact.filePath, 'utf8');
          const nextFrontmatter = { ...artifact.frontmatter, updated_at: todayKst() };
          const fakeCandidate = {
            id: `reflection_${signatures[0] ?? Date.now()}`,
            update_draft: promo.update_draft,
            events: signatures.map(s => ({ signature: s })),
          };
          const nextBody = applyDraftUpdate(artifact.body, fakeCandidate);
          writeArtifact(artifact.filePath, nextFrontmatter, nextBody);

          const validation = validateRepository(repoRoot);
          if (!validation.report.ok) {
            writeFileSync(artifact.filePath, originalRaw, 'utf8');
            throw new Error(`reflection promotion would break validation: ${validation.report.issues.map((issue) => issue.message).join('; ')}`);
          }
        }

      } else if (promo.decision === 'distill') {
        // Reuse distill materialization
        const fakeDraftCandidate = {
          id: `reflection_distill_${signatures[0] ?? Date.now()}`,
          candidate_type: 'distill_review',
          artifact_type: promo.artifact_type ?? 'note',
          draft: {
            type: promo.artifact_type ?? 'note',
            title: promo.title ?? eventData.object_title ?? 'Untitled',
            summary_points: promo.summary_points ?? [],
            body: promo._source_text ?? '',
          },
          events: signatures.map(s => {
            const indexedEvent = eventIndex.get(s) ?? {};
            const event = { ...indexedEvent, ...eventData };
            return {
              signature: s,
              source: event.source,
              object_id: event.object_id,
              object_type: event.object_type,
              object_title: event.object_title,
              object_url: event.object_url,
              actor: event.actor,
              changed_at: event.changed_at,
              kst_date: event.kst_date,
              summary: event.summary,
              raw_ref: event.raw_ref,
              workspace_owner: event.workspace_owner,
            };
          }),
          suggested_artifact: {
            type: promo.artifact_type ?? 'note',
            title: promo.title ?? eventData.object_title ?? 'Untitled',
            owner: eventData.workspace_owner ?? config.approval?.artifact_owner_fallback ?? 'jared',
          },
          domain_tag: promo.domain_tag,
          unmatched_ref: {
            source: eventData.source,
            object_id: eventData.object_id,
            object_type: eventData.object_type,
            object_title: eventData.object_title,
            object_url: eventData.object_url,
          },
        };

        const materialized = materializeDistillCandidate({ repoRoot, candidate: fakeDraftCandidate });
        const validation = validateRepository(repoRoot);
        if (!validation.report.ok) {
          // Rollback
          const artPath = resolve(repoRoot, materialized.artifact_path);
          rmSync(artPath, { force: true });
          if (materialized.mirror_path) rmSync(resolve(repoRoot, materialized.mirror_path), { force: true });
          throw new Error(`reflection distill would break validation: ${validation.report.issues.map((issue) => issue.message).join('; ')}`);
        }

        linkedArtifact = materialized.artifact_id;
      } else {
        throw new Error(`promoted reflection decision is missing a linkable target: ${promo.decision}`);
      }
    } catch (err) {
      const observedFallback = { ...item.observation, tier: 'observed' };
      delete observedFallback.promoted_to;
      writeObservation(repoRoot, observedFallback);
      const entry = buildKnowledgeEntry({
        event: eventData,
        classification: promo.decision,
        confidence: promo.confidence,
        agentReason: promo.match_reason ?? '',
        status: 'indexed',
      });
      appendKnowledgeEntry(repoRoot, entry);
      observedCount++;
      continue;
    }

    writeObservation(repoRoot, { ...item.observation, promoted_to: linkedArtifact });

    // Knowledge entry for successful promotion
    const entry = buildKnowledgeEntry({
      event: eventData,
      classification: promo.decision,
      confidence: promo.confidence,
      agentReason: promo.match_reason ?? '',
      status: 'linked',
      linkedArtifact,
    });
    appendKnowledgeEntry(repoRoot, entry);
    promotedCount++;
  }

  // Write knowledge entries for filtered items
  for (const d of enrichedDecisions) {
    const tier = classifyReflection(d, reflectionConfig);
    if (tier === 'filter') {
      const eventData = d._event_data ?? {};
      const entry = buildKnowledgeEntry({
        event: eventData,
        classification: d.decision,
        confidence: d.confidence,
        agentReason: d.skip_reason ?? d.match_reason ?? '',
        status: 'indexed',
      });
      appendKnowledgeEntry(repoRoot, entry);
    }
  }

  markActivitySignatures(repoRoot, config, allSignatures, 'finalized', { source: 'finalize-reflections' });

  return {
    promoted: promotedCount,
    observed: observedCount,
    filtered,
    skipped_replayed_signatures: replayFilter.skipped_replayed_signatures.length,
  };
}
