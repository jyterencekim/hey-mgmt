import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inspectConnectorsStatus } from './desk-connectors.mjs';
import { parseEnvFile } from './desk-setup.mjs';

const STALE_LOCK_MS = 30 * 60 * 1000;

export const CRON_JOB_CATALOG = {
  'activity-sync': {
    id: 'activity-sync',
    title: 'External Activity Sync & Reflection',
    default_cron: '*/30 9-19 * * 1-5',
    default_cooldown_minutes: 20,
    description: 'Incrementally collect enabled external sources (via API collectors or host-agent MCP), classify/reflect updates, and commit workspace changes.',
  },
  'desk-morning-prep': {
    id: 'desk-morning-prep',
    title: 'Morning Desk Briefing & Catch-Up',
    default_cron: '20 8 * * 1-5',
    default_cooldown_minutes: 120,
    description: 'Pull latest repo changes, catch up stale connectors, rebuild local index/DB, and write today’s Loop Control digest into workspace/<member>/logs/YYYY-MM-DD.md.',
  },
  'desk-evening-scaffold': {
    id: 'desk-evening-scaffold',
    title: 'Evening Desk Scaffold & PR Reconciliation',
    default_cron: '0 19 * * 1-5',
    default_cooldown_minutes: 120,
    description: 'Rebuild index, run ./hey log scaffold for today’s commits/runs/tasks, check merged PRs, and commit today’s log scaffold.',
  },
};

function cronStatePath(repoRoot, job) {
  return resolve(repoRoot, '.hey', 'cron-state', `${job}.json`);
}

