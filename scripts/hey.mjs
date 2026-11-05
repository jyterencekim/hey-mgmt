#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Command } from 'commander';
import chokidar from 'chokidar';
import { buildIndexes, loadManifest, manifestNeedsBuild, validateRepository } from './lib/indexer.mjs';
import { compileContextPack, searchRepositoryAdaptive, searchUnified } from './lib/retrieval.mjs';
import { scaffoldTaskFile, scaffoldArtifact } from './lib/scaffold.mjs';
import { MarkdownTracker } from './lib/tracker.mjs';
import { WorkflowLoader } from './lib/workflow-loader.mjs';
import { WorkspaceManager } from './lib/workspace-mgr.mjs';
import { parseExtraFields } from './lib/field-parser.mjs';
import { parseArtifact, writeArtifact } from './lib/content-io.mjs';
import { acknowledgeInboxItem, captureInboxItem, sendInboxItem, listInboxItems, getInboxItem, discardInboxItem, promoteInboxItem, replyToInboxItem } from './lib/inbox.mjs';
import { currentIteration } from './lib/iteration.mjs';
import { validatePlannedDate } from './lib/task-plan.mjs';
import { TASK_STATUS_VALUES } from './lib/frontmatter-schema.mjs';
import * as loopHealth from './lib/loop-health.mjs';
import { applyCarryPlan, buildCarryPlan, formatCarryPlan } from './lib/iteration-carry.mjs';
import { buildHygieneReport, formatHygieneReport } from './lib/hygiene.mjs';
import { buildProductInitiativeReport, formatProductInitiativeReport, kickoffInitiative, sendProductGapAlerts } from './lib/product-initiative.mjs';
import { buildLoopBoard, buildLoopBrief, buildLoopHorizon, formatLoopBoard, formatLoopBrief, formatLoopHorizon } from './lib/loop-control.mjs';
import { buildLoopDigest, formatLoopDigest, recordLoopDigest } from './lib/loop-digest.mjs';
import { applyLogScaffold, buildLogScaffold, renderScaffoldSection } from './lib/log-scaffold.mjs';
import { buildIterationPrepackage, formatIterationPrepackage } from './lib/iteration-prepackage.mjs';
import { buildPrCheck, formatPrCheck } from './lib/pr-status.mjs';
import { compileMissionBrief, renderMissionMarkdown, writeMissionPack } from './lib/mission.mjs';
import { formatScheduledActionPackets, listScheduledActionPackets } from './lib/scheduled-packets.mjs';
import { listRunAttempts } from './lib/work-runs.mjs';
import { compactLogs, listMembers, logStats } from './lib/log-compact.mjs';
import { checkProposalFile, gateProposalFile } from './lib/procedure-gate.mjs';
import { pollSource, prepareCandidates, finalizeCandidatesFromAgent, getActivityCandidates, approveActivityCandidate, rejectActivityCandidateById } from './lib/activity-runner.mjs';

// Load .env for member identity
const envPath = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

function detectRepoRoot() {
  const envRoot = process.env.HEY_REPO_ROOT;
  if (envRoot) {
    return resolve(envRoot);
  }

  let dir = resolve(process.cwd());
  while (true) {
    if (existsSync(resolve(dir, 'content')) && existsSync(resolve(dir, '.git'))) {
      return dir;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  return resolve(process.cwd());
}

/**
 * Loop-health banner, printed after the issue list and never folded into it.
 *
 * It rides `validate` because `validate` already runs unattended on every file
 * write via hook — a stalled automation must not wait for someone to run a
 * checking command. It prints below the summary rather than as a warning
 * because the repo carries hundreds of pre-existing warnings, and a signal
 * buried among them is not a signal. It never changes the exit code: a stalled
 * cron is not a reason to block someone's edit.
 */
function printLoopHealth() {
  try {
    const { checkDigestHeartbeat, buildBacklogHealth, formatHealthBanner } = loopHealth;
    const banner = formatHealthBanner({
      heartbeat: checkDigestHeartbeat(repoRoot),
      health: buildBacklogHealth(repoRoot),
    });
    if (banner) console.log(`\n${banner}`);
  } catch {
    // Health is advisory. A missing index or members file must never turn a
    // validation run into a failure.
  }
}

function printValidation(report) {
  if (report.issues.length === 0) {
    console.log('Validation OK: no issues found.');
    printLoopHealth();
    return;
  }

  for (const issue of report.issues) {
    const prefix = issue.level === 'error' ? 'ERROR' : 'WARN';
    console.log(`${prefix} [${issue.id}] ${issue.path} - ${issue.message}`);
  }

  const errors = report.issues.filter((issue) => issue.level === 'error').length;
  const warnings = report.issues.filter((issue) => issue.level === 'warning').length;
  console.log(`\nSummary: ${errors} error(s), ${warnings} warning(s)`);
  printLoopHealth();
}

function runId() {
  const stamp = Date.now().toString(36).toUpperCase().padStart(10, '0').slice(-10);
  const tail = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `run_${stamp}${tail}`;
}

function collect(value, previous) {
  return [...(previous ?? []), value];
}

const repoRoot = detectRepoRoot();

function ensureManifestFreshForRead(label) {
  if (!manifestNeedsBuild(repoRoot)) return;
  try {
    buildIndexes(repoRoot);
    console.error(`[${label}] auto-rebuilt: index`);
  } catch (error) {
    console.error(`[${label}] manifest rebuild skipped: ${error.message}. Falling back to existing index/manifest.jsonl. Run \`./hey validate\` for details.`);
  }
}

// hey CLI version — single source of truth is package.json `version`.
let heyVersion = '0.0.0';
try {
  heyVersion = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')).version || heyVersion;
} catch { /* fall back to placeholder if package.json is unreadable */ }

const program = new Command();
program.name('hey').description('Team OS CLI').version(heyVersion);

program
  .command('validate')
  .description('Validate markdown artifacts, IDs, relation targets, and policy checks')
  .option('--with-kg', 'Also validate Knowledge Graph adapters and consistency')
  .action(async (options) => {
    const result = validateRepository(repoRoot);
    printValidation(result.report);
    if (!result.report.ok) process.exitCode = 1;

    // Optional: Codex adapters (.agents/skills/*/SKILL.md) check if scripts/codex-skill-sync.py exists
    const codexSyncScript = resolve(repoRoot, 'scripts', 'codex-skill-sync.py');
    if (existsSync(codexSyncScript)) {
      const { spawnSync } = await import('node:child_process');
      const sync = spawnSync('python3', [codexSyncScript, '--check'], { encoding: 'utf8' });
      if (sync.error) {
        console.log(`codex-skill-sync: skipped (${sync.error.message})`);
      } else {
        process.stdout.write(sync.stdout || '');
        if (sync.status !== 0) process.exitCode = 1;
      }
    }

    if (options.withKg) {
      console.log('\n--- Knowledge Graph Validation ---');
      const { runKg } = await import('./kg.mjs');
      await runKg(['validate']);
    }
  });

program
  .command('upgrade')
  .description('Bring this checkout up to spec (idempotent, repo-wide). Auto-applies core capabilities; prompts before optional ones.')
  .option('--check', 'Report status only; make no changes (doctor mode)')
  .option('--yes', 'Non-interactive: auto-apply core, skip optional')
  .option('--with-optional', 'Also apply optional capabilities (e.g. semantic search) without prompting')
  .option('--changelog', 'Print the capability changelog and exit')
  .action(async (options) => {
    const { CAPABILITIES, CAPABILITIES_VERSION, CHANGELOG } = await import('./lib/capabilities.mjs');

    if (options.changelog) {
      console.log(`Capability changelog (latest v${CAPABILITIES_VERSION})\n`);
      for (const entry of [...CHANGELOG].reverse()) {
        console.log(`v${entry.version}`);
        for (const item of entry.items) console.log(`  - ${item}`);
      }
      return;
    }

    const sym = { ok: '✓', warn: '⚠', off: '○', fail: '✗' };
    const line = (mark, cap, detail) => `  ${mark} ${cap.id.padEnd(18)} v${cap.version}  ${detail}`;

    let rl = null;
    const confirm = async (text) => {
      if (options.withOptional) return true;
      if (options.yes) return false;
      if (!input.isTTY) return false; // non-interactive without a TTY → don't apply optional
      rl ??= readline.createInterface({ input, output });
      const answer = (await rl.question(`${text} [y/N] `)).trim().toLowerCase();
      return answer === 'y' || answer === 'yes';
    };

    console.log(`Repo capabilities (v${CAPABILITIES_VERSION})\n`);
    const applied = [];
    const skipped = [];
    const failed = [];

    for (const cap of CAPABILITIES) {
      const status = cap.check(repoRoot);
      if (status.ok) {
        console.log(line(sym.ok, cap, status.detail));
        continue;
      }
      if (cap.kind === 'diagnostic') {
        console.log(line(sym.warn, cap, `${status.detail}${cap.hint ? ` — ${cap.hint}` : ''}`));
        continue;
      }
      if (options.check) {
        console.log(line(sym.off, cap, `${status.detail} (would ${cap.kind === 'core' ? 'apply' : 'offer'})`));
        continue;
      }

      let proceed = cap.kind === 'core';
      if (cap.kind === 'optional') {
        console.log(line(sym.off, cap, status.detail));
        proceed = await confirm(`      ${cap.prompt || 'Enable?'}`);
        if (!proceed) {
          skipped.push(cap.id);
          if (cap.hint) console.log(`      skipped — ${cap.hint}`);
          continue;
        }
      }

      try {
        console.log(`  … ${cap.id}: applying`);
        await cap.apply(repoRoot, { log: (m) => console.error(`      ${m}`) });
        const after = cap.check(repoRoot);
        console.log(line(after.ok ? sym.ok : sym.warn, cap, after.detail));
        applied.push(cap.id);
      } catch (error) {
        failed.push(cap.id);
        console.error(line(sym.fail, cap, error.message));
      }
    }

    if (rl) rl.close();
    const verb = options.check ? 'Check complete' : 'Upgrade complete';
    console.log(`\n${verb} — applied: ${applied.length}, skipped: ${skipped.length}, failed: ${failed.length}`);
    if (failed.length) process.exitCode = 1;
  });

program
  .command('new')
  .description('Create a new artifact (agent-friendly, non-interactive)')
  .requiredOption('--type <type>', 'Artifact type: task, decision, meeting, playbook, note, initiative, goal')
  .requiredOption('--title <title>', 'Artifact title')
  .option('--area <area>', 'Area name')
  .option('--owner <owner>', 'Owner')
  .option('--status <status>', 'Status (default: ready for task, active for other types)')
  .option('--priority <priority>', 'Priority (do, plan, routine, drop)')
  .option('--due <date>', 'Due date (YYYY-MM-DD)')
  .option('--iteration <iteration>', 'Iteration (e.g. 2026-W10)')
  .option('--field <fields...>', 'Extra fields as key=value pairs')
  .option('--workspace <member>', 'Create in member workspace')
  .action((options) => {
    const extraFields = parseExtraFields(options.field);

    if (options.area) extraFields.area = options.area;
    const resolvedOwner = options.owner || process.env.MEMBER;
    if (resolvedOwner) extraFields.owner = resolvedOwner;
    // A product initiative starts in `plan` and becomes `active` only through
    // `./hey initiative kickoff` (decision_adr-product-initiative-kickoff D2).
    const isProductInitiative = options.type === 'initiative' && extraFields.x_initiative_kind === 'product';
    const defaultStatus = options.type === 'task' ? 'ready' : isProductInitiative ? 'plan' : 'active';
    extraFields.status = options.status ?? defaultStatus;
    if (options.priority) extraFields.priority = options.priority;
    if (options.due) extraFields.due_date = options.due;
    if (options.iteration) extraFields.iteration = options.iteration;
    if (options.type === 'task' && !extraFields.iteration && ['ready', 'blocked', 'doing'].includes(extraFields.status)) {
      extraFields.iteration = currentIteration();
    }

    // For tasks, ensure definition_of_done exists
    if (options.type === 'task' && !extraFields.definition_of_done) {
      extraFields.definition_of_done = ['TODO: define definition of done'];
    }

    const result = scaffoldArtifact({
      repoRoot,
      type: options.type,
      title: options.title,
      extraFields,
      workspace: options.workspace,
    });

    // Output as JSON for easy agent parsing
    console.log(JSON.stringify({
      created: true,
      id: result.id,
      path: result.relativePath,
    }));
  });

const index = program.command('index').description('Derived index operations');

index
  .command('build')
  .description('Build index/* from content/*')
  .option('--qmd', 'Install (first run) and (re)build the optional local qmd semantic index under .hey/qmd/')
  .action(async (options) => {
    const built = buildIndexes(repoRoot);
    console.log(`Indexed ${built.manifest.length} artifact(s).`);
    // Keep the optional qmd index fresh. Explicit --qmd installs+builds. Otherwise
    // opportunistically refresh ONLY when qmd is already installed+built AND stale —
    // so every command that runs `index build` (morning/sync/standup/...) keeps qmd
    // current, with no install or surprise downloads on machines that don't use it.
    const { isQmdAvailable, isQmdIndexFresh, buildQmdIndex } = await import('./lib/qmd-backend.mjs');
    const opportunistic = !options.qmd && isQmdAvailable(repoRoot) && !isQmdIndexFresh(repoRoot);
    if (options.qmd || opportunistic) {
      try {
        const r = await buildQmdIndex(repoRoot);
        console.log(`qmd index: ${r.chunks_embedded} chunk(s) embedded over [${r.collections.join(', ')}] at ${r.index_path}`);
      } catch (error) {
        console.error(`qmd index ${options.qmd ? 'build' : 'refresh'} failed (lexical index is unaffected): ${error.message}`);
        if (options.qmd) process.exitCode = 1;
      }
    }
  });

index
  .command('watch')
  .description('Watch content/ and rebuild indexes on change')
  .action(() => {
    console.log('Watching content/ for changes...');

    let timer;
    const scheduleBuild = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const built = buildIndexes(repoRoot);
          console.log(`[index] rebuilt ${built.manifest.length} artifact(s) at ${new Date().toISOString()}`);
        } catch (error) {
          console.error(`[index] rebuild failed: ${error.message}`);
        }
      }, 250);
    };

    scheduleBuild();
    const watcher = chokidar.watch([resolve(repoRoot, 'content'), resolve(repoRoot, 'workspace')], { ignoreInitial: true });
    watcher.on('all', scheduleBuild);
  });

