import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateArtifacts } from './validate.mjs';
import { loadRepositoryArtifacts } from './repository-artifacts.mjs';
import {
  buildDependencyRecord,
  buildEntityRegistry,
  buildRepoRegistry,
  flattenDependencyText,
} from './dependency-utils.mjs';

const DEFAULT_FEEDBACK = { adopt: 0, reject: 0, warn: 0, score: 0.5 };

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readYamlFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, 'utf8');
  return parseYaml(raw) ?? fallback;
}

function asStringOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function normalizeDueDate(value) {
  const raw = asStringOrNull(value);
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})T/);
  return m ? m[1] : raw;
}

function buildEntityAliasMap(vocab) {
  const map = new Map();
  for (const entity of vocab.entities ?? []) {
    map.set(String(entity.canonical).toLowerCase(), {
      canonical: entity.canonical,
      type: entity.type
    });
    for (const alias of entity.aliases ?? []) {
      map.set(String(alias).toLowerCase(), {
        canonical: entity.canonical,
        type: entity.type
      });
    }
  }
  return map;
}

function normalizeEntities(frontmatter, aliasMap) {
  const entries = Array.isArray(frontmatter.entities) ? frontmatter.entities : [];
  const entities = [];
  const unresolved = [];

  for (const entry of entries) {
    const name = String(entry?.name ?? '').trim();
    const type = String(entry?.type ?? '').trim();
    if (!name) continue;

    const mapped = aliasMap.get(name.toLowerCase());
    if (!mapped) {
      unresolved.push(name);
      entities.push({ type: type || 'unknown', canonical: name });
      continue;
    }

    entities.push({ type: type || mapped.type || 'unknown', canonical: mapped.canonical });
  }

  return {
    entities,
    unresolved_entities: [...new Set(unresolved)].sort()
  };
}

function aggregateFeedback(artifacts) {
  const agg = {};

  for (const artifact of artifacts) {
    if (artifact.type !== 'feedback') continue;

    const targetId = asStringOrNull(artifact.frontmatter.target_id);
    const signal = asStringOrNull(artifact.frontmatter.signal);
    if (!targetId || !signal) continue;

    agg[targetId] ??= { ...DEFAULT_FEEDBACK };
    if (signal === 'adopt') agg[targetId].adopt += 1;
    if (signal === 'reject') agg[targetId].reject += 1;
    if (signal === 'warn') agg[targetId].warn += 1;
  }

  for (const [targetId, value] of Object.entries(agg)) {
    const total = value.adopt + value.reject + value.warn;
    if (total === 0) {
      value.score = 0.5;
      agg[targetId] = value;
      continue;
    }

    const raw = (value.adopt - value.reject - value.warn * 0.5) / total;
    value.score = Math.max(0, Math.min(1, 0.5 + raw / 2));
    agg[targetId] = value;
  }

  return agg;
}

function buildBacklinks(manifest) {
  const backlinks = new Map();

  for (const item of manifest) {
    const targets = new Set([...item.relations_out.map((r) => r.target), ...item.links_out]);
    for (const target of targets) {
      if (!backlinks.has(target)) backlinks.set(target, new Set());
      backlinks.get(target).add(item.id);
    }
  }

  const out = {};
  for (const [target, sources] of backlinks.entries()) {
    out[target] = [...sources].sort();
  }
  return out;
}

function appendIndexMap(map, key, id) {
  const normalized = key && String(key).trim() ? String(key) : 'none';
  map[normalized] ??= [];
  map[normalized].push(id);
}

function sortedIndexMap(map) {
  const out = {};
  for (const key of Object.keys(map).sort()) {
    out[key] = [...new Set(map[key])].sort();
  }
  return out;
}