function readCronState(repoRoot, job) {
  const path = cronStatePath(repoRoot, job);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function writeCronState(repoRoot, job, state) {
  const path = cronStatePath(repoRoot, job);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return path;
}

function isPidAlive(pid) {
  if (!pid || !Number.isInteger(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

export function listCronJobs() {
  return Object.values(CRON_JOB_CATALOG);
}

export function renderCronJob(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const jobId = String(options.job ?? '').trim();
  const def = CRON_JOB_CATALOG[jobId];
  if (!def) {
    throw new Error(`Unknown cron job '${jobId}'. Valid jobs: ${Object.keys(CRON_JOB_CATALOG).join(', ')}`);
  }

  const env = parseEnvFile(resolve(root, '.env'));
  const member = String(options.member || env.MEMBER || process.env.MEMBER || 'alice').trim().toLowerCase();
  const tz = String(options.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul').trim();
  const cron = String(options.schedule || def.default_cron).trim();
  const cronWithTz = `CRON_TZ=${tz} ${cron}`;

  const connectorStatus = inspectConnectorsStatus(root);
  const enabled = connectorStatus.connectors.filter((c) => c.enabled);
  const apiSources = enabled.filter((c) => c.mode === 'api-token').map((c) => c.source);
  const mcpSources = enabled.filter((c) => c.mode === 'agent-mcp').map((c) => c.source);

  const steps = [];
  steps.push(
    `1. Change directory to \`${root}\` and run preflight:`,
    `   \`HEY_REPO_ROOT="${root}" ./hey cron preflight --job ${jobId} --cooldown-minutes ${def.default_cooldown_minutes} --pull --json\``,
    '   If `"should_run": false`, stop immediately with zero changes.',
  );

  if (jobId === 'activity-sync') {
    if (apiSources.length > 0) {
      steps.push(
        `2. Poll enabled API connectors (${apiSources.join(', ')}):`,
        ...apiSources.map((src) => `   \`HEY_REPO_ROOT="${root}" FISHER_ACTIVITY_BATCH_NO_GIT_SYNC=1 ./hey activity poll ${src}\``),
      );
    }
    if (mcpSources.length > 0) {
      steps.push(
        `${apiSources.length > 0 ? '3' : '2'}. Collect enabled MCP connectors (${mcpSources.join(', ')}) using your host agent's connected MCP/plugin tools (look up each source's \`last_polled_at\` via \`./hey connector status --json\`), format items as JSON \`[{ source, object_id, title, url, actor, changed_at, summary }]\`, and pipe into:`,
        `   \`HEY_REPO_ROOT="${root}" ./hey activity push-events --stdin --owner ${member} --json\``,
      );
    }
    if (enabled.length === 0) {
      steps.push('2. Check `./hey connector status --json`; if no connectors are enabled yet, skip collection and continue to completion.');
    }
    steps.push(
      '3. Run `HEY_REPO_ROOT="' + root + '" ./hey activity prepare-candidates` (or classify new recent events), classify unmatched items (`match` | `distill` | `skip` + reflection `promote` | `observe` | `filter`), and apply via `./hey activity finalize-reflections --data \'{...}\'`.',
      '4. Run `HEY_REPO_ROOT="' + root + `" ./hey cron complete --job ${jobId} --status ok --json\`.`,
      '5. Run `HEY_REPO_ROOT="' + root + '" ./hey validate`; commit and push only modified `workspace/` and `content/` files if clean.',
    );
  } else if (jobId === 'desk-morning-prep') {
    steps.push(
      '2. Run `HEY_REPO_ROOT="' + root + '" ./hey connector status --json`; if any enabled connector is marked `"stale": true`, run one catch-up pass (`./hey activity poll <source>` for `api-token`, or MCP fetch + `./hey activity push-events --stdin` for `agent-mcp`).',
      '3. Run `HEY_REPO_ROOT="' + root + `" ./hey index build && HEY_REPO_ROOT="${root}" ./hey db build\`.`,
      '4. Run `HEY_REPO_ROOT="' + root + `" ./hey loop digest --member ${member} --record\`.`,
      '5. Run `HEY_REPO_ROOT="' + root + `" ./hey cron complete --job ${jobId} --status ok --json\`.`,
      `6. Stage \`workspace/${member}/logs/\` only, commit ("digest: morning ${member}") if changed, and push to origin.`,
    );
  } else if (jobId === 'desk-evening-scaffold') {
    steps.push(
      '2. Run `HEY_REPO_ROOT="' + root + '" ./hey index build`.',
      '3. Run `HEY_REPO_ROOT="' + root + `" ./hey log scaffold --member ${member}\` and \`HEY_REPO_ROOT="${root}" ./hey loop pr-check\`.`,
      '4. Run `HEY_REPO_ROOT="' + root + `" ./hey cron complete --job ${jobId} --status ok --json\`.`,
      `5. Stage \`workspace/${member}/logs/\` only, commit ("log: scaffold ${member}") if changed, and push to origin.`,
    );
  }

  const prompt = [
    `# Scheduled Job: ${def.title} (${jobId})`,
    '',
    'Stateless scheduled turn for `hey-mgmt`. Do NOT install or edit OS `launchd` or `crontab` entries.',
    '',
    ...steps,
  ].join('\n');

  return {
    job: jobId,
    title: def.title,
    member,
    timezone: tz,
    cron,
    cron_with_tz: cronWithTz,
    cwd: root,
    enabled_connectors: enabled.map((c) => ({ source: c.source, mode: c.mode })),
    prompt,
    agent_registration_guide: {
      rule: 'Register via your AI agent native scheduler (NEVER use OS launchd or crontab).',
      examples: {
        antigravity: 'Use the `automation` skill (/automation) with the `cron_with_tz` schedule and `prompt` above.',
        claude: 'Register via Claude Scheduled Tasks / `CronCreate` with the 5-field `cron` schedule and `prompt`.',
        codex: 'Create a Codex App Automation targeting `cwd`, `cron`, and `prompt` above.',
        hermes: 'Register via `hermes cron` pointing to `cwd` with the steps above.',
      },
    },
  };
}

export function preflightCronJob(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const jobId = String(options.job ?? '').trim();
  const def = CRON_JOB_CATALOG[jobId];
  if (!def) {
    throw new Error(`Unknown cron job '${jobId}'. Valid jobs: ${Object.keys(CRON_JOB_CATALOG).join(', ')}`);
  }

  const cooldownMinutes = options.cooldownMinutes !== undefined
    ? Number(options.cooldownMinutes)
    : def.default_cooldown_minutes;
  const now = options.now ? Number(options.now) : Date.now();

  let pulled = false;
  if (options.pull && existsSync(resolve(root, '.git'))) {
    try {
      const hasOrigin = execFileSync('git', ['-C', root, 'remote'], { encoding: 'utf8' })
        .split(/\r?\n/)
        .includes('origin');
      if (hasOrigin) {
        execFileSync('git', ['-C', root, 'pull', '--rebase', '--autostash', 'origin', 'main'], {
          stdio: 'ignore',
          timeout: 15000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        pulled = true;
      }
    } catch {
      pulled = false;
    }
  }

  const state = readCronState(root, jobId);
  const lockedAtMs = state.locked_at ? Date.parse(state.locked_at) : NaN;
  if (
    state.running_pid &&
    Number.isFinite(lockedAtMs) &&
    now - lockedAtMs < STALE_LOCK_MS &&
    isPidAlive(state.running_pid)
  ) {
    return {
      should_run: false,
      reason: 'locked',
      job: jobId,
      pulled,
      running_pid: state.running_pid,
      last_run_at: state.last_run_at ?? null,
    };
  }

  const lastRunMs = state.last_run_at ? Date.parse(state.last_run_at) : NaN;
  if (Number.isFinite(lastRunMs) && cooldownMinutes > 0) {
    const elapsedMinutes = (now - lastRunMs) / 60_000;
    if (elapsedMinutes < cooldownMinutes) {
      return {
        should_run: false,
        reason: 'cooldown',
        job: jobId,
        pulled,
        elapsed_minutes: Math.round(elapsedMinutes * 10) / 10,
        cooldown_minutes: cooldownMinutes,
        last_run_at: state.last_run_at,
      };
    }
  }

  const nextState = {
    ...state,
    job: jobId,
    running_pid: process.pid,
    locked_at: new Date(now).toISOString(),
  };
  writeCronState(root, jobId, nextState);

  return {
    should_run: true,
    reason: 'ready',
    job: jobId,
    pulled,
    last_run_at: state.last_run_at ?? null,
  };
}

export function completeCronJob(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const jobId = String(options.job ?? '').trim();
  if (!CRON_JOB_CATALOG[jobId]) {
    throw new Error(`Unknown cron job '${jobId}'. Valid jobs: ${Object.keys(CRON_JOB_CATALOG).join(', ')}`);
  }
  const nowIso = options.completedAt || new Date().toISOString();
  const state = readCronState(root, jobId);
  const nextState = {
    ...state,
    job: jobId,
    running_pid: null,
    locked_at: null,
    last_run_at: nowIso,
    last_status: options.status || 'ok',
    last_summary: options.summary || '',
  };
  writeCronState(root, jobId, nextState);
  return nextState;
}
