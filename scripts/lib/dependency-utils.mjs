import { normalizeText, uniqueStrings } from './text-utils.mjs';

export const DEPENDENCY_TAG = 'ChangeImpact';
export const DEPENDENCY_NOTES_PREFIX = 'notes/dependencies/';
export const DEPENDENCY_SEVERITIES = new Set(['required', 'recommended', 'watch']);
// Terminal artifacts must not bind obligations on new work.
export const CONTRACT_TERMINAL_STATUSES = new Set(['done', 'archived', 'cancelled']);

function normalizeStringArray(values) {
  return uniqueStrings(Array.isArray(values) ? values : []);
}

function splitDelimitedTerms(value) {
  return uniqueStrings(String(value ?? '').split(/[\s/_-]+/g));
}

function repoSlugFromRemote(remote) {
  if (typeof remote !== 'string' || !remote.trim()) return null;

  try {
    const url = new URL(remote);
    return url.pathname.replace(/^\/+/, '').replace(/\.git$/i, '') || null;
  } catch {
    return null;
  }
}

function buildEntityAliasLookup(vocabEntities = {}) {
  const lookup = new Map();
  const termsByCanonical = new Map();

  for (const entry of vocabEntities.entities ?? []) {
    const canonical = String(entry?.canonical ?? '').trim();
    if (!canonical) continue;

    const terms = uniqueStrings([canonical, ...(entry.aliases ?? [])]);
    termsByCanonical.set(canonical, terms);

    for (const term of terms) {
      lookup.set(normalizeText(term), canonical);
    }
  }

  return { lookup, termsByCanonical };
}

function normalizeEntities(values, entityLookup) {
  return uniqueStrings(
    (Array.isArray(values) ? values : []).map((entry) => {
      const raw = String(entry ?? '').trim();
      if (!raw) return '';
      return entityLookup.lookup.get(normalizeText(raw)) ?? raw;
    })
  );
}

function repoSearchTerms(repoName, repoRegistry) {
  const entry = repoRegistry.get(repoName);
  if (!entry) {
    return uniqueStrings([repoName, ...splitDelimitedTerms(repoName)]);
  }

  return entry.search_terms;
}

function entitySearchTerms(entityName, entityLookup) {
  const canonical = entityLookup.lookup.get(normalizeText(entityName)) ?? entityName;
  return entityLookup.termsByCanonical.get(canonical) ?? uniqueStrings([entityName]);
}

function expandPathTerms(paths) {
  const terms = [];

  for (const path of normalizeStringArray(paths)) {
    terms.push(path);
    terms.push(path.replace(/[*?[\]{}]/g, ' '));
    terms.push(path.replace(/[/.\\_-]+/g, ' '));
    terms.push(...splitDelimitedTerms(path));
  }

  return uniqueStrings(terms);
}

