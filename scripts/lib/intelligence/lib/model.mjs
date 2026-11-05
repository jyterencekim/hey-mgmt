// Data model for the unified projection: namespaces, node/edge shapes,
// relation vocabulary, reciprocal derivation, and the drift migration map.
// Design: superearn-mgmt workspace/terence/notes/note_2026-09-14-knowledge-graph-v2-design.md

export const NAMESPACES = ['mgmt', 'mem', 'ext', 'auditor', 'chain', 'proc', 'src', 'oa'];

export const ARTIFACT_TYPES = ['task', 'decision', 'meeting', 'playbook', 'note', 'initiative', 'goal'];
export const ARTIFACT_ID_RE = /^(task|decision|meeting|playbook|note|initiative|goal)_[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;

// CoALA memory of each mgmt artifact type.
export const MEMORY_OF_ARTIFACT = {
  task: 'episodic',
  meeting: 'episodic',
  note: 'episodic',
  initiative: 'episodic',
  decision: 'semantic',
  goal: 'semantic',
  playbook: 'procedural',
};

export const RELATIONS = {
  structural: ['parent_of', 'child_of', 'contributes_to', 'supersedes', 'superseded_by', 'duplicates', 'follows'],
  semantic: [
    'links_to', 'supports', 'implements', 'implemented_by', 'blocks', 'blocked_by',
    'mentions', 'mentioned_in', 'evidenced_by', 'evidence_for', 'advanced_by',
  ],
  procedural: ['LEADS_TO', 'TRIGGERS', 'PROVIDES_INPUT_FOR', 'CONVERGES_TO'],
};

export const PROCEDURAL_RELATIONS = new Set(RELATIONS.procedural);

export const VALID_RELATIONS = new Set([
  ...RELATIONS.structural,
  ...RELATIONS.semantic,
  ...RELATIONS.procedural,
]);

// Reciprocals derived at build time. Authors write one direction only.
export const INVERSE = {
  parent_of: 'child_of',
  child_of: 'parent_of',
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  implements: 'implemented_by',
  implemented_by: 'implements',
  supersedes: 'superseded_by',
  superseded_by: 'supersedes',
  mentions: 'mentioned_in',
  mentioned_in: 'mentions',
  evidenced_by: 'evidence_for',
  evidence_for: 'evidenced_by',
};

// Off-vocabulary relation types found in mgmt on 2026-09-14 and their
// canonical replacement. `invert` swaps src/dst.
export const DRIFT_MAP = {
  depends_on: { rel: 'blocked_by' },
  relates_to: { rel: 'mentions' },
  related_to: { rel: 'mentions' },
  spun_off_from: { rel: 'child_of' },
  precedes: { rel: 'follows', invert: true },
  precursor_of: { rel: 'follows', invert: true },
  refines: { rel: 'supports' },
  extends: { rel: 'supports' },
  verifies: { rel: 'supports' },
  informed_by: { rel: 'supports', invert: true },
  supported_by: { rel: 'supports', invert: true },
  produced_by: { rel: 'supports', invert: true },
};

// member: a human in members.yml; agent: an LLM agent (may only propose or signal);
// system: a deterministic pipeline with its own promotion gate (e.g. the auditor).
export const IDENTITY_RE = /^(member|agent|system):[a-z0-9_.-]+$/;

export const STRENGTHS = ['routing_hint', 'source_asserted', 'verifier_confirmed', 'heuristic_signal'];
export const EDGE_STATUSES = ['proposed', 'accepted', 'rejected', 'retired'];

/**
 * Normalize an authored relation type.
 * Returns { rel, invert, migratedFrom, unknown }.
 */
export function normalizeRel(raw) {
  const rel = String(raw ?? '').trim();
  if (VALID_RELATIONS.has(rel)) return { rel, invert: false, migratedFrom: null, unknown: false };
  const hit = DRIFT_MAP[rel];
  if (hit) return { rel: hit.rel, invert: Boolean(hit.invert), migratedFrom: rel, unknown: false };
  return { rel, invert: false, migratedFrom: null, unknown: true };
}

export function nsOf(id) {
  const i = id.indexOf(':');
  return i === -1 ? null : id.slice(0, i);
}

export function makeNode(fields) {
  const {
    id, kind, memory, title, status = null, owner = null, tags = [],
    created_at = null, updated_at = null, valid_from = null, valid_to = null,
    as_of = null, source = null, meta = {},
  } = fields;
  if (!id || !kind || !memory) throw new Error(`makeNode: id, kind, memory required (${JSON.stringify(fields)})`);
  const ns = nsOf(id);
  if (!NAMESPACES.includes(ns)) throw new Error(`makeNode: unknown namespace in ${id}`);
  return {
    id, ns, kind, memory, title: title ?? id, status, owner, tags,
    created_at: dateStr(created_at), updated_at: dateStr(updated_at),
    valid_from: dateStr(valid_from), valid_to: dateStr(valid_to),
    as_of: as_of ?? null, source, meta,
  };
}

export function makeEdge(fields) {
  const {
    src, rel, dst, attrs = {}, asserted_by, asserted_at = null, evidence = [],
    strength = 'source_asserted', status = 'accepted', supersedes = null,
    derived = false, origin = 'unknown',
  } = fields;
  if (!src || !rel || !dst) throw new Error(`makeEdge: src, rel, dst required (${JSON.stringify(fields)})`);
  if (!asserted_by) throw new Error(`makeEdge: asserted_by required for ${src} -${rel}-> ${dst}`);
  if (!IDENTITY_RE.test(asserted_by)) throw new Error(`makeEdge: asserted_by must be member:|agent:|system:<name>, got ${asserted_by}`);
  if (!STRENGTHS.includes(strength)) throw new Error(`makeEdge: bad strength ${strength}`);
  if (!EDGE_STATUSES.includes(status)) throw new Error(`makeEdge: bad status ${status}`);
  return {
    src, rel, dst, attrs, asserted_by, asserted_at: dateStr(asserted_at), evidence,
    strength, status, supersedes, derived, origin,
  };
}

export function edgeKey(e) {
  return `${e.src}|${e.rel}|${e.dst}`;
}

/** Add the reciprocal of every accepted edge whose relation has an inverse. */
export function deriveReciprocals(edges) {
  const seen = new Set(edges.map(edgeKey));
  const out = [];
  for (const e of edges) {
    const inv = INVERSE[e.rel];
    if (!inv || e.status !== 'accepted') continue;
    const r = { ...e, src: e.dst, dst: e.src, rel: inv, derived: true, origin: `derived:${e.origin}` };
    const k = edgeKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export function dateStr(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v);
}
