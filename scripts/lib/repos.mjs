import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { normalizeText, uniqueStrings } from './text-utils.mjs';

export const VALID_ORG_RELATIONSHIPS = new Set([
  'primary',
  'ecosystem',
  'partner',
  'upstream',
  'personal',
  'local',
]);

export const VALID_REPO_STATUSES = new Set([
  'active',
  'dormant',
  'archive',
  'reference',
  'retired',
]);

export const VALID_REPO_ACCESS = new Set([
  'read-write',
  'read-only',
  'pr-only',
  'api-or-mcp',
]);

export const VALID_SITUATION_MODES = new Set([
  'primary',
  'reference',
  'read-only',
  'api-or-mcp',
  'write-with-gate',
]);

export function repoSlugFromRemote(remote) {
  if (typeof remote !== 'string' || !remote.trim()) return null;
  const trimmed = remote.trim();

  const sshMatch = /^git@[^:]+:(.+?)(?:\.git)?$/i.exec(trimmed);
  if (sshMatch?.[1]) {
    return sshMatch[1].replace(/^\/+/, '') || null;
  }

  try {
    const url = new URL(trimmed);
    return url.pathname.replace(/^\/+/, '').replace(/\.git$/i, '') || null;
  } catch {
    return null;
  }
}

function readYamlSafe(path, fallback) {
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, 'utf8');
  return parseYaml(raw) ?? fallback;
}

function expandHome(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) return '';
  const trimmed = inputPath.trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

export function loadReposVocab(repoRoot) {
  const root = resolve(repoRoot ?? process.cwd());
  return readYamlSafe(resolve(root, 'content/vocab/repos.yml'), { orgs: [], repos: [], situations: [] });
}

export function loadMemberLocalRepos(repoRoot, member) {
  const map = new Map();
  if (!member) return map;
  const root = resolve(repoRoot ?? process.cwd());
  const parsed = readYamlSafe(resolve(root, 'workspace', member, 'repos.yml'), { repos: [] });

  for (const item of parsed?.repos ?? []) {
    const localPath = expandHome(item?.path ?? '');
    if (!localPath) continue;
    const name = String(item?.name ?? '').trim();
    if (name) map.set(name, localPath);
    const dirBase = basename(localPath);
    if (dirBase && !map.has(dirBase)) map.set(dirBase, localPath);
  }

  return map;
}

export function resolveLocalRepoPath(entry, { repoRoot, memberRepos = new Map() } = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const name = String(entry?.name ?? '').trim();
  const localDir = typeof entry?.local_dir === 'string' && entry.local_dir.trim() ? entry.local_dir.trim() : null;

  let localPath = memberRepos.get(name) ?? (localDir ? memberRepos.get(localDir) : null);
  if (!localPath) {
    if (name && name === basename(root)) {
      localPath = root;
    } else {
      localPath = resolve(root, '..', localDir ?? name);
    }
  }

  const cloned = Boolean(localPath && existsSync(localPath));
  return { local_path: localPath, cloned };
}

