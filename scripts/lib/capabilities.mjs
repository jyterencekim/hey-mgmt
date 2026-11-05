// Repo capability registry — desired-state, idempotent, per-developer.
//
// `hey upgrade` ensures each capability is present and current. This is NOT a
// migration ledger: every capability's state is read from the machine via its
// check(), so capabilities self-heal if their artifacts are removed (clear
// ~/.cache/qmd → next upgrade re-offers semantic search). Version labels are
// human-facing changelog markers, not run-once gates.
//
// Scope is repo-wide, not hey-internal: a capability may touch dependencies,
// git config, derived indexes, optional backends, frontends, etc.
//
// See decision_adr-repo-wide-capability-upgra.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { isQmdInstalled, isQmdIndexBuilt, preflightQmd, buildQmdIndex } from './qmd-backend.mjs';

// Bump when a new capability ships. Each capability carries its own `version`
// (the release it landed in); this is the latest the checkout knows about.
export const CAPABILITIES_VERSION = 4;

// Human-facing "what's new", newest last. Printed by `hey upgrade --changelog`.
export const CHANGELOG = [
  { version: 1, items: ['Core checkout: Node dependencies, shared git hooks, derived index + catalog DB.'] },
  { version: 2, items: ['Local semantic search (qmd) — optional, prompted on upgrade.'] },
  { version: 3, items: ['Tooling-currency check: compares local hey CLI + skills versions against origin/main and nudges to pull.'] },
  { version: 4, items: ['Knowledge graph — integrated into mgmt; builds local SQLite projection (.kg/graph.sqlite); powers hey graph and procedure checks.'] },
];