const db = program.command('db').description('Local derived sqlite catalog');

db
  .command('build')
  .description('Build .hey/catalog.sqlite from index/manifest.jsonl')
  .action(async () => {
    const { buildCatalogDatabase } = await import('./lib/catalog-db.mjs');
    buildIndexes(repoRoot);
    const path = buildCatalogDatabase(repoRoot);
    console.log(`Catalog DB built: ${path}`);
  });

db
  .command('query')
  .description('Run SQL query against local catalog (auto-rebuilds index/catalog when stale)')
  .argument('<sql>', 'SQL statement')
  .option('--no-rebuild', 'Skip stale-detection auto-rebuild (CI / debugging escape hatch)')
  .action(async (sql, options) => {
    const { queryCatalog, ensureCatalogFresh } = await import('./lib/catalog-db.mjs');
    if (options.rebuild !== false) {
      const rebuilt = ensureCatalogFresh(repoRoot);
      if (rebuilt.manifest || rebuilt.db) {
        const parts = [];
        if (rebuilt.manifest) parts.push('index');
        if (rebuilt.db) parts.push('catalog');
        console.error(`[hey db query] auto-rebuilt: ${parts.join(' + ')}`);
      }
    }
    const rows = queryCatalog({ repoRoot, sql });
    console.log(JSON.stringify(rows, null, 2));
  });

db
  .command('shell')
  .description('Interactive SQL shell against local catalog (auto-rebuilds index/catalog when stale)')
  .option('--no-rebuild', 'Skip stale-detection auto-rebuild (CI / debugging escape hatch)')
  .action(async (options) => {
    const { queryCatalog, ensureCatalogFresh } = await import('./lib/catalog-db.mjs');
    if (options.rebuild !== false) {
      const rebuilt = ensureCatalogFresh(repoRoot);
      if (rebuilt.manifest || rebuilt.db) {
        const parts = [];
        if (rebuilt.manifest) parts.push('index');
        if (rebuilt.db) parts.push('catalog');
        console.error(`[hey db shell] auto-rebuilt: ${parts.join(' + ')}`);
      }
    }
    const rl = readline.createInterface({ input, output });
    console.log("hey db shell. Enter SQL or '.exit'.");

    while (true) {
      const line = (await rl.question('sql> ')).trim();
      if (!line) continue;
      if (line === '.exit' || line === '.quit') break;

      try {
        const rows = queryCatalog({ repoRoot, sql: line });
        console.log(JSON.stringify(rows, null, 2));
      } catch (error) {
        console.error(error.message);
      }
    }

    rl.close();
  });

program
  .command('search')
  .description('Search indexed artifacts with optional filters')
  .argument('<query>', 'Search query')
  .option('--type <type>')
  .option('--area <area>')
  .option('--status <status>')
  .option('--owner <owner>')
  .option('--author <author>')
  .option('--entity <entity>')
  .option('--limit <limit>', 'Result limit', '20')
  .option('--mode <mode>', 'explore|decide', 'explore')
  .option('--backend <backend>', 'auto|lexical|qmd (auto uses the local qmd index when present)', 'auto')
  .option('--include-knowledge', 'Include external knowledge (Slack, Confluence, Drive, GitHub context)')
  .option('--knowledge-owner <owner>', 'Filter knowledge by workspace owner ("*" for all)')
  .action(async (query, options) => {
    if (options.includeKnowledge) {
      const results = await searchUnified(
        query,
        {
          type: options.type,
          area: options.area,
          status: options.status,
          owner: options.knowledgeOwner ?? '*',
          author: options.author,
          entity: options.entity,
        },
        {
          repoRoot,
          limit: Number(options.limit),
          mode: options.mode,
          backend: options.backend,
        }
      );
      console.log(JSON.stringify(results, null, 2));
    } else {
      const results = await searchRepositoryAdaptive(
        query,
        {
          type: options.type,
          area: options.area,
          status: options.status,
          owner: options.owner,
          author: options.author,
          entity: options.entity
        },
        {
          repoRoot,
          limit: Number(options.limit),
          mode: options.mode,
          backend: options.backend,
        }
      );
      console.log(JSON.stringify(results, null, 2));
    }
    // Recommend qmd to members who run real queries without it installed.
    if (query && String(query).trim()) {
      try {
        const { recommendQmdInstall } = await import('./lib/qmd-backend.mjs');
        recommendQmdInstall(repoRoot);
      } catch { /* never let a hint break search */ }
    }
  });

const deps = program.command('deps').description('Dependency knowledge-base retrieval');

deps
  .command('check')
  .description('Surface dependency obligations for an intended change')
  .argument('<intent>', 'Free-text change intent')
  .option('--repos <repos>', 'Comma-separated repo hints')
  .option('--paths <paths>', 'Comma-separated path hints')
  .option('--area <area>', 'Area hint')
  .option('--entities <entities>', 'Comma-separated entity hints')
  .option('--limit <limit>', 'Result limit', '10')
  .option('--json', 'Output raw JSON')
  .action(async (intent, options) => {
    buildIndexes(repoRoot);
    // qmd semantic recall is the PRIMARY recall channel for the deps gate
    // (decision_adr-kb-wide-change-contracts): it surfaces contracts whose
    // trigger terms don't lexically overlap the intent. Still per-machine
    // optional — absent/failed degrades to structured + lexical, but loudly.
    let semanticById;
    try {
      const { ensureFreshIndex, searchQmdHybrid } = await import('./lib/qmd-backend.mjs');
      if (await ensureFreshIndex(repoRoot)) {
        const hits = await searchQmdHybrid(repoRoot, intent, { limit: 50 });
        semanticById = new Map(hits.map((h) => [h.id, h.score]));
      }
    } catch { /* qmd failed — fall back to structured + lexical */ }
    if (!semanticById) {
      console.error('deps check: semantic recall unavailable (qmd not installed or failed) — structured + lexical only; recall is degraded.');
      console.error('  Enable: ./hey index build --qmd   (decision_adr-kb-wide-change-contracts)');
    }
    const { checkDependencies } = await import('./lib/deps.mjs');
    const result = checkDependencies({
      repoRoot,
      intent,
      repos: options.repos ?? '',
      paths: options.paths ?? '',
      area: options.area ?? null,
      entities: options.entities ?? '',
      limit: Number(options.limit),
      semanticById
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.matches.length === 0) {
      console.log(`No dependency matches found for: ${intent}`);
      return;
    }

    console.log(`Dependency matches for: ${intent}\n`);
    for (const [index, match] of result.matches.entries()) {
      console.log(`${index + 1}. ${match.id} — ${match.title} [score ${match.score.toFixed(2)}]`);
      if (match.reasons.length > 0) {
        console.log(`   Why: ${match.reasons.join('; ')}`);
      }
      for (const obligation of match.obligations) {
        console.log(`   [${obligation.severity}] ${obligation.title}`);
        for (const action of obligation.actions) {
          console.log(`   - ${action}`);
        }
      }
      if (match.verification.length > 0) {
        console.log(`   Verification: ${match.verification.join('; ')}`);
      }
      if (match.related_artifacts.length > 0) {
        console.log(`   Related context: ${match.related_artifacts.map((item) => item.id).join(', ')}`);
      }
      console.log('');
    }
  });

deps
  .command('list')
  .description('List authoritative dependency notes')
  .option('--repo <repo>', 'Filter by repo')
  .option('--area <area>', 'Filter by area')
  .option('--entity <entity>', 'Filter by entity')
  .option('--json', 'Output raw JSON')
  .action(async (options) => {
    buildIndexes(repoRoot);
    const { listDependencies } = await import('./lib/deps.mjs');
    const results = listDependencies({
      repoRoot,
      repo: options.repo ?? null,
      area: options.area ?? null,
      entity: options.entity ?? null,
    });

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log('No dependency notes found.');
      return;
    }

    console.log(`\n  ${'ID'.padEnd(38)} ${'Area'.padEnd(18)} ${'Owner'.padEnd(12)} Title`);
    console.log(`  ${'─'.repeat(38)} ${'─'.repeat(18)} ${'─'.repeat(12)} ${'─'.repeat(32)}`);
    for (const result of results) {
      console.log(`  ${result.id.padEnd(38)} ${(result.area ?? '-').padEnd(18)} ${(result.owner ?? '-').padEnd(12)} ${result.title}`);
    }
    console.log(`\n  ${results.length} dependency note(s)\n`);
  });

deps
  .command('show')
  .description('Show one dependency note with related context')
  .argument('<id>', 'Dependency note id')
  .option('--json', 'Output raw JSON')
  .action(async (id, options) => {
    buildIndexes(repoRoot);
    const { showDependency } = await import('./lib/deps.mjs');
    const result = showDependency({ repoRoot, id });

    if (!result) {
      console.error(`Dependency note not found: ${id}`);
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`${result.id} — ${result.title}\n`);
    console.log(`Path: ${result.path}`);
    if (result.area) console.log(`Area: ${result.area}`);
    if (result.owner) console.log(`Owner: ${result.owner}`);
    console.log('\nTriggers:');
    console.log(JSON.stringify(result.contract.triggers, null, 2));
    console.log('\nObligations:');
    console.log(JSON.stringify(result.contract.obligations, null, 2));
    if (result.contract.verification.length > 0) {
      console.log('\nVerification:');
      console.log(JSON.stringify(result.contract.verification, null, 2));
    }
    if (result.related_artifacts.length > 0) {
      console.log('\nRelated context:');
      for (const item of result.related_artifacts) {
        console.log(`- ${item.id} (${item.type})`);
      }
    }
  });

const context = program.command('context').description('Context-pack compilation');

context
  .command('compile')
  .description('Compile a context pack')
  .requiredOption('--mode <mode>', 'explore|decide')
  .requiredOption('--intent <intent>', 'Objective intent')
  .option('--area <area>')
  .option('--days <days>', 'Lookback days', '90')
  .option('--types <types>', 'Comma-separated allowed types')
  .option('--entities <entities>', 'Comma-separated entities')
  .option('--query <query>')
  .option('--limit <limit>', 'Candidate limit', '12')
  .option('--out <path>', 'Output file path')
  .action((options) => {
    const pack = compileContextPack({
      repoRoot,
      mode: options.mode,
      intent: options.intent,
      area: options.area,
      time_window_days: Number(options.days),
      types_allowed: options.types
        ? options.types.split(',').map((item) => item.trim()).filter(Boolean)
        : undefined,
      entities: options.entities
        ? options.entities.split(',').map((item) => item.trim()).filter(Boolean)
        : undefined,
      query: options.query,
      limit: Number(options.limit)
    });

    const payload = `${JSON.stringify(pack, null, 2)}\n`;
    if (options.out) {
      const outPath = resolve(repoRoot, options.out);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, payload, 'utf8');
      console.log(`Context pack written to ${outPath}`);
    } else {
      console.log(payload);
    }
  });

const agent = program.command('agent').description('Agent run contract utilities');