export function enrichReposVocab(vocabRepos = {}, { repoRoot, member } = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const memberRepos = loadMemberLocalRepos(root, member);
  const orgs = Array.isArray(vocabRepos.orgs) ? vocabRepos.orgs : [];
  const rawRepos = Array.isArray(vocabRepos.repos) ? vocabRepos.repos : [];
  const rawSituations = Array.isArray(vocabRepos.situations) ? vocabRepos.situations : [];

  const repos = rawRepos.map((entry) => {
    const remote = typeof entry?.remote === 'string' && entry.remote.trim() ? entry.remote.trim() : null;
    const slug = repoSlugFromRemote(remote);
    const { local_path, cloned } = resolveLocalRepoPath(entry, { repoRoot: root, memberRepos });
    return {
      name: String(entry?.name ?? '').trim(),
      org: entry?.org ? String(entry.org).trim() : null,
      remote,
      slug,
      status: entry?.status ? String(entry.status).trim() : null,
      role: entry?.role ? String(entry.role).trim() : null,
      access: entry?.access ? String(entry.access).trim() : null,
      local_dir: entry?.local_dir ? String(entry.local_dir).trim() : null,
      aliases: uniqueStrings(Array.isArray(entry?.aliases) ? entry.aliases : []),
      entrypoints: uniqueStrings(Array.isArray(entry?.entrypoints) ? entry.entrypoints : []),
      description: entry?.description ? String(entry.description).trim() : '',
      local_path,
      cloned,
    };
  });

  const repoByName = new Map(repos.map((r) => [r.name, r]));

  const situations = rawSituations.map((sit) => {
    const targets = (Array.isArray(sit?.targets) ? sit.targets : []).map((t) => {
      const repoName = String(t?.repo ?? '').trim();
      const repoMeta = repoByName.get(repoName) ?? null;
      const targetEntrypoints = uniqueStrings([
        ...(Array.isArray(t?.entrypoints) ? t.entrypoints : []),
        ...(repoMeta?.entrypoints ?? []),
      ]);
      return {
        repo: repoName,
        mode: t?.mode ? String(t.mode).trim() : 'reference',
        how: t?.how ? String(t.how).trim() : '',
        entrypoints: targetEntrypoints,
        org: repoMeta?.org ?? null,
        remote: repoMeta?.remote ?? null,
        status: repoMeta?.status ?? null,
        role: repoMeta?.role ?? null,
        access: repoMeta?.access ?? null,
        local_path: repoMeta?.local_path ?? null,
        cloned: repoMeta?.cloned ?? false,
      };
    });

    return {
      id: String(sit?.id ?? '').trim(),
      title: sit?.title ? String(sit.title).trim() : String(sit?.id ?? '').trim(),
      when: sit?.when ? String(sit.when).trim() : '',
      keywords: uniqueStrings(Array.isArray(sit?.keywords) ? sit.keywords : []),
      targets,
      playbooks: uniqueStrings(Array.isArray(sit?.playbooks) ? sit.playbooks : []),
      guardrails: sit?.guardrails ? String(sit.guardrails).trim() : null,
    };
  });

  return { orgs, repos, situations, repoByName };
}

function tokenizeQuery(value) {
  return uniqueStrings(
    normalizeText(value)
      .split(/[\s/_,.;:()[\]{}-]+/g)
      .filter((tok) => tok.length >= 2)
  );
}

export function resolveSituations(vocabRepos = {}, query = '', { repoRoot, member, limit = 5 } = {}) {
  const { situations, repoByName } = enrichReposVocab(vocabRepos, { repoRoot, member });
  const normQuery = normalizeText(query);
  if (!normQuery) return situations.slice(0, limit);

  const queryTokens = tokenizeQuery(query);
  const scored = [];

  for (const sit of situations) {
    let score = 0;
    const matchedReasons = [];

    if (normalizeText(sit.id) === normQuery) {
      score += 100;
      matchedReasons.push('exact situation id');
    } else if (normalizeText(sit.id).includes(normQuery) || normalizeText(sit.title).includes(normQuery)) {
      score += 25;
      matchedReasons.push('title/id phrase match');
    }

    const highSignalPool = normalizeText([
      sit.id.replace(/-/g, ' '),
      sit.title,
      ...sit.keywords,
      ...sit.targets.flatMap((t) => {
        const meta = repoByName.get(t.repo);
        return [t.repo, t.repo.replace(/[-_]/g, ' '), ...(meta?.aliases ?? []), meta?.role ?? ''];
      }),
    ].join(' '));

    const bodyPool = normalizeText([
      sit.when,
      sit.guardrails ?? '',
      ...sit.playbooks,
      ...sit.targets.flatMap((t) => [t.how, ...t.entrypoints]),
    ].join(' '));

    let highHits = 0;
    let bodyHits = 0;
    for (const tok of queryTokens) {
      if (highSignalPool.includes(tok)) {
        score += 6;
        highHits += 1;
      } else if (bodyPool.includes(tok)) {
        score += 2;
        bodyHits += 1;
      }
    }

    if (highHits > 0) matchedReasons.push(`${highHits} keyword/repo match(es)`);
    if (bodyHits > 0) matchedReasons.push(`${bodyHits} context match(es)`);

    if (score > 0) {
      scored.push({ ...sit, score, reasons: matchedReasons });
    }
  }

  return scored
    .sort((a, b) => (b.score === a.score ? a.id.localeCompare(b.id) : b.score - a.score))
    .slice(0, limit);
}

