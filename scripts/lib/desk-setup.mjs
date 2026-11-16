import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { CAPABILITIES, cmpVersion } from './capabilities.mjs';
import { buildCatalogDatabase } from './catalog-db.mjs';
import { parseArtifact, writeArtifact } from './content-io.mjs';
import { buildIndexes, validateRepository } from './indexer.mjs';
import { listMemberEntries } from './members.mjs';

const SYSTEM_MEMBERS = new Set(['team', 'fisher', 'agent']);
const STARTER_MEMBERS = new Set(['alice', 'bob']);
const TONE_MAP = {
  terse: 'concise',
  concise: 'concise',
  balanced: 'balanced',
  warm: 'coaching',
  coaching: 'coaching',
};

function runProbe(cmd, args, cwd) {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim();
    return { ok: true, output: out };
  } catch (error) {
    return {
      ok: false,
      output: String(error?.stderr || error?.stdout || error?.message || '').trim(),
    };
  }
}

export function parseEnvFile(envPath) {
  if (!existsSync(envPath)) return {};
  const result = {};
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    result[key] = val;
  }
  return result;
}

/**
 * Update or insert env keys without clobbering existing comments or unrelated secrets.
 * Never returns secret values.
 */
export function upsertEnvVariables(envPath, updates = {}) {
  const entries = Object.entries(updates).filter(([key, value]) => key && value !== undefined && value !== null);
  const examplePath = resolve(dirname(envPath), '.env.example');
  let baseText = '';
  if (existsSync(envPath)) {
    baseText = readFileSync(envPath, 'utf8');
  } else if (existsSync(examplePath)) {
    baseText = readFileSync(examplePath, 'utf8');
  }

  let lines = baseText ? baseText.split(/\r?\n/) : [];
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const [key, rawValue] of entries) {
    const cleanVal = String(rawValue).replace(/[\r\n]+/g, '\\n');
    const activeRe = new RegExp(`^\\s*${escapeRegex(key)}\\s*=.*$`);
    const commentedRe = new RegExp(`^\\s*#\\s*${escapeRegex(key)}\\s*=.*$`);
    const rendered = `${key}=${cleanVal}`;

    let replaced = false;
    const nextLines = [];
    for (const line of lines) {
      if (activeRe.test(line)) {
        if (!replaced) {
          nextLines.push(rendered);
          replaced = true;
        }
        continue;
      }
      nextLines.push(line);
    }

    if (!replaced) {
      const commentIndex = nextLines.findIndex((line) => commentedRe.test(line));
      if (commentIndex !== -1) {
        nextLines[commentIndex] = rendered;
        replaced = true;
      }
    }

    if (!replaced) {
      nextLines.push(rendered);
    }
    lines = nextLines;
  }

  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, `${lines.join('\n')}\n`, 'utf8');

  return {
    path: envPath,
    updated_keys: entries.map(([key]) => key),
  };
}