agent
  .command('run')
  .description('Record an agent run envelope in .hey/runs')
  .requiredOption('--role <role>', 'Agent role')
  .requiredOption('--objective <objective>', 'Run objective')
  .requiredOption('--mode <mode>', 'explore|decide')
  .option('--context <path>', 'Path to context pack JSON')
  .action((options) => {
    const id = runId();
    const runDir = resolve(repoRoot, '.hey', 'runs', id);
    mkdirSync(runDir, { recursive: true });

    const contextPack = options.context
      ? JSON.parse(readFileSync(resolve(repoRoot, options.context), 'utf8'))
      : compileContextPack({
          repoRoot,
          mode: options.mode,
          intent: options.objective,
          time_window_days: 30,
        });

    writeFileSync(resolve(runDir, 'context_pack.json'), `${JSON.stringify(contextPack, null, 2)}\n`, 'utf8');
    writeFileSync(
      resolve(runDir, 'agent_io.json'),
      `${JSON.stringify(
        {
          objective: options.objective,
          mode: options.mode,
          role: options.role,
          started_at: new Date().toISOString(),
          artifacts: [],
          sources_records: [],
          confidence: 0.5,
          open_questions: [],
          approval_requests: []
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    writeFileSync(resolve(runDir, 'patch.diff'), '', 'utf8');

    console.log(`Run scaffolded at ${runDir}`);
  });

const procedure = program.command('procedure').description('Procedure-graph proposals (decision_adr-kg-v2-operating-decisions D2/D3)');

procedure
  .command('check')
  .description('Structural check of a procedure-graph proposal against its playbook (read-only)')
  .argument('<file>', 'Proposal YAML (workspace/<owner>/proposals/*.yml)')
  .action(async (file) => {
    const r = await checkProposalFile(repoRoot, file);
    if (r.errors.length) { r.errors.forEach((e) => console.error(`✖ ${e}`)); process.exit(1); }
    console.log(`ok: candidate ${r.candidate.nodes.length} nodes / ${r.candidate.edges.length} edges (base ${r.graph?.nodes?.length ?? 0} / ${r.graph?.edges?.length ?? 0}) for ${r.playbookPath}`);
  });

procedure
  .command('gate')
  .description('Accept or reject a proposal; accept writes the candidate graph into the playbook')
  .argument('<file>', 'Proposal YAML')
  .option('--accept', 'Accept the proposal')
  .option('--reject', 'Reject the proposal')
  .option('--reviewer <id>', 'member:<name> (defaults to member:$MEMBER)')
  .option('--reason <text>', 'Decision reason (required for the owner gate)')
  .option('--score <n>', 'Metric gate: candidate score')
  .option('--baseline <n>', 'Metric gate: retained-graph score')
  .option('--gate <kind>', 'owner | metric (inferred from --score when omitted)')
  .action(async (file, options) => {
    if (Boolean(options.accept) === Boolean(options.reject)) throw new Error('pass exactly one of --accept / --reject');
    const reviewer = options.reviewer ?? (process.env.MEMBER ? `member:${process.env.MEMBER}` : null);
    const r = await gateProposalFile(repoRoot, file, {
      accept: Boolean(options.accept), reviewer, reason: options.reason,
      score: options.score, baseline: options.baseline, gate: options.gate,
    });
    console.log(`${r.decision.outcome} by ${r.decision.by} via ${r.decision.gate} gate: ${r.decision.reason}`);
    if (r.decision.outcome === 'accepted') {
      validateRepository(repoRoot);
      console.log(`wrote ${r.playbookPath} — review and commit it`);
    }
  });

const graph = program.command('graph').description('Unified Knowledge Graph operations (projection, search, guidance, export)');

graph
  .command('build')
  .description('Rebuild .kg/graph.sqlite and .kg/graph.jsonl from source artifacts')
  .action(async () => {
    const { runKg } = await import('./kg.mjs');
    await runKg(['build']);
  });

graph
  .command('stats')
  .description('Display knowledge graph statistics and memory breakdown')
  .action(async () => {
    const { runKg } = await import('./kg.mjs');
    await runKg(['stats']);
  });

graph
  .command('search')
  .description('Search nodes in the knowledge graph')
  .argument('<term>', 'Search query')
  .option('--limit <n>', 'Maximum results', '20')
  .action(async (term, options) => {
    const { runKg } = await import('./kg.mjs');
    await runKg(['search', term, `--limit=${options.limit}`]);
  });

graph
  .command('node')
  .description('Inspect a single node by ID')
  .argument('<id>', 'Node ID (e.g. mgmt:task_..., auditor:..., proc:...)')
  .action(async (id) => {
    const { runKg } = await import('./kg.mjs');
    await runKg(['node', id]);
  });

graph
  .command('neighborhood')
  .description('Explore adjacent nodes in the graph (bounded typed walk)')
  .argument('<id>', 'Node ID')
  .option('--hops <n>', 'Hop distance', '2')
  .option('--rel <types>', 'Comma-separated relation filter')
  .option('--dir <direction>', 'out | in | both', 'out')
  .option('--derived', 'Include derived reciprocal edges')
  .option('--json', 'Output raw JSON')
  .action(async (id, options) => {
    const { runKg } = await import('./kg.mjs');
    const args = ['neighborhood', id, `--hops=${options.hops}`, `--dir=${options.dir}`];
    if (options.rel) args.push(`--rel=${options.rel}`);
    if (options.derived) args.push('--derived');
    if (options.json) args.push('--json');
    await runKg(args);
  });

graph
  .command('backlinks')
  .description('List incoming edges grouped by relation')
  .argument('<id>', 'Node ID')
  .option('--json', 'Output raw JSON')
  .action(async (id, options) => {
    const { runKg } = await import('./kg.mjs');
    const args = ['backlinks', id];
    if (options.json) args.push('--json');
    await runKg(args);
  });

graph
  .command('children')
  .description('List child nodes connected via parent_of')
  .argument('<id>', 'Node ID')
  .option('--json', 'Output raw JSON')
  .action(async (id, options) => {
    const { runKg } = await import('./kg.mjs');
    const args = ['children', id];
    if (options.json) args.push('--json');
    await runKg(args);
  });

graph
  .command('path')
  .description('Find shortest path between two nodes')
  .argument('<from>', 'Start node ID')
  .argument('<to>', 'Target node ID')
  .option('--json', 'Output raw JSON')
  .action(async (from, to, options) => {
    const { runKg } = await import('./kg.mjs');
    const args = ['path', from, to];
    if (options.json) args.push('--json');
    await runKg(args);
  });

graph
  .command('isolated')
  .description('List nodes with zero authored edges')
  .option('--ns <namespace>', 'Filter by namespace')
  .option('--json', 'Output raw JSON')
  .action(async (options) => {
    const { runKg } = await import('./kg.mjs');
    const args = ['isolated'];
    if (options.ns) args.push(`--ns=${options.ns}`);
    if (options.json) args.push('--json');
    await runKg(args);
  });

graph
  .command('guidance')
  .description('Retrieve execution guidance and pitfalls from playbook procedure graphs')
  .argument('[playbook]', 'Playbook ID or filename')
  .option('--tool <cmd>', 'Locate active procedure node by previous tool call')
  .option('--at <node>', 'Active procedure node ID')
  .option('--hops <n>', 'Guidance lookahead hops', '2')
  .action(async (playbook, options) => {
    const { runKg } = await import('./kg.mjs');
    const args = ['guidance'];
    if (playbook) args.push(playbook);
    if (options.tool) args.push(`--tool=${options.tool}`);
    if (options.at) args.push(`--at=${options.at}`);
    if (options.hops) args.push(`--hops=${options.hops}`);
    await runKg(args);
  });

graph
  .command('import-auditor')
  .description('Pull protocol-knowledge facts from Auditor API into imports/auditor.jsonl')
  .option('--url <url>', 'Auditor API base URL')
  .action(async (options) => {
    const { runKg } = await import('./kg.mjs');
    const args = ['import-auditor'];
    if (options.url) args.push(`--url=${options.url}`);
    await runKg(args);
  });

graph
  .command('export')
  .description('Export sanitized or full knowledge graph for external consumers')
  .option('--scope <scope>', 'public (sanitized) | all (full) | protocol', 'public')
  .option('--format <format>', 'jsonl | json | sqlite', 'jsonl')
  .option('--ns <namespaces>', 'Comma-separated namespace filter')
  .option('--out <path>', 'Output destination path')
  .action(async (options) => {
    const { runKg } = await import('./kg.mjs');
    const args = ['export', `--scope=${options.scope}`, `--format=${options.format}`];
    if (options.ns) args.push(`--ns=${options.ns}`);
    if (options.out) args.push(`--out=${options.out}`);
    await runKg(args);
  });

graph
  .command('validate')
  .description('Validate knowledge graph source adapters and edge consistency')
  .option('--json', 'Output report as JSON')
  .action(async (options) => {
    const { runKg } = await import('./kg.mjs');
    const args = ['validate'];
    if (options.json) args.push('--json');
    await runKg(args);
  });

const mission = program.command('mission').description('Mission brief utilities');

function runMissionCompileCommand(options) {
  try {
    buildIndexes(repoRoot);
    const missionBrief = compileMissionBrief(repoRoot, {
      taskId: options.task,
      dependencyLimit: Number(options.dependencyLimit ?? 5),
    });
    const written = options.write === false
      ? null
      : writeMissionPack(repoRoot, missionBrief, { outDir: options.out ?? undefined });

    if (options.json) {
      console.log(JSON.stringify({ mission: missionBrief, written }, null, 2));
      return;
    }

    if (written) {
      console.log(`Mission pack written: ${written.out_dir}\n`);
    }
    console.log(renderMissionMarkdown(missionBrief));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

for (const commandName of ['compile', 'draft']) {
  mission
    .command(commandName)
    .description(commandName === 'compile' ? 'Compile a mission brief from a task id' : 'Draft a mission brief from a task id')
    .requiredOption('--task <taskId>', 'Task ID')
    .option('--dependency-limit <n>', 'Dependency match limit', '5')
    .option('--out <path>', 'Output directory (default: .hey/missions/<task_id>)')
    .option('--no-write', 'Do not write mission.json/mission.md')
    .option('--json', 'Output JSON')
    .action(runMissionCompileCommand);
}

const loop = program.command('loop').description('Loop control projections');

loop
  .command('board')
  .description('Show tasks grouped by driver attention lane')
  .option('--member <member>', 'Filter by owner/member')
  .option('--iteration <iteration>', 'Filter by iteration')
  .option('--done-since-days <days>', 'Days of done tasks to include', '7')
  .option('--today <date>', 'Override today (YYYY-MM-DD)')
  .option('--json', 'Output JSON')
  .action((options) => {
    buildIndexes(repoRoot);
    const board = buildLoopBoard(repoRoot, {
      member: options.member ?? null,
      iteration: options.iteration ?? null,
      doneSinceDays: Number(options.doneSinceDays),
      today: options.today ?? null,
    });

    if (options.json) {
      console.log(JSON.stringify(board, null, 2));
      return;
    }

    console.log(formatLoopBoard(board));
  });

loop
  .command('brief')
  .description('Show a compact human-driver brief')
  .option('--member <member>', 'Filter by owner/member')
  .option('--iteration <iteration>', 'Filter by iteration')
  .option('--done-since-days <days>', 'Days of done tasks to include', '7')
  .option('--today <date>', 'Override today (YYYY-MM-DD)')
  .option('--json', 'Output JSON')
  .action((options) => {
    buildIndexes(repoRoot);
    const brief = buildLoopBrief(repoRoot, {
      member: options.member ?? null,
      iteration: options.iteration ?? null,
      doneSinceDays: Number(options.doneSinceDays),
      today: options.today ?? null,
    });

    if (options.json) {
      console.log(JSON.stringify(brief, null, 2));
      return;
    }

    console.log(formatLoopBrief(brief));
  });

loop
  .command('horizon')
  .description('Show upcoming tasks and packets bucketed by due-date window')
  .option('--member <member>', 'Filter by owner/member')
  .option('--iteration <iteration>', 'Filter by iteration')
  .option('--today <date>', 'Override today (YYYY-MM-DD)')
  .option('--no-undated', 'Hide the "No due date" bucket')
  .option('--no-beyond', 'Hide the "Beyond 30d" bucket')
  .option('--json', 'Output JSON')
  .action((options) => {
    buildIndexes(repoRoot);
    const horizon = buildLoopHorizon(repoRoot, {
      member: options.member ?? null,
      iteration: options.iteration ?? null,
      today: options.today ?? null,
      includeUndated: options.undated !== false,
      includeBeyond: options.beyond !== false,
    });

    if (options.json) {
      console.log(JSON.stringify(horizon, null, 2));
      return;
    }

    console.log(formatLoopHorizon(horizon));
  });

loop
  .command('digest')
  .description('Compose the ephemeral morning digest for a member (D2 pilot); --record updates inbox state and marks due packets surfaced')
  .requiredOption('--member <member>', 'Member the digest is for')
  .option('--date <date>', 'Override today (YYYY-MM-DD)')
  .option('--record', 'Record inbox-delta state and due-packet surfaced markers; digest itself remains output-only')
  .option('--json', 'Output JSON')
  .action((options) => {
    try {
      buildIndexes(repoRoot);
      const digest = buildLoopDigest(repoRoot, {
        member: options.member,
        today: options.date ?? null,
      });
      const markdown = formatLoopDigest(digest);
      let written = null;
      if (options.record) {
        written = recordLoopDigest(repoRoot, digest);
      }

      if (options.json) {
        console.log(JSON.stringify({ ...digest, written }, null, 2));
        return;
      }
      console.log(markdown);
      if (written) {
        console.log(`Recorded state: ${written.state_path}`);
        if (written.packets_marked.length > 0) {
          console.log(`Packets marked surfaced: ${written.packets_marked.join(', ')}`);
        }
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });

loop
  .command('pr-check')
  .description('Flag open tasks whose referenced pull requests have all merged')
  .option('--member <member>', 'Filter by owner')
  .option('--concurrency <n>', 'Parallel GitHub reads', '8')
  .option('--json', 'Output JSON')
  .action(async (options) => {
    buildIndexes(repoRoot);
    const report = await buildPrCheck(repoRoot, {
      member: options.member ?? null,
      concurrency: Number(options.concurrency),
    });

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(formatPrCheck(report));
  });

const iteration = program.command('iteration').description('Iteration boundary mechanics');

iteration
  .command('carry')
  .description('Carry open committed tasks into the next iteration, incrementing slip counts (automatic per D3)')
  .requiredOption('--to <iteration>', 'Target iteration (YYYY-WNN)')
  .option('--from <iteration>', 'Source iteration (default: most recent past iteration on open tasks)')
  .option('--member <member>', 'Restrict to one owner')
  .option('--dry-run', 'Print the plan without writing')
  .option('--today <date>', 'Override today (YYYY-MM-DD)')
  .option('--json', 'Output JSON')
  .action((options) => {
    try {
      buildIndexes(repoRoot);
      const plan = buildCarryPlan(repoRoot, {
        to: options.to,
        from: options.from ?? null,
        member: options.member ?? null,
        today: options.today ?? null,
      });
      let applied = null;
      if (!options.dryRun) {
        applied = applyCarryPlan(repoRoot, plan);
        buildIndexes(repoRoot);
      }

      if (options.json) {
        console.log(JSON.stringify({ ...plan, dry_run: Boolean(options.dryRun), applied }, null, 2));
        return;
      }
      console.log(formatCarryPlan(plan, { dryRun: Boolean(options.dryRun) }));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });

iteration
  .command('prepackage')
  .description('Precompute the iteration-turn ceremony inputs: carry candidates, hygiene batch, closed list, capacity vs cap')
  .option('--closing <iteration>', 'Iteration being closed (default: current YYYY-WNN)')
  .option('--today <date>', 'Override today (YYYY-MM-DD)')
  .option('--no-pr', 'Skip the merged-PR check (offline runs)')
  .option('--concurrency <n>', 'Parallel GitHub reads for the PR check', '8')
  .option('--json', 'Output JSON')
  .action(async (options) => {
    try {
      buildIndexes(repoRoot);
      const pkg = await buildIterationPrepackage(repoRoot, {
        closing: options.closing ?? null,
        today: options.today ?? null,
        pr: options.pr !== false,
        concurrency: Number(options.concurrency),
      });

      if (options.json) {
        console.log(JSON.stringify(pkg, null, 2));
        return;
      }
      console.log(formatIterationPrepackage(pkg));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });

const hygiene = program.command('hygiene').description('Read-only task hygiene detection');

hygiene
  .command('check')
  .description('Emit one batch of hygiene proposals (never mutates)')
  .option('--member <member>', 'Filter by owner')
  .option('--today <date>', 'Override today (YYYY-MM-DD)')
  .option('--no-pr', 'Skip the merged-PR check (offline runs)')
  .option('--concurrency <n>', 'Parallel GitHub reads for the PR check', '8')
  .option('--json', 'Output JSON')
  .action(async (options) => {
    buildIndexes(repoRoot);
    const report = await buildHygieneReport(repoRoot, {
      member: options.member ?? null,
      today: options.today ?? null,
      pr: options.pr !== false,
      concurrency: Number(options.concurrency),
    });

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(formatHygieneReport(report));
  });

const initiativeCmd = program.command('initiative').description('Product initiative kickoff contract (decision_adr-product-initiative-kickoff)');

initiativeCmd
  .command('check')
  .description('Report kickoff gaps, task gaps, slips, scope changes and component rollup for active product initiatives (read-only)')
  .option('--member <member>', 'Filter by initiative owner')
  .option('--today <date>', 'Override today (YYYY-MM-DD)')
  .option('--json', 'Output JSON')
  .action((options) => {
    buildIndexes(repoRoot);
    const report = buildProductInitiativeReport(repoRoot, {
      member: options.member ?? null,
      today: options.today ?? null,
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(formatProductInitiativeReport(report));
  });

initiativeCmd
  .command('kickoff <id>')
  .description('Freeze a product initiative plan: record x_kickoff_date and x_baseline_tasks, plan → active')
  .option('--date <date>', 'Kickoff date (default: today, YYYY-MM-DD)')
  .option('--dry-run', 'Print the baseline without writing')
  .option('--json', 'Output JSON')
  .action((id, options) => {
    try {
      buildIndexes(repoRoot);
      const result = kickoffInitiative(repoRoot, id, { date: options.date ?? null, dryRun: Boolean(options.dryRun) });
      if (!options.dryRun) buildIndexes(repoRoot);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`${result.dry_run ? '[dry-run] ' : ''}Kicked off ${result.id} on ${result.kickoff_date} (status: ${result.status})`);
      console.log(`Baseline (${result.baseline_tasks.length}): ${result.baseline_tasks.join(', ')}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });

initiativeCmd
  .command('alert')
  .description('Send one inbox item per product initiative with gaps to its owner (Fisher delivers to Slack); lists only gaps not reminded to that owner within 7 days')
  .option('--member <member>', 'Restrict to one initiative owner')
  .option('--from <member>', 'Sender recorded on the inbox item', 'fisher')
  .option('--today <date>', 'Override today (YYYY-MM-DD)')
  .option('--dry-run', 'List what would be sent without writing')
  .option('--json', 'Output JSON')
  .action((options) => {
    try {
      buildIndexes(repoRoot);
      const result = sendProductGapAlerts(repoRoot, {
        member: options.member ?? null,
        from: options.from,
        today: options.today ?? null,
        dryRun: Boolean(options.dryRun),
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.results.length === 0) {
        console.log('No product initiative gaps to alert.');
        return;
      }
      for (const entry of result.results) {
        console.log(`${entry.action}\t${entry.id}\t${entry.owner ?? '-'}\t${entry.reason ?? `${entry.gaps} gap(s)`}`);
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });

const packet = program.command('packet').description('Scheduled action packet utilities');

packet
  .command('list')
  .description('List scheduled action packets')
  .option('--member <member>', 'Filter by owner/audience/member')
  .option('--due-before <date>', 'Include packets due on or before date (YYYY-MM-DD)')
  .option('--include-future', 'Include future packets')
  .option('--status <status>', 'Packet status', 'active')
  .option('--json', 'Output JSON')
  .action((options) => {
    const packets = listScheduledActionPackets(repoRoot, {
      member: options.member ?? null,
      dueBefore: options.dueBefore ?? null,
      includeFuture: Boolean(options.includeFuture),
      status: options.status ?? 'active',
    });

    if (options.json) {
      console.log(JSON.stringify(packets, null, 2));
      return;
    }

    console.log(formatScheduledActionPackets(packets));
  });

packet
  .command('new')
  .description('Create a workspace scheduled action packet')
  .requiredOption('--workspace <member>', 'Workspace member')
  .requiredOption('--title <title>', 'Packet title')
  .requiredOption('--trigger-at <date>', 'Trigger date/time')
  .requiredOption('--action <text>', 'Prescribed action')
  .option('--audience <audience>', 'Comma-separated audience')
  .option('--allowed-actions <actions>', 'Comma-separated allowed actions')
  .option('--expected-output <text>', 'Expected output')
  .option('--write-back <location>', 'Write-back location')
  .option('--escalation <rule>', 'Escalation rule')
  .option('--expiry <date>', 'Expiry date/time')
  .option('--recurrence <rule>', 'Recurrence rule')
  .action((options) => {
    const splitList = (value) => String(value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const audience = splitList(options.audience);
    const allowedActions = splitList(options.allowedActions);
    const extraFields = {
      owner: options.workspace,
      status: 'active',
      x_kind: 'scheduled_action',
      x_trigger_at: options.triggerAt,
      x_prescribed_action: options.action,
      ...(audience.length > 0 ? { x_audience: audience } : {}),
      ...(allowedActions.length > 0 ? { x_allowed_actions: allowedActions } : {}),
      ...(options.expectedOutput ? { x_expected_output: options.expectedOutput } : {}),
      ...(options.writeBack ? { x_write_back_location: options.writeBack } : {}),
      ...(options.escalation ? { x_escalation_rule: options.escalation } : {}),
      ...(options.expiry ? { x_expiry: options.expiry } : {}),
      ...(options.recurrence ? { x_recurrence: options.recurrence } : {}),
    };
    const result = scaffoldArtifact({
      repoRoot,
      type: 'note',
      title: options.title,
      extraFields,
      workspace: options.workspace,
    });
    const artifact = parseArtifact(result.path, repoRoot);
    const body = [
      `# ${options.title}`,
      '',
      '## Action',
      '',
      options.action,
      '',
      '## Expected Output',
      '',
      options.expectedOutput ?? 'Record the result in the configured write-back location.',
      '',
    ].join('\n');
    writeArtifact(result.path, artifact.frontmatter, body);

    console.log(JSON.stringify({
      created: true,
      id: result.id,
      path: result.relativePath,
    }, null, 2));
  });

const meeting = program.command('meeting').description('Meeting import and sync utilities');

meeting
  .command('import-gmail')
  .description('Import meeting notes discovered from Gemini Gmail notifications')
  .option('--since <iso>', 'Only import Gmail notifications updated on/after this ISO timestamp')
  .option('--limit <n>', 'Maximum Gmail notifications to process', '20')
  .option('--dry-run', 'Preview actions without writing files')
  .option('--git-sync', 'Pull, validate, and push tracked meeting changes after import')
  .action(async (options) => {
    try {
      const { importGmailMeetings } = await import('./lib/meeting-sync/importer.mjs');
      const result = await importGmailMeetings({
        repoRoot,
        since: options.since ?? null,
        limit: Number(options.limit),
        dryRun: Boolean(options.dryRun),
        gitSync: Boolean(options.gitSync),
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message }, null, 2));
      process.exitCode = 1;
    }
  });

meeting
  .command('import-notion')
  .description('Import meeting notes from the configured Notion meeting database')
  .option('--since <iso>', 'Only import Notion pages updated on/after this ISO timestamp')
  .option('--limit <n>', 'Maximum Notion pages to process', '20')
  .option('--dry-run', 'Preview actions without writing files')
  .option('--git-sync', 'Pull, validate, and push tracked meeting changes after import')
  .action(async (options) => {
    try {
      const { importNotionMeetings } = await import('./lib/meeting-sync/importer.mjs');
      const result = await importNotionMeetings({
        repoRoot,
        since: options.since ?? null,
        limit: Number(options.limit),
        dryRun: Boolean(options.dryRun),
        gitSync: Boolean(options.gitSync),
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message }, null, 2));
      process.exitCode = 1;
    }
  });

meeting
  .command('import-all')
  .description('Import Gmail-discovered Google meeting notes and Notion meeting pages in one run')
  .option('--since <iso>', 'Only import sources updated on/after this ISO timestamp')
  .option('--limit <n>', 'Maximum items to process per source', '20')
  .option('--dry-run', 'Preview actions without writing files')
  .option('--git-sync', 'Pull, validate, and push tracked meeting changes after import')
  .action(async (options) => {
    try {
      const { importAllMeetings } = await import('./lib/meeting-sync/importer.mjs');
      const result = await importAllMeetings({
        repoRoot,
        since: options.since ?? null,
        limit: Number(options.limit),
        dryRun: Boolean(options.dryRun),
        gitSync: Boolean(options.gitSync),
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message }, null, 2));
      process.exitCode = 1;
    }
  });

meeting
  .command('notify')
  .description('Ask jared, oliver, terence, and eb to read a meeting note via inbox')
  .argument('<meeting>', 'Meeting id or path to meeting markdown file')
  .option('--dry-run', 'Preview recipients without sending', false)
  .action(async (meetingArg, opts) => {
    try {
      const { notifyMeeting } = await import('./lib/meeting-notify.mjs');
      let meetingPath;
      if (meetingArg.endsWith('.md') && existsSync(resolve(repoRoot, meetingArg))) {
        meetingPath = resolve(repoRoot, meetingArg);
      } else if (existsSync(meetingArg)) {
        meetingPath = resolve(meetingArg);
      } else {
        const { loadManifest } = await import('./lib/indexer.mjs');
        const manifest = loadManifest(repoRoot);
        const entry = manifest.find((e) => e.id === meetingArg);
        if (!entry) {
          console.error(`Cannot resolve meeting: ${meetingArg}`);
          process.exitCode = 1;
          return;
        }
        meetingPath = resolve(repoRoot, entry.path);
      }
      const result = await notifyMeeting({ repoRoot, meetingPath, dryRun: Boolean(opts.dryRun) });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });

const task = program.command('task').description('Task lifecycle commands');

task
  .command('new')
  .description('Create a new task artifact interactively')
  .option('--title <title>', 'Task title')
  .option('--area <area>', 'Area name')
  .option('--owner <owner>', 'Task owner')
  .option('--priority <priority>', 'Priority (do, plan, routine, drop)', 'plan')
  .option('--due <date>', 'Due date (YYYY-MM-DD)')
  .option('--iteration <iteration>', 'Iteration (e.g. 2026-W10)')
  .option('--no-interactive', 'Skip interactive prompts, use defaults')
  .action(async (options) => {
    const rl = readline.createInterface({ input, output });

    async function ask(question, defaultValue) {
      if (defaultValue) question += ` [${defaultValue}]`;
      const answer = (await rl.question(`${question}: `)).trim();
      return answer || defaultValue || '';
    }

    async function askList(question) {
      console.log(`${question} (enter each item, empty line to finish):`);
      const items = [];
      while (true) {
        const item = (await rl.question('  - ')).trim();
        if (!item) break;
        items.push(item);
      }
      return items;
    }

    try {
      let title = options.title;
      let project = options.area;
      let owner = options.owner;
      let priority = options.priority;
      let dueDate = options.due;
      let definitionOfDone = [];

      if (options.interactive !== false) {
        if (!title) title = await ask('Title');
        if (!title) { console.error('Title is required.'); process.exitCode = 1; return; }
        if (!owner) owner = await ask('Owner');
        definitionOfDone = await askList('Definition of done (DoD)');
        if (definitionOfDone.length === 0) {
          definitionOfDone = ['TODO: define definition of done'];
        }
      } else {
        if (!title) { console.error('--title is required in non-interactive mode.'); process.exitCode = 1; return; }
        definitionOfDone = ['TODO: define definition of done'];
      }

      const result = scaffoldTaskFile({
        repoRoot,
        title,
        project: project || null,
        owner: owner || null,
        priority: priority !== 'plan' ? priority : null,
        status: 'ready',
        definitionOfDone,
        dueDate: dueDate || null,
        iteration: options.iteration || currentIteration(),
      });

      console.log(`\nCreated: ${result.relativePath}`);
      console.log(`     ID: ${result.id}`);
      console.log(`\nRun \`pnpm hey validate\` to check.`);
    } finally {
      rl.close();
    }
  });

task
  .command('ack')
  .description('Record that the assignee has acknowledged a task without changing lifecycle status')
  .requiredOption('--task <taskId>', 'Task ID to acknowledge')
  .option('--by <member>', 'Acknowledging member (defaults to $MEMBER)')
  .option('--note <note>', 'Optional acknowledgement note')
  .action((options) => {
    try {
      buildIndexes(repoRoot);
      const tracker = new MarkdownTracker({ repoRoot });
      const by = options.by ?? process.env.MEMBER ?? null;
      if (!by) {
        throw new Error('Acknowledgement requires --by or MEMBER in .env');
      }

      const acknowledged = tracker.acknowledgeIssue(options.task, {
        by,
        note: options.note ?? null,
      });
      buildIndexes(repoRoot);

      console.log(JSON.stringify({
        acknowledged: true,
        task_id: options.task,
        acknowledged_by: acknowledged.by,
        acknowledged_at: acknowledged.at,
        note: acknowledged.note ?? null,
      }, null, 2));
    } catch (err) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
      process.exitCode = 1;
    }
  });

task
  .command('claim')
  .description('Move a planned or ready task into doing')
  .requiredOption('--task <taskId>', 'Task ID to claim')
  .option('--by <member>', 'Claiming member (defaults to $MEMBER)')
  .option('--note <note>', 'Optional claim note')
  .action((options) => {
    try {
      buildIndexes(repoRoot);
      const manifest = loadManifest(repoRoot);
      const entry = manifest.find((m) => m.type === 'task' && m.id === options.task);
      if (!entry) throw new Error(`Task not found: ${options.task}`);

      const claimable = new Set(['plan', 'ready']);
      if (!claimable.has(entry.status)) {
        throw new Error(`Task status "${entry.status}" cannot be claimed`);
      }

      const filePath = resolve(repoRoot, entry.path);
      const contentRoot = resolve(repoRoot, 'content');
      const artifact = parseArtifact(filePath, contentRoot);
      artifact.frontmatter.status = 'doing';
      artifact.frontmatter.iteration = artifact.frontmatter.iteration ?? currentIteration();
      artifact.frontmatter.updated_at = new Date().toISOString().slice(0, 10);
      writeArtifact(filePath, artifact.frontmatter, artifact.body);

      const tracker = new MarkdownTracker({ repoRoot });
      const by = options.by ?? process.env.MEMBER ?? 'agent';
      const note = options.note ? `: ${options.note}` : '';
      tracker.createComment(options.task, `Claimed by ${by}${note}`);
      buildIndexes(repoRoot);

      console.log(JSON.stringify({
        claimed: true,
        task_id: options.task,
        claimed_by: by,
        status: 'doing',
      }, null, 2));
    } catch (err) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
      process.exitCode = 1;
    }
  });

task
  .command('plan')
  .description('Set or clear a task\'s x_planned_date — the weekday it is scheduled for inside its iteration')
  .requiredOption('--task <taskId>', 'Task ID to plan')
  .option('--date <date>', 'Weekday to schedule (YYYY-MM-DD), must fall inside the task\'s iteration')
  .option('--clear', 'Remove x_planned_date, returning the task to the iteration\'s unplanned pool')
  .action((options) => {
    try {
      if (!options.clear && !options.date) {
        throw new Error('pass --date <YYYY-MM-DD> or --clear');
      }
      if (options.clear && options.date) {
        throw new Error('--date and --clear are mutually exclusive');
      }

      buildIndexes(repoRoot);
      const manifest = loadManifest(repoRoot);
      const entry = manifest.find((m) => m.type === 'task' && m.id === options.task);
      if (!entry) throw new Error(`Task not found: ${options.task}`);

      const filePath = resolve(repoRoot, entry.path);
      const contentRoot = resolve(repoRoot, 'content');
      const artifact = parseArtifact(filePath, contentRoot);
      const previous = artifact.frontmatter.x_planned_date ?? null;

      if (options.clear) {
        // A missed plan carries no alarm — it returns to the unplanned pool.
        delete artifact.frontmatter.x_planned_date;
      } else {
        const check = validatePlannedDate({
          date: options.date,
          iteration: artifact.frontmatter.iteration ?? null,
          status: artifact.frontmatter.status ?? null,
        });
        if (!check.ok) throw new Error(check.error);
        artifact.frontmatter.x_planned_date = check.date;
      }

      artifact.frontmatter.updated_at = new Date().toISOString().slice(0, 10);
      writeArtifact(filePath, artifact.frontmatter, artifact.body);
      buildIndexes(repoRoot);

      console.log(JSON.stringify({
        planned: !options.clear,
        task_id: options.task,
        iteration: artifact.frontmatter.iteration ?? null,
        previous_planned_date: previous,
        x_planned_date: artifact.frontmatter.x_planned_date ?? null,
      }, null, 2));
    } catch (err) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
      process.exitCode = 1;
    }
  });

