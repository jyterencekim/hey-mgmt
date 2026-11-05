import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function listRunAttempts(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const runsDir = resolve(root, '.hey', 'orch', 'runs');
  if (!existsSync(runsDir)) return [];

  const limit = Number(options.limit ?? 10);
  const taskId = options.taskId ?? null;
  const status = options.status ?? null;
  const runs = [];

  const runIds = readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const runId of runIds) {
    if (runs.length >= limit) break;
    const attemptPath = resolve(runsDir, runId, 'attempt.json');
    if (!existsSync(attemptPath)) continue;

    const attempt = readJson(attemptPath);
    if (!attempt) continue;
    if (taskId && attempt.task_id !== taskId) continue;
    if (status && attempt.status !== status) continue;

    runs.push({
      ...attempt,
      run_id: runId,
    });
  }

  return runs;
}

export function groupRunAttemptsByTask(runs) {
  const byTask = new Map();
  for (const run of runs) {
    if (!run.task_id) continue;
    if (!byTask.has(run.task_id)) byTask.set(run.task_id, []);
    byTask.get(run.task_id).push(run);
  }
  return byTask;
}

export function summarizeRunAttempts(runs) {
  const summary = {
    total: runs.length,
    by_status: {},
    active_run_ids: [],
  };

  for (const run of runs) {
    const status = run.status ?? 'unknown';
    summary.by_status[status] = (summary.by_status[status] ?? 0) + 1;
    if (status === 'in_progress') summary.active_run_ids.push(run.run_id);
  }

  return summary;
}