function scanSiblingGitRepos(repoRoot) {
  const parent = resolve(repoRoot, '..');
  const selfName = basename(repoRoot);
  if (!existsSync(parent)) return [];

  const found = [];
  let entries = [];
  try {
    entries = readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === selfName || entry.name.startsWith('.')) continue;
    if (/(-worktrees|-wt\b)/.test(entry.name)) continue;
    const fullPath = resolve(parent, entry.name);
    if (!existsSync(resolve(fullPath, '.git'))) continue;
    const remoteProbe = runProbe('git', ['-C', fullPath, 'config', '--get', 'remote.origin.url'], fullPath);
    found.push({
      name: entry.name,
      path: fullPath,
      remote: remoteProbe.ok ? remoteProbe.output : null,
    });
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function hasStarterLogActivity(repoRoot) {
  for (const starter of STARTER_MEMBERS) {
    const logsDir = resolve(repoRoot, 'workspace', starter, 'logs');
    if (!existsSync(logsDir)) continue;
    try {
      const entries = readdirSync(logsDir);
      if (entries.some((name) => name.endsWith('.md'))) return true;
    } catch { /* ignore */ }
  }
  return false;
}

function readAreasVocab(repoRoot) {
  const path = resolve(repoRoot, 'content', 'vocab', 'areas.yml');
  if (!existsSync(path)) return [];
  const parsed = parseYaml(readFileSync(path, 'utf8')) ?? {};
  return Array.isArray(parsed.areas) ? parsed.areas : [];
}

function probeRuntimeTools(repoRoot) {
  const nodeVersion = process.versions.node;
  const pnpm = runProbe('pnpm', ['--version'], repoRoot);
  const git = runProbe('git', ['--version'], repoRoot);
  const gh = runProbe('gh', ['--version'], repoRoot);
  const ghAuth = gh.ok ? runProbe('gh', ['auth', 'status'], repoRoot) : { ok: false, output: '' };
  const sqlite3 = runProbe('sqlite3', ['--version'], repoRoot);
  const ttyd = runProbe('ttyd', ['--version'], repoRoot);
  const tmux = runProbe('tmux', ['-V'], repoRoot);

  return {
    node: {
      installed: true,
      version: nodeVersion,
      ok: cmpVersion(nodeVersion, '22.5.0') >= 0,
      required: '>=22.5.0',
    },
    pnpm: {
      installed: pnpm.ok,
      version: pnpm.ok ? pnpm.output.split('\n')[0] : null,
    },
    git: {
      installed: git.ok,
      version: git.ok ? git.output.split('\n')[0] : null,
    },
    gh: {
      installed: gh.ok,
      authenticated: ghAuth.ok,
      version: gh.ok ? gh.output.split('\n')[0] : null,
    },
    sqlite3: {
      installed: sqlite3.ok,
      version: sqlite3.ok ? sqlite3.output.split(' ')[0] : null,
    },
    board_terminal: {
      ttyd: ttyd.ok,
      tmux: tmux.ok,
      ready: ttyd.ok && tmux.ok,
    },
  };
}

export function inspectSetupStatus(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const allMembers = listMemberEntries(root);
  const humanMembers = allMembers.filter((m) => !SYSTEM_MEMBERS.has(m.name));
  const areas = readAreasVocab(root);

  const initMarkerPath = resolve(root, '.hey', 'setup-initialized.json');
  const initializedMarker = existsSync(initMarkerPath)
    ? JSON.parse(readFileSync(initMarkerPath, 'utf8'))
    : null;

  const isStarterState =
    !initializedMarker &&
    humanMembers.length > 0 &&
    humanMembers.every((m) => STARTER_MEMBERS.has(m.name)) &&
    !hasStarterLogActivity(root);

  const envPath = resolve(root, '.env');
  const envExists = existsSync(envPath);
  const env = parseEnvFile(envPath);
  const member = env.MEMBER ?? '';
  const language = env.LANGUAGE ?? '';
  const tone = env.HEY_TONE ?? '';
  const memberInRoster = Boolean(member && humanMembers.some((m) => m.name === member));

  const needsBootstrap =
    !envExists ||
    !member ||
    member === 'your-name' ||
    !memberInRoster ||
    (member === 'alice' && isStarterState);

  const capabilities = CAPABILITIES
    .filter((cap) => !(options.skipRemoteCheck && cap.id === 'tooling-current'))
    .map((cap) => ({
      id: cap.id,
      title: cap.title,
      version: cap.version,
      kind: cap.kind,
      ...cap.check(root),
      hint: cap.hint ?? null,
    }));

  return {
    repo_root: root,
    platform: process.platform,
    needs_bootstrap: needsBootstrap,
    is_starter_state: isStarterState,
    mode_recommendation: isStarterState ? 'init' : 'join',
    initialized_marker: initializedMarker,
    env: {
      exists: envExists,
      member: member || null,
      member_in_roster: memberInRoster,
      language: language || null,
      tone: tone || null,
    },
    members: {
      human: humanMembers.map((m) => ({
        name: m.name,
        role: m.role ?? null,
        interaction_preference: m.interaction_preference ?? null,
      })),
      system: allMembers.filter((m) => SYSTEM_MEMBERS.has(m.name)).map((m) => m.name),
    },
    areas: areas.map((a) => ({ name: a.name, description: a.description ?? '' })),
    tools: probeRuntimeTools(root),
    capabilities,
    sibling_git_repos: options.scanParent === false ? [] : scanSiblingGitRepos(root),
  };
}

function readYamlHeaderComments(filePath) {
  if (!existsSync(filePath)) return '';
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  const comments = [];
  for (const line of lines) {
    if (line.trim().startsWith('#')) {
      comments.push(line);
    } else {
      break;
    }
  }
  return comments.length > 0 ? `${comments.join('\n')}\n` : '';
}

function updateMembersVocab(repoRoot, { member, role, tone, pruneStarters }) {
  const path = resolve(repoRoot, 'content', 'vocab', 'members.yml');
  const header = readYamlHeaderComments(path);
  const data = existsSync(path) ? (parseYaml(readFileSync(path, 'utf8')) ?? {}) : {};
  const members = Array.isArray(data.members) ? [...data.members] : [];

  const filtered = pruneStarters
    ? members.filter((entry) => entry && (!STARTER_MEMBERS.has(entry.name) || entry.name === member))
    : members;

  const existingIdx = filtered.findIndex((entry) => entry?.name === member);
  const nextEntry = {
    ...(existingIdx >= 0 ? filtered[existingIdx] : {}),
    name: member,
    role: role || filtered[existingIdx]?.role || 'member',
    interaction_preference: tone,
  };

  if (existingIdx >= 0) {
    filtered[existingIdx] = nextEntry;
  } else {
    const systemIdx = filtered.findIndex((entry) => SYSTEM_MEMBERS.has(entry?.name));
    if (systemIdx >= 0) {
      filtered.splice(systemIdx, 0, nextEntry);
    } else {
      filtered.push(nextEntry);
    }
  }

  data.interaction_preference_default = data.interaction_preference_default || 'balanced';
  data.members = filtered;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${header}${stringifyYaml(data)}`, 'utf8');
  return path;
}

function updateAreasVocab(repoRoot, areasInput) {
  const list = Array.isArray(areasInput)
    ? areasInput
    : String(areasInput ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  if (list.length === 0) return null;

  if (!list.some((name) => name === 'Team')) {
    list.push('Team');
  }

  const path = resolve(repoRoot, 'content', 'vocab', 'areas.yml');
  const existing = readAreasVocab(repoRoot);
  const existingByName = new Map(existing.map((area) => [area.name, area]));

  const nextAreas = [...new Set(list)].map((name) => {
    const prev = existingByName.get(name);
    if (prev) return prev;
    return {
      name,
      description: name === 'Team'
        ? 'Team operating system (hey-mgmt), workflows, playbooks, and ceremonies'
        : `${name} domain work and deliverables`,
    };
  });

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyYaml({ areas: nextAreas }), 'utf8');
  return path;
}

function walkMarkdownUnder(dir, bucket = []) {
  if (!existsSync(dir)) return bucket;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownUnder(full, bucket);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      bucket.push(full);
    }
  }
  return bucket;
}

function capitalize(name) {
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : '';
}

function reassignStarterReferences(repoRoot, member) {
  const contentRoot = resolve(repoRoot, 'content');
  const updatedArtifacts = [];

  for (const folder of ['goals', 'initiatives', 'tasks']) {
    for (const filePath of walkMarkdownUnder(resolve(contentRoot, folder))) {
      const artifact = parseArtifact(filePath, contentRoot);
      const fm = { ...artifact.frontmatter };
      let changed = false;

      if (STARTER_MEMBERS.has(fm.owner) && fm.owner !== member) {
        fm.owner = member;
        changed = true;
      }
      if (Array.isArray(fm.owners)) {
        const nextOwners = fm.owners.map((o) => (STARTER_MEMBERS.has(o) && o !== member ? member : o));
        if (JSON.stringify(nextOwners) !== JSON.stringify(fm.owners)) {
          fm.owners = [...new Set(nextOwners)];
          changed = true;
        }
      }

      if (changed) {
        writeArtifact(filePath, fm, `${artifact.body}\n`);
        updatedArtifacts.push(artifact.relativePath);
      }
    }
  }

  const extPolicyPath = resolve(contentRoot, 'policies', 'external-activity.yml');
  if (existsSync(extPolicyPath)) {
    const policy = parseYaml(readFileSync(extPolicyPath, 'utf8')) ?? {};
    if (policy.approval && STARTER_MEMBERS.has(policy.approval.artifact_owner_fallback)) {
      policy.approval.artifact_owner_fallback = member;
    }
    if (policy.logging && STARTER_MEMBERS.has(policy.logging.fallback_workspace)) {
      policy.logging.fallback_workspace = member;
    }
    writeFileSync(extPolicyPath, stringifyYaml(policy), 'utf8');
  }

  const meetingPolicyPath = resolve(contentRoot, 'policies', 'meeting-ingestion.yml');
  if (existsSync(meetingPolicyPath)) {
    const meeting = parseYaml(readFileSync(meetingPolicyPath, 'utf8')) ?? {};
    if (meeting.defaults && STARTER_MEMBERS.has(meeting.defaults.default_owner)) {
      meeting.defaults.default_owner = member;
    }
    if (meeting.members && typeof meeting.members === 'object') {
      const nextMembers = {};
      for (const [k, v] of Object.entries(meeting.members)) {
        if (STARTER_MEMBERS.has(k) && k !== member) continue;
        nextMembers[k] = v;
      }
      if (!nextMembers[member]) {
        nextMembers[member] = { gmail_addresses: [], notion_people: [capitalize(member)] };
      }
      meeting.members = nextMembers;
    }
    writeFileSync(meetingPolicyPath, stringifyYaml(meeting), 'utf8');
  }

  const fisherCfgPath = resolve(repoRoot, 'workspace', 'fisher', 'config', 'external-activity.yml');
  if (existsSync(fisherCfgPath)) {
    const cfg = parseYaml(readFileSync(fisherCfgPath, 'utf8')) ?? {};
    if (cfg.collector && Array.isArray(cfg.collector.dm_allowlist)) {
      const cleaned = cfg.collector.dm_allowlist.filter((n) => !STARTER_MEMBERS.has(n) || n === member);
      if (!cleaned.includes(member)) cleaned.unshift(member);
      cfg.collector.dm_allowlist = cleaned;
    }
    if (cfg.approval && STARTER_MEMBERS.has(cfg.approval.default_approver)) {
      cfg.approval.default_approver = member;
    }
    if (cfg.members && typeof cfg.members === 'object') {
      const nextMembers = {};
      for (const [k, v] of Object.entries(cfg.members)) {
        if (STARTER_MEMBERS.has(k) && k !== member) continue;
        nextMembers[k] = v;
      }
      if (!nextMembers[member]) {
        nextMembers[member] = {
          slack_user_id: '',
          slack_dm_id: '',
          confluence_names: [capitalize(member)],
          drive_emails: [],
          github_login: '',
        };
      }
      cfg.members = nextMembers;
    }
    writeFileSync(fisherCfgPath, stringifyYaml(cfg), 'utf8');
  }

  for (const starter of STARTER_MEMBERS) {
    if (starter === member) continue;
    const starterDir = resolve(repoRoot, 'workspace', starter);
    if (existsSync(starterDir)) {
      rmSync(starterDir, { recursive: true, force: true });
    }
  }

  return updatedArtifacts;
}

function scaffoldMemberWorkspace(repoRoot, { member, role, scanSiblings }) {
  const wsRoot = resolve(repoRoot, 'workspace', member);
  const dirs = [
    wsRoot,
    resolve(wsRoot, 'logs'),
    resolve(wsRoot, 'inbox', 'open'),
    resolve(wsRoot, 'inbox', 'read'),
    resolve(wsRoot, 'inbox', 'promoted'),
    resolve(wsRoot, 'inbox', 'discarded'),
    resolve(wsRoot, 'memory'),
    resolve(wsRoot, 'ideas'),
  ];
  for (const dir of dirs) mkdirSync(dir, { recursive: true });

  const writeIfMissing = (path, content) => {
    if (!existsSync(path)) {
      writeFileSync(path, content, 'utf8');
      return true;
    }
    return false;
  };

  const created = [];
  const label = capitalize(member);

  if (
    writeIfMissing(
      resolve(wsRoot, 'README.md'),
      `# ${label} — Workspace\n\nPersonal workspace for \`${member}\`. Artifacts here use the same frontmatter schema as \`content/\` and auto-set \`owner: ${member}\`.\n\n## Structure\n\n- \`profile.md\` — Role, domains, and repository ownership\n- \`inbox/\` — Raw intake items (\`./hey inbox list --workspace ${member}\`)\n- \`logs/\` — Daily worklogs (\`YYYY-MM-DD.md\`)\n- \`ideas/\` — Raw ideas awaiting promotion\n- \`memory/\` — Persistent context notes\n`,
    )
  ) {
    created.push(`workspace/${member}/README.md`);
  }

  if (
    writeIfMissing(
      resolve(wsRoot, 'profile.md'),
      `# ${label}\n\n## Role\n\n${role || 'Team Member'}\n\n## Domains\n\n- Add your primary product/engineering areas here\n\n## Repos\n\n| Repo | Role |\n| ---- | ---- |\n| hey-mgmt | Owner |\n`,
    )
  ) {
    created.push(`workspace/${member}/profile.md`);
  }

  if (
    writeIfMissing(
      resolve(wsRoot, 'memory', 'MEMORY.md'),
      `# Memory — ${label}\n\nDurable personal context and working preferences for ${label}.\n`,
    )
  ) {
    created.push(`workspace/${member}/memory/MEMORY.md`);
  }

  if (
    writeIfMissing(
      resolve(wsRoot, 'ideas', 'README.md'),
      `# Ideas\n\nPersonal capture space for concerns, ideas, observations, and positions.\n\n## Ontology\n\nEach file: \`YYYY-MM-DD-[kind]-slug.md\` with frontmatter (\`id: note_YYYY-MM-DD-slug\`, \`type: note\`, \`status: active | done | archived\`, \`x_kind: concern | idea | observation | position\`).\n`,
    )
  ) {
    created.push(`workspace/${member}/ideas/README.md`);
  }

  const reposYmlPath = resolve(wsRoot, 'repos.yml');
  if (scanSiblings !== false && !existsSync(reposYmlPath)) {
    const siblings = scanSiblingGitRepos(repoRoot);
    const repoEntries = [
      { name: basename(repoRoot), path: repoRoot },
      ...siblings.map((s) => ({ name: s.name, path: s.path })),
    ];
    writeFileSync(
      reposYmlPath,
      `# Auto-discovered local repository clones for ${member}\n${stringifyYaml({ repos: repoEntries })}`,
      'utf8',
    );
    created.push(`workspace/${member}/repos.yml`);
  }

  return { workspace_dir: `workspace/${member}`, created_files: created };
}