task
  .command('status')
  .description('Set a task\'s lifecycle status directly (board status picker); logs the change under ## Agent Log')
  .requiredOption('--task <taskId>', 'Task ID to update')
  .requiredOption('--to <status>', `New status: ${[...TASK_STATUS_VALUES].join(' | ')}`)
  .option('--by <member>', 'Member making the change (defaults to $MEMBER)')
  .option('--note <note>', 'Optional note recorded with the change')
  .action((options) => {
    try {
      if (!TASK_STATUS_VALUES.has(options.to)) {
        throw new Error(`status must be one of: ${[...TASK_STATUS_VALUES].join(', ')}`);
      }

      buildIndexes(repoRoot);
      const manifest = loadManifest(repoRoot);
      const entry = manifest.find((m) => m.type === 'task' && m.id === options.task);
      if (!entry) throw new Error(`Task not found: ${options.task}`);

      const filePath = resolve(repoRoot, entry.path);
      const contentRoot = resolve(repoRoot, 'content');
      const artifact = parseArtifact(filePath, contentRoot);
      const previous = artifact.frontmatter.status ?? null;
      if (previous === options.to) {
        console.log(JSON.stringify({ changed: false, task_id: options.task, status: previous }, null, 2));
        return;
      }

      artifact.frontmatter.status = options.to;
      // ready/blocked/doing tasks must declare an iteration (frontmatter schema).
      if (['ready', 'blocked', 'doing'].includes(options.to)) {
        artifact.frontmatter.iteration = artifact.frontmatter.iteration ?? currentIteration();
      }
      artifact.frontmatter.updated_at = new Date().toISOString().slice(0, 10);
      writeArtifact(filePath, artifact.frontmatter, artifact.body);

      const tracker = new MarkdownTracker({ repoRoot });
      const by = options.by ?? process.env.MEMBER ?? 'agent';
      const note = options.note ? `: ${options.note}` : '';
      tracker.createComment(options.task, `Status ${previous ?? 'none'} -> ${options.to} by ${by}${note}`);
      buildIndexes(repoRoot);

      console.log(JSON.stringify({
        changed: true,
        task_id: options.task,
        previous_status: previous,
        status: options.to,
        by,
      }, null, 2));
    } catch (err) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
      process.exitCode = 1;
    }
  });