function buildFacetIndexes(manifest) {
  const byType = {};
  const byProject = {};
  const byOwner = {};
  const byAuthor = {};
  const byStatus = {};
  const byTag = {};

  for (const item of manifest) {
    appendIndexMap(byType, item.type, item.id);
    appendIndexMap(byProject, item.area, item.id);
    appendIndexMap(byOwner, item.owner, item.id);
    appendIndexMap(byAuthor, item.author, item.id);
    appendIndexMap(byStatus, item.status, item.id);
    for (const tag of item.tags) {
      appendIndexMap(byTag, tag, item.id);
    }
  }

  return {
    byType: sortedIndexMap(byType),
    byProject: sortedIndexMap(byProject),
    byOwner: sortedIndexMap(byOwner),
    byAuthor: sortedIndexMap(byAuthor),
    byStatus: sortedIndexMap(byStatus),
    byTag: sortedIndexMap(byTag)
  };
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(path, entries) {
  ensureDir(dirname(path));
  const payload = entries.map((entry) => JSON.stringify(entry)).join('\n');
  writeFileSync(path, `${payload}${entries.length ? '\n' : ''}`, 'utf8');
}

function buildManifestEntries(root, artifacts) {
  const feedbackAgg = aggregateFeedback(artifacts);
  const vocab = readYamlFile(resolve(root, 'content/vocab/entities.yml'), { entities: [] });
  const aliasMap = buildEntityAliasMap(vocab);
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));

  const manifest = artifacts
    .map((artifact) => {
      const { entities, unresolved_entities } = normalizeEntities(artifact.frontmatter, aliasMap);
      const fm = artifact.frontmatter;

      return {
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        path: artifact._workspaceMember
          ? `workspace/${artifact._workspaceMember}/${artifact.relativePath}`
          : `content/${artifact.relativePath}`,
        created_at: String(fm.created_at ?? ''),
        updated_at: String(fm.updated_at ?? ''),
        area: asStringOrNull(fm.area),
        status: asStringOrNull(fm.status),
        priority: asStringOrNull(fm.priority),
        phase: asStringOrNull(fm.x_phase),
        owner: asStringOrNull(fm.owner),
        watchers: Array.isArray(fm.watchers) ? fm.watchers : [],
        author: asStringOrNull(fm.x_author),
        due_date: normalizeDueDate(fm.due_date),
        timeline_start: normalizeDueDate(fm.x_timeline_start),
        timeline_end: normalizeDueDate(fm.x_timeline_end),
        iteration: asStringOrNull(fm.iteration),
        planned_date: normalizeDueDate(fm.x_planned_date),
        // decision_adr-product-initiative-kickoff: initiative kind, kickoff
        // contract, and component-level task dates.
        initiative_kind: asStringOrNull(fm.x_initiative_kind),
        prd_doc: asStringOrNull(fm.x_prd_doc),
        components: Array.isArray(fm.x_components) ? fm.x_components.map(String) : [],
        kickoff_date: normalizeDueDate(fm.x_kickoff_date),
        baseline_tasks: Array.isArray(fm.x_baseline_tasks) ? fm.x_baseline_tasks.map(String) : [],
        component: asStringOrNull(fm.x_component),
        start_date: normalizeDueDate(fm.x_start_date),
        target_date: normalizeDueDate(fm.x_target_date),
        slip_count: fm.x_slip_count ?? null,
        evergreen: fm.x_evergreen === true,
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        entities,
        relations_out: artifact.relationsOut,
        links_out: artifact.linksOut,
        sources: Array.isArray(fm.sources) ? fm.sources : [],
        hashes: artifact.hashes,
        feedback: feedbackAgg[artifact.id] ?? { ...DEFAULT_FEEDBACK },
        unresolved_entities
      };
    })
    .sort((a, b) => (a.updated_at === b.updated_at ? a.id.localeCompare(b.id) : a.updated_at.localeCompare(b.updated_at)));

  return {
    manifest,
    feedbackAgg,
    backlinks: buildBacklinks(manifest),
    facets: buildFacetIndexes(manifest),
    artifactById
  };
}

export function validateRepository(repoRoot) {
  const root = resolve(repoRoot ?? process.cwd());
  const { artifacts, loadIssues } = loadRepositoryArtifacts(root);
  const policy = readYamlFile(resolve(root, 'content/policies/governance.yml'), {});
  const vocabTags = readYamlFile(resolve(root, 'content/vocab/tags.yml'), {});
  const vocabEntities = readYamlFile(resolve(root, 'content/vocab/entities.yml'), { entities: [] });
  const vocabMembers = readYamlFile(resolve(root, 'content/vocab/members.yml'), { members: [] });
  const vocabAreas = readYamlFile(resolve(root, 'content/vocab/areas.yml'), { areas: [] });
  const vocabRepos = readYamlFile(resolve(root, 'content/vocab/repos.yml'), { repos: [] });
  const report = validateArtifacts(artifacts, policy, {
    tags: vocabTags,
    entities: vocabEntities,
    members: vocabMembers,
    areas: vocabAreas,
    repos: vocabRepos
  });
  for (const issue of loadIssues) {
    report.issues.push({
      level: 'error',
      id: '(parse-error)',
      path: issue.path,
      message: issue.message
    });
  }
  report.ok = !report.issues.some((issue) => issue.level === 'error');

  return {
    artifacts,
    policy,
    report
  };
}