export function validateReposVocab(vocabRepos = {}, artifactIds = new Set()) {
  const issues = [];
  const path = 'content/vocab/repos.yml';
  const push = (level, message) => issues.push({ level, id: '(vocab:repos)', path, message });

  const orgs = Array.isArray(vocabRepos?.orgs) ? vocabRepos.orgs : [];
  const orgIds = new Set();
  for (const org of orgs) {
    const id = String(org?.id ?? '').trim();
    if (!id) {
      push('error', 'orgs[] entry is missing required field: id');
      continue;
    }
    if (orgIds.has(id)) {
      push('error', `duplicate org id '${id}' in orgs[]`);
    }
    orgIds.add(id);

    if (org?.relationship && !VALID_ORG_RELATIONSHIPS.has(org.relationship)) {
      push(
        'error',
        `org '${id}' has invalid relationship '${org.relationship}'. Valid: ${[...VALID_ORG_RELATIONSHIPS].join(', ')}`
      );
    }
  }

  const repos = Array.isArray(vocabRepos?.repos) ? vocabRepos.repos : [];
  const repoNames = new Set();
  for (const repo of repos) {
    const name = String(repo?.name ?? '').trim();
    if (!name) {
      push('error', 'repos[] entry is missing required field: name');
      continue;
    }
    if (repoNames.has(name)) {
      push('error', `duplicate repo name '${name}' in repos[]`);
    }
    repoNames.add(name);

    if (orgIds.size > 0) {
      const org = String(repo?.org ?? '').trim();
      if (!org) {
        push('warning', `repo '${name}' has no org field (declared orgs: ${[...orgIds].join(', ')})`);
      } else if (!orgIds.has(org)) {
        push('error', `repo '${name}' references unknown org '${org}'. Declared orgs: ${[...orgIds].join(', ')}`);
      }
    }

    if (repo?.status && !VALID_REPO_STATUSES.has(repo.status)) {
      push('error', `repo '${name}' has invalid status '${repo.status}'. Valid: ${[...VALID_REPO_STATUSES].join(', ')}`);
    }

    if (repo?.access && !VALID_REPO_ACCESS.has(repo.access)) {
      push('error', `repo '${name}' has invalid access '${repo.access}'. Valid: ${[...VALID_REPO_ACCESS].join(', ')}`);
    }
  }

  const situations = Array.isArray(vocabRepos?.situations) ? vocabRepos.situations : [];
  const situationIds = new Set();
  for (const sit of situations) {
    const id = String(sit?.id ?? '').trim();
    if (!id) {
      push('error', 'situations[] entry is missing required field: id');
      continue;
    }
    if (situationIds.has(id)) {
      push('error', `duplicate situation id '${id}' in situations[]`);
    }
    situationIds.add(id);

    if (!String(sit?.when ?? '').trim()) {
      push('error', `situation '${id}' requires a non-empty 'when' trigger description`);
    }

    const targets = Array.isArray(sit?.targets) ? sit.targets : [];
    if (targets.length === 0) {
      push('error', `situation '${id}' requires targets[] with at least one repo mapping`);
    }

    for (const target of targets) {
      const targetRepo = String(target?.repo ?? '').trim();
      if (!targetRepo) {
        push('error', `situation '${id}' has a target missing 'repo'`);
        continue;
      }
      if (!repoNames.has(targetRepo)) {
        push('error', `situation '${id}' target repo '${targetRepo}' is not in repos[] registry`);
      }
      if (target?.mode && !VALID_SITUATION_MODES.has(target.mode)) {
        push(
          'error',
          `situation '${id}' target '${targetRepo}' has invalid mode '${target.mode}'. Valid: ${[...VALID_SITUATION_MODES].join(', ')}`
        );
      }
    }

    if (artifactIds.size > 0 && Array.isArray(sit?.playbooks)) {
      for (const pb of sit.playbooks) {
        const pbId = String(pb ?? '').trim();
        if (pbId && !artifactIds.has(pbId)) {
          push('error', `situation '${id}' references unknown playbook/artifact '${pbId}'`);
        }
      }
    }
  }

  return issues;
}