loop
  .command('health')
  .description('Backlog health under the three-layer model: iteration commitment vs cap, plus the digest heartbeat')
  .option('--member <member>', 'Restrict to one member')
  .option('--json', 'Emit JSON')
  .action((options) => {
    const heartbeat = loopHealth.checkDigestHeartbeat(repoRoot);
    const health = loopHealth.buildBacklogHealth(repoRoot, { member: options.member ?? null });
    if (options.json) {
      console.log(JSON.stringify({ heartbeat, health }, null, 2));
      return;
    }
    console.log(`Backlog health — ${health.iteration} (commitment cap ${health.cap} per member)\n`);
    for (const row of health.rows) {
      const cov = row.planned_coverage === null ? 'n/a' : `${Math.round(row.planned_coverage * 100)}%`;
      const flag = row.within_cap ? '' : `  <-- ${row.over_cap} OVER CAP`;
      console.log(`  ${row.member.padEnd(14)} committed ${String(row.committed).padStart(3)}/${health.cap}  backlog ${String(row.backlog).padStart(3)}  planned ${cov.padStart(4)}  slip>=${loopHealth.SLIP_THRESHOLD} ${row.slipped_at_threshold}${flag}`);
    }
    console.log(`\nDigest heartbeat — budget 1 day, newest acceptable ${heartbeat.oldest_acceptable}`);
    if (heartbeat.stale.length === 0) {
      console.log('  All opted-in members current.');
    } else {
      for (const row of heartbeat.stale) {
        console.log(row.last_digest === null
          ? `  ${row.member}: STALLED — no daily log has ever carried a digest section`
          : `  ${row.member}: STALLED — last digest ${row.last_digest} (${row.days_stale}d ago)`);
      }
    }
    console.log('\nThe number to hold is committed vs cap. Planned coverage is a diagnostic —');
    console.log('x_planned_date is an optional override, not a requirement.');
  });

const inbox = program.command('inbox').description('Optional inbox workflow for raw intake before promotion');

inbox
  .command('capture')
  .description('Capture raw input into a workspace inbox')
  .requiredOption('--workspace <member>', 'Workspace member')
  .requiredOption('--title <title>', 'Inbox item title')
  .requiredOption('--body <body>', 'Raw input body')
  .option('--source <source>', 'Source hint, e.g. slack://...')
  .action((options) => {
    const { item, path } = captureInboxItem({
      repoRoot,
      workspace: options.workspace,
      title: options.title,
      body: options.body,
      source: options.source ?? null
    });

    console.log(JSON.stringify({
      captured: true,
      id: item.id,
      path: path.replace(`${repoRoot}/`, '')
    }, null, 2));
  });