export function buildIndexes(repoRoot) {
  const root = resolve(repoRoot ?? process.cwd());
  const indexDir = resolve(root, 'index');

  const { artifacts, report } = validateRepository(root);
  if (!report.ok) {
    throw new Error('Validation failed. Run `hey validate` for details.');
  }

  const { manifest, feedbackAgg, backlinks, facets, artifactById } = buildManifestEntries(root, artifacts);
  const repoVocab = readYamlFile(resolve(root, 'content/vocab/repos.yml'), { repos: [] });
  const entityVocab = readYamlFile(resolve(root, 'content/vocab/entities.yml'), { entities: [] });
  const repoRegistry = buildRepoRegistry(repoVocab);
  const entityRegistry = buildEntityRegistry(entityVocab);
  const dependencyRecords = artifacts
    .map((artifact) => buildDependencyRecord(artifact, { repoRegistry, entityLookup: entityRegistry }))
    .filter(Boolean)
    .sort((a, b) => (a.updated_at === b.updated_at ? a.id.localeCompare(b.id) : a.updated_at.localeCompare(b.updated_at)));
  const dependencyById = new Map(dependencyRecords.map((record) => [record.id, record]));
  const searchDocuments = manifest.map((entry) => ({
    id: entry.id,
    title: entry.title,
    path: entry.path,
    type: entry.type,
    area: entry.area,
    status: entry.status,
    owner: entry.owner,
    author: entry.author,
    text: [
      entry.id,
      entry.title,
      entry.path,
      entry.type,
      entry.area ?? '',
      entry.status ?? '',
      entry.phase ?? '',
      entry.owner ?? '',
      entry.author ?? '',
      entry.tags.join(' '),
      entry.entities.map((entity) => entity.canonical).join(' '),
      entry.relations_out.map((relation) => relation.target).join(' '),
      (entry.sources ?? []).map((s) => `${s.kind}:${s.ref}`).join(' '),
      dependencyById.has(entry.id) ? flattenDependencyText(dependencyById.get(entry.id)) : '',
      artifactById.get(entry.id)?.body ?? ''
    ]
      .filter(Boolean)
      .join(' ')
  }));

  ensureDir(indexDir);
  writeJsonl(resolve(indexDir, 'manifest.jsonl'), manifest);
  writeJson(resolve(indexDir, 'backlinks.json'), backlinks);
  writeJson(resolve(indexDir, 'by_type.json'), facets.byType);
  writeJson(resolve(indexDir, 'by_project.json'), facets.byProject);
  writeJson(resolve(indexDir, 'by_owner.json'), facets.byOwner);
  writeJson(resolve(indexDir, 'by_author.json'), facets.byAuthor);
  writeJson(resolve(indexDir, 'by_status.json'), facets.byStatus);
  writeJson(resolve(indexDir, 'by_tag.json'), facets.byTag);
  writeJson(resolve(indexDir, 'feedback_agg.json'), feedbackAgg);
  writeJson(resolve(indexDir, 'dependencies.json'), {
    generated_at: new Date().toISOString(),
    dependencies: dependencyRecords
  });
  writeJson(resolve(indexDir, 'search.flex.json'), {
    generated_at: new Date().toISOString(),
    documents: searchDocuments
  });

  return {
    manifest,
    validation: report,
    feedbackAgg
  };
}

export function loadLiveManifest(repoRoot) {
  const root = resolve(repoRoot ?? process.cwd());
  const { artifacts } = loadRepositoryArtifacts(root);
  return buildManifestEntries(root, artifacts).manifest;
}

export function loadManifest(repoRoot) {
  const root = resolve(repoRoot ?? process.cwd());
  const path = resolve(root, 'index', 'manifest.jsonl');
  if (!existsSync(path)) return [];

  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];

  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function loadIndexJson(repoRoot, file, fallback) {
  const root = resolve(repoRoot ?? process.cwd());
  const path = resolve(root, 'index', file);
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

const MANIFEST_SOURCE_EXTS = new Set(['.md', '.yml', '.yaml', '.json', '.jsonl']);
const MANIFEST_SCAN_SKIP_DIRS = new Set(['node_modules', '.git', '.hey', 'index', '.cache', '.DS_Store']);

function anyFileNewerThan(dir, threshold) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (MANIFEST_SCAN_SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (anyFileNewerThan(full, threshold)) return true;
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot < 0) continue;
      if (!MANIFEST_SOURCE_EXTS.has(entry.name.slice(dot))) continue;
      if (statSync(full).mtimeMs > threshold) return true;
    }
  }
  return false;
}

export function manifestNeedsBuild(repoRoot) {
  const root = resolve(repoRoot ?? process.cwd());
  const manifestPath = resolve(root, 'index', 'manifest.jsonl');
  if (!existsSync(manifestPath)) return true;
  const manifestMtime = statSync(manifestPath).mtimeMs;

  for (const dirName of ['content', 'workspace']) {
    const dir = resolve(root, dirName);
    if (!existsSync(dir)) continue;
    if (anyFileNewerThan(dir, manifestMtime)) return true;
  }
  return false;
}