export function buildRepoRegistry(vocabRepos = {}) {
  const registry = new Map();

  for (const entry of vocabRepos.repos ?? []) {
    const name = String(entry?.name ?? '').trim();
    if (!name) continue;

    const remote = typeof entry.remote === 'string' && entry.remote.trim() ? entry.remote.trim() : null;
    const slug = repoSlugFromRemote(remote);
    const slugParts = slug ? slug.split('/').filter(Boolean) : [];
    const searchTerms = uniqueStrings([
      name,
      ...splitDelimitedTerms(name),
      slug ?? '',
      ...(slug ? [slug.replace(/\//g, ' ')] : []),
      ...slugParts,
      ...slugParts.flatMap((part) => splitDelimitedTerms(part)),
    ]);

    registry.set(name, {
      name,
      remote,
      slug,
      search_terms: searchTerms,
    });
  }

  return registry;
}

export function buildEntityRegistry(vocabEntities = {}) {
  return buildEntityAliasLookup(vocabEntities);
}

export function normalizeChangeContract(raw, entityLookup = buildEntityAliasLookup()) {
  const triggers = raw && typeof raw.triggers === 'object' ? raw.triggers : {};
  const obligationsRaw = Array.isArray(raw?.obligations) ? raw.obligations : [];

  return {
    triggers: {
      repos: normalizeStringArray(triggers.repos),
      paths: normalizeStringArray(triggers.paths),
      areas: normalizeStringArray(triggers.areas),
      entities: normalizeEntities(triggers.entities, entityLookup),
      intents: normalizeStringArray(triggers.intents),
      terms: normalizeStringArray(triggers.terms),
    },
    obligations: obligationsRaw
      .map((entry) => ({
        title: String(entry?.title ?? '').trim(),
        severity: String(entry?.severity ?? 'required').trim() || 'required',
        repos: normalizeStringArray(entry?.repos),
        entities: normalizeEntities(entry?.entities, entityLookup),
        paths: normalizeStringArray(entry?.paths),
        actions: normalizeStringArray(entry?.actions),
      }))
      .filter((entry) => entry.title || entry.actions.length > 0),
    verification: normalizeStringArray(raw?.verification),
  };
}

export function isDependencyNoteCandidate(artifact) {
  if (!artifact || artifact.type !== 'note' || artifact._workspaceMember) return false;
  return String(artifact.relativePath ?? '').startsWith(DEPENDENCY_NOTES_PREFIX);
}

// KB-wide: any non-workspace, non-terminal content artifact that opts in with
// the ChangeImpact tag + an x_change_contract joins the dependency pool —
// membership is no longer restricted to notes/dependencies/.
// See decision_adr-kb-wide-change-contracts.
export function isDependencyArtifact(artifact) {
  if (!artifact || artifact._workspaceMember) return false;
  if (CONTRACT_TERMINAL_STATUSES.has(String(artifact.frontmatter?.status ?? ''))) return false;
  const tags = Array.isArray(artifact.frontmatter?.tags) ? artifact.frontmatter.tags : [];
  return tags.includes(DEPENDENCY_TAG) && artifact.frontmatter?.x_change_contract && typeof artifact.frontmatter.x_change_contract === 'object';
}

export function buildDependencyRecord(artifact, { repoRegistry, entityLookup }) {
  if (!isDependencyArtifact(artifact)) return null;

  const contract = normalizeChangeContract(artifact.frontmatter.x_change_contract, entityLookup);
  const triggerRepoTerms = contract.triggers.repos.flatMap((repoName) => repoSearchTerms(repoName, repoRegistry));
  const triggerEntityTerms = contract.triggers.entities.flatMap((entityName) => entitySearchTerms(entityName, entityLookup));
  const obligationRepoTerms = contract.obligations.flatMap((entry) => entry.repos.flatMap((repoName) => repoSearchTerms(repoName, repoRegistry)));
  const obligationEntityTerms = contract.obligations.flatMap((entry) => entry.entities.flatMap((entityName) => entitySearchTerms(entityName, entityLookup)));

  const searchTerms = uniqueStrings([
    artifact.title,
    artifact.body,
    ...contract.triggers.intents,
    ...contract.triggers.terms,
    ...contract.triggers.paths,
    ...expandPathTerms(contract.triggers.paths),
    ...contract.triggers.areas,
    ...triggerRepoTerms,
    ...triggerEntityTerms,
    ...contract.obligations.map((entry) => entry.title),
    ...contract.obligations.flatMap((entry) => entry.paths),
    ...expandPathTerms(contract.obligations.flatMap((entry) => entry.paths)),
    ...contract.obligations.flatMap((entry) => entry.actions),
    ...obligationRepoTerms,
    ...obligationEntityTerms,
    ...contract.verification,
  ]);

  return {
    id: artifact.id,
    title: artifact.title,
    path: `content/${artifact.relativePath}`,
    relative_path: artifact.relativePath,
    created_at: String(artifact.frontmatter?.created_at ?? ''),
    updated_at: String(artifact.frontmatter?.updated_at ?? ''),
    owner: String(artifact.frontmatter?.owner ?? ''),
    area: String(artifact.frontmatter?.area ?? ''),
    tags: Array.isArray(artifact.frontmatter?.tags) ? artifact.frontmatter.tags : [],
    sources: Array.isArray(artifact.frontmatter?.sources) ? artifact.frontmatter.sources : [],
    relations_out: artifact.relationsOut,
    links_out: artifact.linksOut,
    contract,
    trigger_repo_terms: uniqueStrings(triggerRepoTerms),
    trigger_entity_terms: uniqueStrings(triggerEntityTerms),
    obligation_repo_terms: uniqueStrings(obligationRepoTerms),
    obligation_entity_terms: uniqueStrings(obligationEntityTerms),
    search_terms: searchTerms,
    body_text: artifact.body,
  };
}

export function flattenDependencyText(record) {
  return uniqueStrings([record.title, record.body_text, ...record.search_terms]).join(' ');
}