inbox
  .command('send')
  .description('Send an inbox item from one member to another')
  .requiredOption('--from <member>', 'Sender member name')
  .requiredOption('--to <member>', 'Recipient member name (or @all to broadcast)')
  .requiredOption('--title <title>', 'Message title')
  .option('--body <body>', 'Message body')
  .option('--task-ref <taskId>', 'Related task ID')
  .action((options) => {
    const result = sendInboxItem({
      repoRoot,
      from: options.from,
      to: options.to,
      title: options.title,
      body: options.body ?? '',
      taskRef: options.taskRef ?? null,
    });

    if (result.broadcastId) {
      console.log(JSON.stringify({
        broadcast: true,
        broadcastId: result.broadcastId,
        delivered: result.results.length,
        recipients: result.results.map(r => ({
          id: r.item.id,
          workspace: r.item.workspace,
          path: r.path.replace(`${repoRoot}/`, ''),
        })),
      }, null, 2));
    } else {
      console.log(JSON.stringify({
        sent: true,
        id: result.item.id,
        to: options.to,
        path: result.path.replace(`${repoRoot}/`, ''),
      }, null, 2));
    }
  });

inbox
  .command('list')
  .description('List inbox items for a workspace')
  .requiredOption('--workspace <member>', 'Workspace member')
  .option('--all', 'Include read, promoted, and discarded items')
  .option('--status <status>', 'Filter by status: open, read, promoted, discarded')
  .option('--no-task-check', 'Skip linked task status cross-check for x_task_ref items')
  .action((options) => {
    const items = listInboxItems({
      repoRoot,
      workspace: options.workspace,
      status: options.status ?? null,
      includeAll: Boolean(options.all),
      includeTaskStatus: Boolean(options.taskCheck)
    });

    console.log(JSON.stringify(items, null, 2));
  });

inbox
  .command('show')
  .description('Show one inbox item')
  .requiredOption('--workspace <member>', 'Workspace member')
  .requiredOption('--item <id>', 'Inbox item ID')
  .action((options) => {
    const item = getInboxItem({
      repoRoot,
      workspace: options.workspace,
      itemId: options.item
    });

    console.log(JSON.stringify(item, null, 2));
  });

inbox
  .command('ack')
  .description('Mark an inbox item as read and move it out of the open queue')
  .requiredOption('--workspace <member>', 'Workspace member')
  .requiredOption('--item <id>', 'Inbox item ID')
  .option('--note <note>', 'Acknowledgement note')
  .action((options) => {
    const item = acknowledgeInboxItem({
      repoRoot,
      workspace: options.workspace,
      itemId: options.item,
      context: {
        command: 'inbox ack',
        ...(options.note ? { note: options.note } : {}),
      }
    });

    console.log(JSON.stringify({
      acknowledged: true,
      id: item.id,
      status: item.status
    }, null, 2));
  });

inbox
  .command('reply')
  .description('Reply to an inbox item and auto-ack the original')
  .requiredOption('--workspace <member>', 'Replying member (yours)')
  .requiredOption('--item <id>', 'Inbox item ID being replied to')
  .requiredOption('--body <body>', 'Reply body')
  .option('--title <title>', 'Override reply title (defaults to "Re: <original>")')
  .action((options) => {
    const { sent, recipient } = replyToInboxItem({
      repoRoot,
      workspace: options.workspace,
      itemId: options.item,
      body: options.body,
      title: options.title ?? null,
    });

    console.log(JSON.stringify({
      replied: true,
      from: options.workspace,
      to: recipient,
      reply_id: sent.item.id,
      reply_path: sent.path,
      original_id: options.item,
    }, null, 2));
  });

inbox
  .command('discard')
  .description('Discard an inbox item without promoting it')
  .requiredOption('--workspace <member>', 'Workspace member')
  .requiredOption('--item <id>', 'Inbox item ID')
  .option('--reason <reason>', 'Discard reason')
  .action((options) => {
    const item = discardInboxItem({
      repoRoot,
      workspace: options.workspace,
      itemId: options.item,
      reason: options.reason ?? null
    });

    console.log(JSON.stringify({
      discarded: true,
      id: item.id,
      reason: item.discard_reason ?? null
    }, null, 2));
  });

inbox
  .command('promote')
  .description('Promote an inbox item into a structured artifact')
  .requiredOption('--workspace <member>', 'Source workspace member')
  .requiredOption('--item <id>', 'Inbox item ID')
  .requiredOption('--type <type>', 'Artifact type: task, decision, meeting, playbook, note, initiative, goal')
  .option('--title <title>', 'Artifact title override')
  .option('--area <area>', 'Area name')
  .option('--owner <owner>', 'Owner')
  .option('--status <status>', 'Status (default: ready for task, active for other types)')
  .option('--priority <priority>', 'Priority (do, plan, routine, drop)')
  .option('--due <date>', 'Due date (YYYY-MM-DD)')
  .option('--iteration <iteration>', 'Iteration (e.g. 2026-W10)')
  .option('--field <fields...>', 'Extra fields as key=value pairs')
  .option('--target-workspace <member>', 'Promote into a workspace instead of content/')
  .action((options) => {
    const extraFields = parseExtraFields(options.field);
    if (options.area) extraFields.area = options.area;
    if (options.owner) extraFields.owner = options.owner;
    const defaultStatus = options.type === 'task' ? 'ready' : 'active';
    extraFields.status = options.status ?? defaultStatus;
    if (options.priority) extraFields.priority = options.priority;
    if (options.due) extraFields.due_date = options.due;
    if (options.iteration) extraFields.iteration = options.iteration;
    if (options.type === 'task' && !extraFields.iteration && ['ready', 'blocked', 'doing'].includes(extraFields.status)) {
      extraFields.iteration = currentIteration();
    }
    if (options.type === 'task' && !extraFields.definition_of_done) {
      extraFields.definition_of_done = ['TODO: define definition of done'];
    }

    const result = promoteInboxItem({
      repoRoot,
      workspace: options.workspace,
      itemId: options.item,
      type: options.type,
      title: options.title,
      extraFields,
      targetWorkspace: options.targetWorkspace ?? null
    });

    console.log(JSON.stringify({
      promoted: true,
      inbox_item_id: result.item.id,
      artifact_id: result.artifact.id,
      artifact_path: result.artifact.path
    }, null, 2));
  });

const inboxSlack = inbox.command('slack').description('Slack delivery for inbox items');