// Each capability:
//   id        short stable key, also the display label
//   title     one-line human description
//   version   the CAPABILITIES_VERSION it shipped in
//   kind      'core'       → auto-applied when missing
//             'optional'   → prompted before applying (may be expensive)
//             'diagnostic' → checked and reported, never auto-applied (interactive fix)
//   check(repoRoot) → { ok, detail }
//   apply(repoRoot, { log }) → applies the fix; may be async; may throw  (omit for diagnostic)
//   prompt    optional confirm text (optional kind)
//   hint      shown when not ok and not auto-applied
const gitConfig = (repoRoot, key) => {
  try { return execFileSync('git', ['config', '--get', key], { cwd: repoRoot, encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

// Repo tooling versions live in package.json: `version` is the hey CLI version,
// `skillsVersion` is the Claude skills/commands version. They are the source of
// truth for "is my checkout's tooling current" — bump them when the respective
// part changes. `ref` reads from a git ref (e.g. 'origin/main'); omit for the
// working tree. Returns null when unavailable.
function toolingVersions(repoRoot, ref) {
  try {
    const raw = ref
      ? execFileSync('git', ['show', `${ref}:package.json`], { cwd: repoRoot, encoding: 'utf8' })
      : readFileSync(resolve(repoRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    return { hey: String(pkg.version ?? '0.0.0'), skills: String(pkg.skillsVersion ?? '0.0.0') };
  } catch {
    return null;
  }
}

// Dotted-numeric compare: <0 if a<b, 0 equal, >0 if a>b. Non-numeric parts → 0.
export function cmpVersion(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (parseInt(pa[i], 10) || 0) - (parseInt(pb[i], 10) || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// The knowledge-graph projection lives in the sibling checkout
// The knowledge graph projection lives internally in .kg/graph.sqlite (built via
// ./hey graph build, see decision_adr-consolidate-intelligence-graph-into-mgmt).
// Sibling checkout is kept as a fallback if present.
export const INTELLIGENCE_REPO = 'example-org/hey-intelligence';
export function intelligenceDir(repoRoot) {
  return process.env.KG_INTELLIGENCE_ROOT
    ? resolve(process.env.KG_INTELLIGENCE_ROOT)
    : resolve(repoRoot, '..', 'hey-intelligence');
}
export function intelligenceStatus(repoRoot) {
  const internalDb = resolve(repoRoot, '.kg/graph.sqlite');
  if (existsSync(internalDb)) {
    const built = statSync(internalDb).mtime.toISOString().slice(0, 16).replace('T', ' ');
    return { ok: true, detail: `built ${built}Z (internal)`, dir: repoRoot, missing: null };
  }
  const dir = intelligenceDir(repoRoot);
  if (!existsSync(resolve(dir, 'bin/kg.mjs'))) return { ok: false, detail: `not cloned (${dir})`, dir, missing: 'clone' };
  if (!existsSync(resolve(dir, 'node_modules'))) return { ok: false, detail: 'cloned, dependencies missing', dir, missing: 'install' };
  const graph = resolve(dir, 'build/graph.jsonl');
  if (!existsSync(graph)) return { ok: false, detail: 'installed, graph not built', dir, missing: 'build' };
  const built = statSync(graph).mtime.toISOString().slice(0, 16).replace('T', ' ');
  return { ok: true, detail: `built ${built}Z (${dir})`, dir, missing: null };
}

export const CAPABILITIES = [
  {
    id: 'dependencies',
    title: 'Node dependencies installed',
    version: 1,
    kind: 'core',
    check(repoRoot) {
      return existsSync(resolve(repoRoot, 'node_modules'))
        ? { ok: true, detail: 'installed' }
        : { ok: false, detail: 'node_modules missing' };
    },
    apply(repoRoot, { log }) {
      log('pnpm install');
      execFileSync('pnpm', ['install'], { cwd: repoRoot, stdio: 'inherit' });
    },
  },
  {
    id: 'git-hooks',
    title: 'Shared git hooks configured',
    version: 1,
    kind: 'core',
    check(repoRoot) {
      const path = gitConfig(repoRoot, 'core.hooksPath');
      return path === '.githooks'
        ? { ok: true, detail: 'core.hooksPath = .githooks' }
        : { ok: false, detail: path ? `core.hooksPath = ${path}` : 'core.hooksPath unset' };
    },
    apply(repoRoot, { log }) {
      log('git config core.hooksPath .githooks');
      execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repoRoot });
    },
  },
  {
    id: 'derived-index',
    title: 'Derived index + catalog DB built',
    version: 1,
    kind: 'core',
    check(repoRoot) {
      const manifest = existsSync(resolve(repoRoot, 'index/manifest.jsonl'));
      const catalog = existsSync(resolve(repoRoot, '.hey/catalog.sqlite'));
      if (manifest && catalog) return { ok: true, detail: 'index + catalog built' };
      const missing = [!manifest && 'index/manifest.jsonl', !catalog && '.hey/catalog.sqlite'].filter(Boolean);
      return { ok: false, detail: `missing ${missing.join(', ')}` };
    },
    async apply(repoRoot, { log }) {
      const { buildIndexes } = await import('./indexer.mjs');
      const { buildCatalogDatabase } = await import('./catalog-db.mjs');
      log('building index + catalog DB');
      buildIndexes(repoRoot);
      buildCatalogDatabase(repoRoot);
    },
  },
  {
    id: 'env',
    title: 'Member identity configured (.env)',
    version: 1,
    kind: 'diagnostic',
    hint: 'run /setup to configure MEMBER and LANGUAGE',
    check(repoRoot) {
      const p = resolve(repoRoot, '.env');
      if (!existsSync(p)) return { ok: false, detail: '.env missing' };
      const txt = readFileSync(p, 'utf8');
      const ok = /^\s*MEMBER\s*=\s*\S+/m.test(txt) && !/^\s*MEMBER\s*=\s*your-name\s*$/m.test(txt);
      return ok ? { ok: true, detail: 'MEMBER set' } : { ok: false, detail: 'MEMBER not set' };
    },
  },
  {
    id: 'semantic-search',
    title: 'Local semantic search (qmd) — recommended for natural-language search & deps check',
    version: 2,
    kind: 'optional',
    prompt: 'Enable local semantic search (qmd)? Recommended for natural-language search and deps check. One-time ~318MB model download + (macOS) `brew install sqlite`.',
    hint: 'enable later with `./hey index build --qmd` or `./hey upgrade --with-optional`',
    check(repoRoot) {
      return isQmdInstalled(repoRoot) && isQmdIndexBuilt(repoRoot)
        ? { ok: true, detail: 'enabled' }
        : { ok: false, detail: 'not enabled (search falls back to lexical)' };
    },
    async apply(repoRoot, { log }) {
      const pf = preflightQmd();
      if (!pf.ok) throw new Error(`cannot enable semantic search:\n        - ${pf.problems.join('\n        - ')}`);
      await buildQmdIndex(repoRoot, { log });
    },
  },
  {
    id: 'intelligence-graph',
    title: 'Knowledge graph projection (.kg/graph.sqlite: built via ./hey graph build)',
    version: 4,
    kind: 'optional',
    prompt: 'Set up the knowledge graph? builds .kg/graph.sqlite (<1s) for graph exploration, procedure guidance, and export.',
    hint: 'enable later with `./hey graph build` or `./hey upgrade --with-optional`',
    check(repoRoot) {
      const { ok, detail } = intelligenceStatus(repoRoot);
      return { ok, detail };
    },
    apply(repoRoot, { log }) {
      const internalKg = resolve(repoRoot, 'scripts/kg.mjs');
      if (existsSync(internalKg)) {
        log('node scripts/kg.mjs build');
        execFileSync(process.execPath, ['scripts/kg.mjs', 'build'], { cwd: repoRoot, stdio: 'inherit' });
        return;
      }
      const { dir, missing } = intelligenceStatus(repoRoot);
      if (missing === 'clone') {
        // Same org as this repo, so the URL that reaches mgmt (host alias, SSH or
        // HTTPS, whichever the member set up) reaches the sibling too. Fall back
        // to gh (carries GitHub auth), then plain HTTPS.
        const origin = gitConfig(repoRoot, 'remote.origin.url');
        const attempts = [];
        if (/hey-mgmt(\.git)?$/.test(origin)) attempts.push(['git', ['clone', origin.replace(/hey-mgmt(\.git)?$/, 'hey-intelligence$1'), dir]]);
        attempts.push(['gh', ['repo', 'clone', INTELLIGENCE_REPO, dir]]);
        attempts.push(['git', ['clone', `https://github.com/${INTELLIGENCE_REPO}.git`, dir]]);
        const errors = [];
        for (const [cmd, args] of attempts) {
          log(`${cmd} ${args.join(' ')}`);
          try { execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); break; }
          catch (error) { errors.push(`${cmd} ${args[0]}: ${(error.stderr?.toString() || error.message).trim().split('\n').pop()}`); }
        }
        if (!existsSync(resolve(dir, 'bin/kg.mjs'))) throw new Error(`could not clone ${INTELLIGENCE_REPO} (need example-org access):\n        - ${errors.join('\n        - ')}`);
      }
      if (!existsSync(resolve(dir, 'node_modules'))) {
        log('npm install (hey-intelligence)');
        execFileSync('npm', ['install', '--no-fund', '--no-audit'], { cwd: dir, stdio: 'inherit' });
      }
      const env = { ...process.env, KG_MGMT_ROOT: process.env.KG_MGMT_ROOT ?? repoRoot };
      log('node bin/kg.mjs build');
      execFileSync(process.execPath, ['bin/kg.mjs', 'build'], { cwd: dir, stdio: 'inherit', env });
    },
  },
  {
    id: 'tooling-current',
    title: 'Repo tooling current with main (hey CLI + skills versions)',
    version: 3,
    kind: 'diagnostic',
    hint: 'git pull to update the hey CLI, skills/commands, and hooks',
    check(repoRoot) {
      const local = toolingVersions(repoRoot, '');
      if (!local) return { ok: true, detail: 'version unknown (no package.json)' };

      // Best-effort refresh so the comparison is fresh; never fatal (offline ok).
      let online = true;
      try { execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: repoRoot, stdio: 'ignore' }); }
      catch { online = false; }
      const note = online ? '' : ' (offline; based on last fetch)';

      const remote = toolingVersions(repoRoot, 'origin/main');
      const vstr = `hey v${local.hey}, skills v${local.skills}`;
      if (!remote) return { ok: true, detail: `${vstr} (no origin/main to compare)${note}` };

      const heyBehind = cmpVersion(local.hey, remote.hey) < 0;
      const skillsBehind = cmpVersion(local.skills, remote.skills) < 0;
      let behind = 0;
      try { behind = Number(execFileSync('git', ['rev-list', '--count', 'HEAD..origin/main'], { cwd: repoRoot, encoding: 'utf8' }).trim()) || 0; }
      catch { /* ignore */ }

      if (heyBehind || skillsBehind) {
        const parts = [
          heyBehind ? `hey v${local.hey} < main v${remote.hey}` : `hey v${local.hey}`,
          skillsBehind ? `skills v${local.skills} < main v${remote.skills}` : `skills v${local.skills}`,
        ];
        return { ok: false, detail: `${parts.join(', ')}${behind ? ` — ${behind} commits behind` : ''}${note}` };
      }
      if (behind) return { ok: true, detail: `${vstr} — current tooling; ${behind} commits behind (content)${note}` };
      return { ok: true, detail: `${vstr} — up to date with main${note}` };
    },
  },
];