export function formatReposList({ orgs, repos }, filters = {}) {
  const filtered = repos.filter((r) => {
    if (filters.org && r.org !== filters.org) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.role && r.role !== filters.role) return false;
    if (filters.cloned && !r.cloned) return false;
    return true;
  });

  const lines = [];
  if (orgs.length > 0 && !filters.org && !filters.status && !filters.role && !filters.cloned) {
    lines.push(`Organizations (${orgs.length}):`);
    for (const org of orgs) {
      const rel = org.relationship ? ` [${org.relationship}]` : '';
      const acc = org.default_access ? ` (${org.default_access})` : '';
      lines.push(`  - ${org.id}${rel}${acc}${org.notes ? ` — ${org.notes}` : ''}`);
    }
    lines.push('');
  }

  lines.push(`Repositories (${filtered.length}/${repos.length}):`);
  for (const r of filtered) {
    const cloneMark = r.cloned ? '✓' : '·';
    const meta = [r.org, r.status, r.role, r.access].filter(Boolean).join(' | ');
    const aliases = r.aliases.length > 0 ? ` (aliases: ${r.aliases.join(', ')})` : '';
    lines.push(`  ${cloneMark} ${r.name}${aliases} [${meta}]`);
    if (r.description) lines.push(`      ${r.description}`);
    lines.push(`      local: ${r.local_path}${r.cloned ? '' : ' (not cloned)'}${r.remote ? ` · remote: ${r.remote}` : ''}`);
  }

  return lines.join('\n');
}

export function formatSituationsList(situations = []) {
  if (situations.length === 0) {
    return 'No situational repo mappings configured in content/vocab/repos.yml (situations[]).';
  }

  const lines = [`Situational Repo Mappings (${situations.length}):`];
  for (const sit of situations) {
    lines.push(`\n- ${sit.id} — ${sit.title}`);
    lines.push(`  When: ${sit.when}`);
    for (const t of sit.targets) {
      const cloneTag = t.cloned ? `cloned: ${t.local_path}` : 'not cloned locally';
      lines.push(`  -> [${t.mode}] ${t.repo} (${cloneTag})${t.how ? ` — ${t.how}` : ''}`);
    }
    if (sit.playbooks.length > 0) {
      lines.push(`  Playbooks: ${sit.playbooks.join(', ')}`);
    }
    if (sit.guardrails) {
      lines.push(`  Guardrails: ${sit.guardrails}`);
    }
  }
  return lines.join('\n');
}

export function formatSituationResolution(matches = [], query = '') {
  if (matches.length === 0) {
    return `No situational repo mapping matched "${query}". Run \`./hey repos situations\` to list all mappings.`;
  }

  const lines = [`Situational repo matches for: ${query}`];
  matches.forEach((sit, idx) => {
    const scoreTag = typeof sit.score === 'number' ? ` [score ${sit.score}]` : '';
    lines.push(`\n${idx + 1}. ${sit.id} — ${sit.title}${scoreTag}`);
    lines.push(`   When: ${sit.when}`);
    for (const t of sit.targets) {
      const accessTag = t.access ? `, access: ${t.access}` : '';
      const cloneInfo = t.cloned ? `local: ${t.local_path}` : `remote: ${t.remote ?? 'n/a'} (not cloned at ${t.local_path})`;
      lines.push(`   - [${t.mode}] ${t.repo} (${cloneInfo}${accessTag})`);
      if (t.how) lines.push(`     How: ${t.how}`);
      if (t.entrypoints.length > 0) lines.push(`     Entrypoints: ${t.entrypoints.join(', ')}`);
    }
    if (sit.playbooks.length > 0) {
      lines.push(`   Playbooks: ${sit.playbooks.join(', ')}`);
    }
    if (sit.guardrails) {
      lines.push(`   Guardrails: ${sit.guardrails}`);
    }
  });
  return lines.join('\n');
}