inboxSlack
  .command('notify')
  .description('Poll all member inboxes and DM new items via Slack')
  .action(async () => {
    try {
      const { existsSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const { WebClient } = await import('@slack/web-api');
      const {
        InboxNotifier,
      } = await import('../workspace/fisher/external-activity-runtime/lib/inbox-notifier.mjs');
      const {
        loadEnvFile,
        loadExternalActivityRuntimeConfig,
      } = await import('../workspace/fisher/external-activity-runtime/lib/config.mjs');

      for (const envPath of [
        resolve(repoRoot, '.env'),
        resolve(repoRoot, 'workspace', 'fisher', 'external-activity-runtime', '.env'),
      ]) {
        if (existsSync(envPath)) loadEnvFile(envPath);
      }

      if (!process.env.SLACK_BOT_TOKEN) {
        throw new Error('Missing SLACK_BOT_TOKEN');
      }

      const config = loadExternalActivityRuntimeConfig(repoRoot);
      const webClient = new WebClient(process.env.SLACK_BOT_TOKEN);
      const notifier = new InboxNotifier({ repoRoot, config, webClient });
      const deliveries = await notifier.pollAndNotify();
      console.log(JSON.stringify({ deliveries, count: deliveries.length }, null, 2));
    } catch (error) {
      console.error(`Inbox Slack notify failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

inboxSlack
  .command('digest')
  .description('Send per-member inbox summary DMs')
  .action(async () => {
    try {
      const { existsSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const { WebClient } = await import('@slack/web-api');
      const {
        InboxNotifier,
      } = await import('../workspace/fisher/external-activity-runtime/lib/inbox-notifier.mjs');
      const {
        loadEnvFile,
        loadExternalActivityRuntimeConfig,
      } = await import('../workspace/fisher/external-activity-runtime/lib/config.mjs');

      for (const envPath of [
        resolve(repoRoot, '.env'),
        resolve(repoRoot, 'workspace', 'fisher', 'external-activity-runtime', '.env'),
      ]) {
        if (existsSync(envPath)) loadEnvFile(envPath);
      }

      if (!process.env.SLACK_BOT_TOKEN) {
        throw new Error('Missing SLACK_BOT_TOKEN');
      }

      const config = loadExternalActivityRuntimeConfig(repoRoot);
      const webClient = new WebClient(process.env.SLACK_BOT_TOKEN);
      const notifier = new InboxNotifier({ repoRoot, config, webClient });
      const digests = await notifier.sendAllDigests();
      console.log(JSON.stringify({ digests, count: digests.length }, null, 2));
    } catch (error) {
      console.error(`Inbox Slack digest failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

task
  .command('list')
  .description('List tasks from the manifest')
  .option('--status <status>', 'Filter by status')
  .option('--owner <owner>', 'Filter by owner')
  .option('--area <area>', 'Filter by area')
  .option('--iteration <iteration>', 'Filter by iteration')
  .action((options) => {
    ensureManifestFreshForRead('hey task list');
    const manifest = loadManifest(repoRoot);
    let tasks = manifest.filter((item) => item.type === 'task');

    if (options.status) tasks = tasks.filter((t) => t.status === options.status);
    if (options.owner) tasks = tasks.filter((t) => t.owner === options.owner);
    if (options.area) tasks = tasks.filter((t) => t.area === options.area);
    if (options.iteration) tasks = tasks.filter((t) => t.iteration === options.iteration);

    if (tasks.length === 0) {
      console.log('No tasks found.');
      return;
    }

    console.log(`\n  ${'ID'.padEnd(30)} ${'Status'.padEnd(10)} ${'Pri'.padEnd(4)} ${'Owner'.padEnd(12)} Title`);
    console.log(`  ${'─'.repeat(30)} ${'─'.repeat(10)} ${'─'.repeat(4)} ${'─'.repeat(12)} ${'─'.repeat(30)}`);
    for (const t of tasks) {
      const status = (t.status ?? 'none').padEnd(10);
      const pri = (t.priority ?? '-').padEnd(4);
      const owner = (t.owner ?? '-').padEnd(12);
      console.log(`  ${t.id.padEnd(30)} ${status} ${pri} ${owner} ${t.title}`);
    }
    console.log(`\n  ${tasks.length} task(s)\n`);
  });

program
  .command('stats')
  .description('Quick manifest summary')
  .action(() => {
    const manifest = loadManifest(repoRoot);
    const counts = {};
    for (const item of manifest) {
      counts[item.type] = (counts[item.type] ?? 0) + 1;
    }
    console.log(JSON.stringify({ total: manifest.length, by_type: counts }, null, 2));
  });

const log = program.command('log').description('Workspace log hygiene and summaries');

log
  .command('stats')
  .description('Show raw log and summary volume by workspace')
  .action(() => {
    console.log(JSON.stringify(logStats(repoRoot), null, 2));
  });

log
  .command('scaffold')
  .description("Create or refresh the marker-scoped Auto scaffold section of a member's daily log (pastward facts only)")
  .requiredOption('--member <member>', 'Workspace member')
  .option('--date <date>', 'Override today (YYYY-MM-DD)')
  .option('--json', 'Output JSON')
  .action((options) => {
    try {
      buildIndexes(repoRoot);
      const scaffold = buildLogScaffold(repoRoot, {
        member: options.member,
        date: options.date ?? null,
      });
      const section = renderScaffoldSection(scaffold);
      const result = applyLogScaffold(repoRoot, {
        member: scaffold.member,
        date: scaffold.date,
        section,
      });

      if (options.json) {
        console.log(JSON.stringify({ ...scaffold, ...result }, null, 2));
        return;
      }
      console.log(`${result.created ? 'Created' : result.replaced ? 'Refreshed scaffold in' : 'Appended scaffold to'} ${result.path}`);
      console.log(`Commits: ${scaffold.commits.length} · Agent runs: ${scaffold.runs.length} · Tasks touched: ${scaffold.tasks_touched.length}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });

log
  .command('compact')
  .description('Generate additive workspace log summaries for completed periods')
  .option('--member <member>', 'Compact logs for one workspace member')
  .option('--all', 'Compact logs for every workspace that has logs')
  .option('--force', 'Regenerate existing summary files')
  .option('--dry-run', 'Return what would be written without writing files')
  .option('--today <date>', 'Override today for deterministic runs (YYYY-MM-DD)')
  .option('--json', 'Output raw JSON')
  .action((options) => {
    if (options.member && options.all) {
      console.error('Use either --member or --all, not both.');
      process.exitCode = 1;
      return;
    }

    const members = options.all
      ? listMembers(repoRoot)
      : [options.member ?? process.env.MEMBER].filter(Boolean);

    if (members.length === 0) {
      console.error('No workspace member resolved. Use --member <name> or --all.');
      process.exitCode = 1;
      return;
    }

    const results = members.map((member) => compactLogs({
      repoRoot,
      member,
      force: Boolean(options.force),
      dryRun: Boolean(options.dryRun),
      today: options.today ?? null,
    }));

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    for (const result of results) {
      console.log(`\n=== LOG COMPACT: ${result.member} ===`);
      if (result.message) {
        console.log(result.message);
        continue;
      }
      console.log(`Created: ${result.created.length}`);
      console.log(`Skipped: ${result.skipped.length}`);
      for (const entry of result.created) {
        console.log(`  + [${entry.tier}] ${entry.key} -> ${entry.path}`);
      }
      for (const path of result.skipped) {
        console.log(`  = ${path}`);
      }
    }
    console.log('');
  });

program
  .command('assess')
  .description('Team progress assessment across time horizons')
  .option('--period <period>', 'daily|weekly|monthly|quarterly', 'weekly')
  .option('--iteration <iteration>', 'Restrict task views to one iteration, e.g. 2026-W10')
  .option('--json', 'Output raw JSON')
  .action(async (options) => {
    let result;
    try {
      const major = Number(process.versions.node.split('.')[0]);
      if (major < 22) {
        throw new Error("Node 22+ required for 'assess' (uses builtin node:sqlite). Upgrade Node or run 'hey validate' and 'hey index build' only.");
      }
      const { buildCatalogDatabase } = await import('./lib/catalog-db.mjs');
      const { runAssess } = await import('./lib/assess.mjs');
      buildIndexes(repoRoot);
      buildCatalogDatabase(repoRoot);
      result = runAssess(repoRoot, { period: options.period, iteration: options.iteration ?? null });
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const w = result.window;
    console.log(`\n=== TEAM ASSESSMENT (${result.period}) ===`);
    console.log(`Period: ${w.from} → ${w.to}\n`);
    if (result.iteration) {
      console.log(`Iteration: ${result.iteration}\n`);
    }

    // Progress
    console.log(`--- Progress ---`);
    console.log(`  Tasks completed: ${result.progress.completed.length}`);
    for (const t of result.progress.completed) {
      console.log(`    ${t.id} — ${t.title} (${t.owner ?? 'unassigned'})`);
    }
    console.log(`  Artifacts created: ${result.progress.created.length}`);
    console.log(`  Decisions made: ${result.progress.decisions.length}`);
    for (const d of result.progress.decisions) {
      console.log(`    ${d.id} — ${d.title}`);
    }

    // Current state
    console.log(`\n--- Current State ---`);
    console.log(`  Active tasks: ${result.current.active.length}`);
    console.log(`  In progress: ${result.current.in_progress.length}`);
    console.log(`  Blocked: ${result.current.blocked.length}`);
    for (const t of result.current.blocked) {
      console.log(`    ${t.id} — ${t.title} (${t.owner ?? 'unassigned'})`);
    }
    if (result.current.overdue.length > 0) {
      console.log(`  Overdue: ${result.current.overdue.length}`);
      for (const t of result.current.overdue) {
        console.log(`    ${t.id} — ${t.title} (due: ${t.due_date})`);
      }
    }

    // Ahead
    console.log(`\n--- Ahead ---`);
    if (result.ahead.upcoming_due.length > 0) {
      console.log(`  Upcoming deadlines: ${result.ahead.upcoming_due.length}`);
      for (const t of result.ahead.upcoming_due) {
        console.log(`    ${t.id} — ${t.title} (due: ${t.due_date})`);
      }
    }
    console.log(`  By area:`);
    for (const [proj, count] of Object.entries(result.ahead.by_area)) {
      console.log(`    ${proj || '(none)'}: ${count} active`);
    }
    console.log(`  By owner:`);
    for (const [owner, count] of Object.entries(result.ahead.by_owner)) {
      console.log(`    ${owner || '(unassigned)'}: ${count} active`);
    }
    if (result.ahead.unassigned.length > 0) {
      console.log(`  Unassigned tasks: ${result.ahead.unassigned.length}`);
      for (const t of result.ahead.unassigned) {
        console.log(`    ${t.id} — ${t.title}`);
      }
    }

    // Health
    const h = result.health;
    console.log(`\n--- Health ---`);
    console.log(`  Validation: ${h.validation_errors} error(s), ${h.validation_warnings} warning(s)`);

    console.log('');
  });

// --- Work helpers ---

function createTrackerFromConfig(areaFilter) {
  const loader = new WorkflowLoader(repoRoot);
  const cfg = loader.config;
  const baseOwners = cfg.tracker?.dispatchable_owners ?? ['agent'];
  const member = process.env.MEMBER;
  const dispatchableOwners = member && !baseOwners.includes(member)
    ? [...baseOwners, member]
    : baseOwners;
  const tracker = new MarkdownTracker({
    repoRoot,
    activeStates: cfg.tracker?.active_states ?? ['ready'],
    terminalStates: cfg.tracker?.terminal_states ?? ['done', 'archived'],
    dispatchableOwners,
    dispatchableTags: cfg.tracker?.dispatchable_tags ?? [],
    areaFilter: areaFilter ?? cfg.tracker?.area_filter ?? null
  });
  const workspace = new WorkspaceManager({
    repoRoot,
    workspaceRoot: cfg.workspace?.root ?? '.hey/orch/workspaces',
    hooks: cfg.hooks ?? {},
    hookTimeoutMs: cfg.hooks?.timeout_ms ?? 60000
  });
  return { loader, tracker, workspace };
}

function findRunAttempt(taskId, status) {
  const runsDir = resolve(repoRoot, '.hey', 'orch', 'runs');
  if (!existsSync(runsDir)) return null;
  for (const dir of readdirSync(runsDir).reverse()) {
    const attemptPath = resolve(runsDir, dir, 'attempt.json');
    if (!existsSync(attemptPath)) continue;
    const attempt = JSON.parse(readFileSync(attemptPath, 'utf8'));
    if (attempt.task_id === taskId && (!status || attempt.status === status)) {
      return { path: attemptPath, data: attempt, runId: dir };
    }
  }
  return null;
}

function updateRunAttempt(attemptPath, updates) {
  const data = JSON.parse(readFileSync(attemptPath, 'utf8'));
  Object.assign(data, updates);
  writeFileSync(attemptPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// --- Work command group ---

const work = program.command('work').description('Agent work lifecycle commands');

work
  .command('candidates')
  .description('List dispatchable candidate tasks')
  .option('--area <area>', 'Filter by area')
  .option('--json', 'Output JSON array')
  .action((options) => {
    buildIndexes(repoRoot);
    const { tracker } = createTrackerFromConfig(options.area);
    const candidates = tracker.fetchCandidateIssues();

    if (options.json) {
      console.log(JSON.stringify(candidates, null, 2));
      return;
    }

    if (candidates.length === 0) {
      console.log('No candidate tasks found.');
      return;
    }

    console.log(`\n  ${'ID'.padEnd(30)} ${'Pri'.padEnd(4)} ${'Owner'.padEnd(12)} Title`);
    console.log(`  ${'─'.repeat(30)} ${'─'.repeat(4)} ${'─'.repeat(12)} ${'─'.repeat(30)}`);
    for (const c of candidates) {
      const pri = String(c.priority ?? '-').padEnd(4);
      const owner = (c.owner ?? '-').padEnd(12);
      console.log(`  ${c.id.padEnd(30)} ${pri} ${owner} ${c.title}`);
    }
    console.log(`\n  ${candidates.length} candidate(s)\n`);
  });

work
  .command('claim')
  .description('Claim the next (or specific) candidate task')
  .option('--task <taskId>', 'Claim a specific task by ID')
  .option('--next', 'Claim the highest-priority candidate (default)')
  .action(async (options) => {
    try {
      buildIndexes(repoRoot);
      const { tracker, workspace } = createTrackerFromConfig();
      const candidates = tracker.fetchCandidateIssues();

      if (candidates.length === 0) {
        console.log(JSON.stringify({ error: 'No candidate tasks available' }));
        process.exitCode = 1;
        return;
      }

      let candidate;
      if (options.task) {
        candidate = candidates.find((c) => c.id === options.task);
        if (!candidate) {
          console.log(JSON.stringify({ error: `Task not found in candidates: ${options.task}` }));
          process.exitCode = 1;
          return;
        }
      } else {
        candidate = candidates[0];
      }

      const issue = tracker.hydrateIssue(candidate);

      // Create workspace (git worktree)
      let ws = null;
      try {
        ws = workspace.ensureWorkspace(issue);
      } catch (err) {
        console.error(`Warning: workspace creation failed: ${err.message}`);
      }

      tracker.updateIssueState(issue.id, 'doing');
      buildIndexes(repoRoot);

      const id = runId();
      const runDir = resolve(repoRoot, '.hey', 'orch', 'runs', id);
      mkdirSync(runDir, { recursive: true });
      const attempt = {
        task_id: issue.id,
        title: issue.title,
        claimed_at: new Date().toISOString(),
        status: 'in_progress',
        main_repo_root: repoRoot,
        workspace_path: ws?.path ?? null
      };
      writeFileSync(resolve(runDir, 'attempt.json'), JSON.stringify(attempt, null, 2) + '\n', 'utf8');

      tracker.createComment(issue.id, 'Claimed by agent');

      console.log(JSON.stringify({ ...issue, workspace_path: ws?.path ?? null }, null, 2));
    } catch (err) {
      console.log(JSON.stringify({ error: err.message }));
      process.exitCode = 1;
    }
  });

work
  .command('complete')
  .description('Mark a task as done')
  .requiredOption('--task <taskId>', 'Task ID to complete')
  .option('--summary <text>', 'Completion summary')
  .action(async (options) => {
    try {
      const { tracker, workspace } = createTrackerFromConfig();
      tracker.updateIssueState(options.task, 'done');
      buildIndexes(repoRoot);

      // Run after_complete hook (push + create PR)
      const run = findRunAttempt(options.task, 'in_progress');
      let prUrl = null;
      if (run?.data?.workspace_path) {
        try {
          const result = await workspace.runAfterCompleteHook(
            { identifier: options.task, id: options.task, title: run.data.title ?? options.task },
            { path: run.data.workspace_path }
          );
          prUrl = result.pr_url;
        } catch (err) {
          console.error(`Warning: after_complete hook failed: ${err.message}`);
        }
      }

      const comment = options.summary
        ? `Completed: ${options.summary}`
        : 'Completed by agent';
      tracker.createComment(options.task, comment);

      if (run) {
        updateRunAttempt(run.path, { status: 'completed', completed_at: new Date().toISOString() });
      }

      console.log(JSON.stringify({ ok: true, task_id: options.task, status: 'completed', pr_url: prUrl }));
    } catch (err) {
      console.log(JSON.stringify({ error: err.message }));
      process.exitCode = 1;
    }
  });

work
  .command('fail')
  .description('Mark a task as failed and return it to ready')
  .requiredOption('--task <taskId>', 'Task ID to fail')
  .requiredOption('--reason <text>', 'Failure reason')
  .action(async (options) => {
    try {
      const { tracker } = createTrackerFromConfig();
      tracker.updateIssueState(options.task, 'ready');
      buildIndexes(repoRoot);

      tracker.createComment(options.task, `Failed: ${options.reason}`);

      const run = findRunAttempt(options.task, 'in_progress');
      if (run) {
        updateRunAttempt(run.path, { status: 'failed', failed_at: new Date().toISOString(), reason: options.reason });
      }

      console.log(JSON.stringify({ ok: true, task_id: options.task, status: 'failed' }));
    } catch (err) {
      console.log(JSON.stringify({ error: err.message }));
      process.exitCode = 1;
    }
  });

work
  .command('current')
  .description('Show currently in-progress run attempt')
  .action(() => {
    const runs = listRunAttempts(repoRoot, { status: 'in_progress', limit: 1 });
    console.log(JSON.stringify({ current: runs[0] ?? null }, null, 2));
  });

work
  .command('runs')
  .description('List recent run attempts')
  .option('--limit <n>', 'Max runs to show', '10')
  .option('--task <taskId>', 'Filter by task ID')
  .option('--status <status>', 'Filter by run status')
  .action((options) => {
    const runs = listRunAttempts(repoRoot, {
      limit: Number(options.limit),
      taskId: options.task ?? null,
      status: options.status ?? null,
    });
    console.log(JSON.stringify(runs, null, 2));
  });

work
  .command('workflow')
  .description('Show WORKFLOW.md config or render prompt for a task')
  .option('--render', 'Render prompt template for the given task')
  .option('--task <taskId>', 'Task ID to render prompt for (requires --render)')
  .action((options) => {
    const { loader, tracker } = createTrackerFromConfig();

    if (options.render) {
      if (!options.task) {
        console.error('--task <taskId> is required with --render');
        process.exitCode = 1;
        return;
      }
      buildIndexes(repoRoot);
      const candidates = tracker.fetchCandidateIssues();
      const candidate = candidates.find((c) => c.id === options.task)
        ?? { id: options.task, path: null };

      let issue;
      try {
        issue = candidate.path ? tracker.hydrateIssue(candidate) : candidate;
      } catch {
        issue = candidate;
      }

      console.log(loader.renderPrompt(issue));
      return;
    }

    console.log(JSON.stringify(loader.config, null, 2));
  });

// ── Activity pipeline CLI ──────────────────────────────────────────────────────

const activity = program.command('activity').description('External activity pipeline operations');

activity
  .command('poll <source>')
  .description('Poll a source for new events (slack, confluence, drive, github, meeting)')
  .action(async (source) => {
    try {
      const result = process.env.FISHER_ACTIVITY_BATCH_NO_GIT_SYNC === '1'
        ? await (async () => {
            const { pollOnlySource } = await import('./lib/activity-runner.mjs');
            return pollOnlySource({ repoRoot, source });
          })()
        : await pollSource({ repoRoot, source });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Poll failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('prepare-candidates')
  .description('Prepare candidates from recent events — returns unmatched items for agent classification')
  .action(async () => {
    try {
      const result = await prepareCandidates({ repoRoot });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Prepare failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('finalize-candidates')
  .description('Finalize agent classification decisions into candidates')
  .requiredOption('--data <json>', 'JSON string with { decisions: [...] }')
  .action(async (options) => {
    try {
      const result = await finalizeCandidatesFromAgent({ repoRoot, decisionsJson: options.data });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Finalize failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('candidates')
  .description('List activity candidates')
  .option('--status <status>', 'Filter by status (open, applied, rejected, superseded)')
  .action((options) => {
    const candidates = getActivityCandidates({ repoRoot, status: options.status ?? null });
    console.log(JSON.stringify(candidates, null, 2));
  });

activity
  .command('approve')
  .description('Approve an activity candidate')
  .requiredOption('--id <candidateId>', 'Candidate ID to approve')
  .action((options) => {
    try {
      const result = approveActivityCandidate({ repoRoot, candidateId: options.id });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Approve failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('reject')
  .description('Reject an activity candidate')
  .requiredOption('--id <candidateId>', 'Candidate ID to reject')
  .action((options) => {
    try {
      const result = rejectActivityCandidateById({ repoRoot, candidateId: options.id });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Reject failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('finalize-reflections')
  .description('Process agent decisions through reflection gate')
  .requiredOption('--data <json>', 'JSON string with reflection decisions')
  .action(async (options) => {
    try {
      const { finalizeReflections } = await import('./lib/activity-runner.mjs');
      const result = await finalizeReflections({ repoRoot, decisionsJson: options.data });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Finalize-reflections failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('compact-knowledge')
  .description('Compact Fisher knowledge JSONL files with deterministic logical upsert')
  .action(async () => {
    try {
      const { compactKnowledgeEntries } = await import('./lib/activity-state.mjs');
      const result = compactKnowledgeEntries(repoRoot);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Compact-knowledge failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('auto-compact-knowledge')
  .description('Compact Fisher knowledge JSONL files only when cooldown and garbage thresholds allow it')
  .option('--force', 'Ignore cooldown and threshold gates')
  .action(async (options) => {
    try {
      const { autoCompactKnowledge } = await import('./lib/activity-runner.mjs');
      const result = await autoCompactKnowledge({ repoRoot, force: Boolean(options.force) });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Auto-compact-knowledge failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('revoke')
  .description('Revoke a promoted observation (demote to observed)')
  .requiredOption('--signature <sig>', 'Observation signature to revoke')
  .requiredOption('--date <date>', 'Date of the observation (YYYY-MM-DD)')
  .action(async (options) => {
    try {
      const { revokePromotion } = await import('./lib/activity-runner.mjs');
      const result = revokePromotion({ repoRoot, date: options.date, signature: options.signature });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Revoke failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('delete-observation')
  .description('Delete an observation by signature')
  .requiredOption('--signature <sig>', 'Observation signature to delete')
  .requiredOption('--date <date>', 'Date of the observation (YYYY-MM-DD)')
  .action(async (options) => {
    try {
      const { deleteObservationById } = await import('./lib/activity-runner.mjs');
      const result = deleteObservationById({ repoRoot, date: options.date, signature: options.signature });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Delete-observation failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('digest')
  .description('Show observations for a date')
  .option('--date <date>', 'Date to digest (YYYY-MM-DD, defaults to today in KST)')
  .action(async (options) => {
    try {
      const { getDigestData } = await import('./lib/activity-runner.mjs');
      const date = options.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
      const result = getDigestData({ repoRoot, date });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Digest failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('post-digest')
  .description('Post Fisher activity digest to Slack channel')
  .option('--channel <id>', 'Slack channel ID (default: digest channel from config)')
  .option('--date <date>', 'Date to digest (YYYY-MM-DD, defaults to today in KST)')
  .option('--schedule <label>', 'Schedule label for the digest header (defaults to current KST HH:MM)')
  .action(async (options) => {
    try {
      const { existsSync, mkdirSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const {
        buildDigestBlocks,
        buildPromotedThreadBlocks,
        buildObservedThreadBlocks,
      } = await import('./lib/activity-digest.mjs');
      const {
        getDigestData,
        loadDigestState,
        saveDigestState,
      } = await import('./lib/activity-runner.mjs');
      const {
        loadExternalActivityRuntimeConfig,
        loadEnvFile,
        loadHermesSlackToken,
      } = await import('../workspace/fisher/external-activity-runtime/lib/config.mjs');

      for (const envPath of [
        resolve(repoRoot, '.env'),
        resolve(repoRoot, 'workspace', 'fisher', 'external-activity-runtime', '.env'),
      ]) {
        if (existsSync(envPath)) loadEnvFile(envPath);
      }
      loadHermesSlackToken();

      if (!process.env.SLACK_BOT_TOKEN) {
        throw new Error('Missing SLACK_BOT_TOKEN');
      }

      const runtimeConfig = loadExternalActivityRuntimeConfig(repoRoot);
      const channel = options.channel ?? runtimeConfig.digest?.channel;
      if (!channel) {
        throw new Error('No digest channel configured. Use --channel <id> or set digest.channel in config.');
      }

      const date = options.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
      const schedule = options.schedule ?? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date());
      const digest = getDigestData({ repoRoot, date });
      const blocks = buildDigestBlocks({
        promoted: digest.promoted,
        observed: digest.observed,
        schedule,
        maxHeadlineBullets: runtimeConfig.digest?.max_headline_bullets ?? 10,
      });

      const slackHeaders = {
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      };
      const postSlackMessage = async (method, payload) => {
        const response = await fetch(`https://slack.com/api/${method}`, {
          method: 'POST',
          headers: slackHeaders,
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!data.ok) {
          throw new Error(`Slack error: ${data.error}`);
        }
        return data;
      };

      const deletePrevious = runtimeConfig.digest?.delete_previous ?? true;
      const previousDigest = deletePrevious
        ? loadDigestState({ repoRoot, channel, date, schedule })
        : null;

      if (previousDigest?.root_ts) {
        const allTs = [previousDigest.root_ts, ...(previousDigest.thread_posts ?? []).map((p) => p.ts)].filter(Boolean);
        for (const ts of allTs.reverse()) {
          await postSlackMessage('chat.delete', { channel, ts });
        }
      }

      const data = await postSlackMessage('chat.postMessage', {
        channel,
        text: `Fisher Digest — ${schedule} KST`,
        blocks,
      });

      const threadPosts = [];
      const promotedBlocks = buildPromotedThreadBlocks({
        items: digest.promoted,
        maxItems: runtimeConfig.digest?.max_items_per_section ?? 10,
      });
      if (promotedBlocks.length > 0) {
        const promotedPost = await postSlackMessage('chat.postMessage', {
          channel,
          thread_ts: data.ts,
          text: `Promoted to team knowledge (${digest.promoted.length})`,
          blocks: promotedBlocks,
        });
        threadPosts.push({ kind: 'promoted', ts: promotedPost.ts, count: digest.promoted.length });
      }

      const observedBlocks = buildObservedThreadBlocks({
        items: digest.observed,
        maxItems: runtimeConfig.digest?.max_items_per_section ?? 10,
      });
      if (observedBlocks.length > 0) {
        const observedPost = await postSlackMessage('chat.postMessage', {
          channel,
          thread_ts: data.ts,
          text: `Observations (${digest.observed.length})`,
          blocks: observedBlocks,
        });
        threadPosts.push({ kind: 'observed', ts: observedPost.ts, count: digest.observed.length });
      }

      mkdirSync(resolve(repoRoot, '.hey', 'external-activity', 'digest-posts'), { recursive: true });
      saveDigestState({
        repoRoot,
        channel,
        date,
        schedule,
        payload: {
          channel,
          date,
          schedule,
          root_ts: data.ts,
          thread_posts: threadPosts,
        },
      });

      console.log(JSON.stringify({
        ok: true,
        channel,
        ts: data.ts,
        date,
        schedule,
        promoted: digest.promoted.length,
        observed: digest.observed.length,
        deleted_previous: Boolean(previousDigest?.root_ts),
        thread_posts: threadPosts,
      }, null, 2));
    } catch (error) {
      console.error(`Post-digest failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('status')
  .description('Show Fisher pipeline health and status')
  .option('--json', 'Output raw JSON')
  .action(async (options) => {
    try {
      const { gatherStatus } = await import('./lib/activity-status.mjs');
      const { loadExternalActivityConfig } = await import('./lib/activity-config.mjs');
      const config = loadExternalActivityConfig(repoRoot);
      const status = gatherStatus(repoRoot, config);

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log('Fisher Status Report');
        console.log('====================');
        console.log('');
        console.log('Source Health:');
        for (const [src, data] of Object.entries(status.sources)) {
          const icon = data.stale ? '⚠' : '✓';
          const age = data.age_hours !== null ? `${data.age_hours}h ago` : 'no events';
          console.log(`  ${icon} ${src}: ${age} (${data.recent_count} recent)`);
        }
        console.log('');
        const k = status.knowledge;
        console.log(`Knowledge (${status.kst_date.slice(0, 7)}): ${k.total} total | ${k.linked} linked | ${k.indexed} indexed | ${k.revoked} revoked | ${k.rejected} rejected`);
        console.log('');
        const obs = status.observations;
        console.log(`Observations (${obs.date}): ${obs.promoted} promoted | ${obs.observed} observed | ${obs.total} total`);
        console.log('');
        const cfg = status.config;
        console.log(`Config: reflection=${cfg.reflection_enabled ? 'on' : 'off'} (promote≥${cfg.promotion_threshold}, observe≥${cfg.observation_threshold}) | digest=${cfg.digest_enabled ? cfg.digest_schedule.join(',') + ' KST' : 'off'}`);
      }
    } catch (error) {
      console.error(`Status failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('post-status')
  .description('Post Fisher status report to Slack channel')
  .option('--channel <id>', 'Slack channel ID (default: digest channel from config)')
  .action(async (options) => {
    try {
      const { gatherStatus, buildStatusBlocks } = await import('./lib/activity-status.mjs');
      const { loadExternalActivityRuntimeConfig, loadEnvFile } = await import('../workspace/fisher/external-activity-runtime/lib/config.mjs');
      const { existsSync } = await import('node:fs');
      const { resolve } = await import('node:path');

      for (const envPath of [resolve(repoRoot, '.env'), resolve(repoRoot, 'workspace', 'fisher', 'external-activity-runtime', '.env')]) {
        if (existsSync(envPath)) loadEnvFile(envPath);
      }

      const runtimeConfig = loadExternalActivityRuntimeConfig(repoRoot);
      const channel = options.channel ?? runtimeConfig.digest?.channel;
      if (!channel) { console.error('No channel configured. Use --channel <id> or set digest.channel in config.'); process.exit(1); }
      if (!process.env.SLACK_BOT_TOKEN) { console.error('Missing SLACK_BOT_TOKEN'); process.exit(1); }

      const status = gatherStatus(repoRoot, runtimeConfig);
      const blocks = buildStatusBlocks(status);

      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, text: 'Fisher Status Report', blocks }),
      });
      const data = await res.json();
      if (data.ok) {
        console.log(`Status posted to ${channel}`);
      } else {
        console.error(`Slack error: ${data.error}`);
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(`Post status failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

activity
  .command('notify')
  .description('Notify approvers of open candidates (agent-handled — use approval-notify cron)')
  .action(() => {
    console.log('Notify is handled by the approval-notify cron job.');
    console.log('To trigger manually, run: hermes cron run <approval-notify-job-id>');
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error);
  process.exit(1);
});