export function applySetup(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const member = String(options.member ?? '').trim().toLowerCase();
  if (!member || !/^[a-z0-9][a-z0-9_-]*$/.test(member) || SYSTEM_MEMBERS.has(member)) {
    throw new Error(`Invalid member id '${options.member}'. Use lowercase alphanumeric/hyphen/underscore (not team/fisher/agent).`);
  }

  const rawTone = String(options.tone ?? 'balanced').trim().toLowerCase();
  const tone = TONE_MAP[rawTone];
  if (!tone) {
    throw new Error(`Invalid tone '${options.tone}'. Valid: concise (terse), balanced, coaching (warm).`);
  }

  const lang = String(options.lang ?? 'en').trim().toLowerCase() || 'en';
  const before = inspectSetupStatus(root, {
    scanParent: options.scanSiblings !== false,
    skipRemoteCheck: true,
  });

  const mode = options.mode ? String(options.mode).trim().toLowerCase() : before.mode_recommendation;
  if (!['init', 'join'].includes(mode)) {
    throw new Error(`Invalid setup mode '${mode}'. Valid: init, join.`);
  }

  const pruneStarters = mode === 'init' && Boolean(options.pruneStarters);

  updateMembersVocab(root, {
    member,
    role: options.role ? String(options.role).trim() : null,
    tone,
    pruneStarters,
  });

  if (mode === 'init' && options.areas) {
    updateAreasVocab(root, options.areas);
  }

  const reassigned = pruneStarters ? reassignStarterReferences(root, member) : [];

  const scaffold = scaffoldMemberWorkspace(root, {
    member,
    role: options.role ? String(options.role).trim() : null,
    scanSiblings: options.scanSiblings !== false,
  });

  const envUpdate = upsertEnvVariables(resolve(root, '.env'), {
    MEMBER: member,
    LANGUAGE: lang,
    HEY_TONE: tone,
  });

  const markerPath = resolve(root, '.hey', 'setup-initialized.json');
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(
    markerPath,
    JSON.stringify(
      {
        initialized_at: new Date().toISOString(),
        member,
        mode,
        language: lang,
        tone,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const appliedCapabilities = [];
  if (options.runUpgrade !== false) {
    if (existsSync(resolve(root, '.git'))) {
      runProbe('git', ['config', 'core.hooksPath', '.githooks'], root);
      appliedCapabilities.push('git-hooks');
    }
    buildIndexes(root);
    buildCatalogDatabase(root);
    appliedCapabilities.push('derived-index');

    if (existsSync(resolve(root, 'scripts', 'kg.mjs'))) {
      const kgRes = runProbe(process.execPath, ['scripts/kg.mjs', 'build'], root);
      if (kgRes.ok) appliedCapabilities.push('intelligence-graph');
    }
  }

  const validation = validateRepository(root);
  const errors = validation.report.issues.filter((i) => i.level === 'error').length;
  const warnings = validation.report.issues.filter((i) => i.level === 'warning').length;

  return {
    ok: errors === 0,
    mode,
    member,
    language: lang,
    tone,
    pruned_starters: pruneStarters,
    reassigned_starter_artifacts: reassigned,
    env_updated_keys: envUpdate.updated_keys,
    applied_capabilities: appliedCapabilities,
    ...scaffold,
    validation: {
      errors,
      warnings,
      issues: validation.report.issues,
    },
  };
}
