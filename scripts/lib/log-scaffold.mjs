import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadManifest } from './indexer.mjs';
import { assertKnownMember } from './members.mjs';
import { listRunAttempts } from './work-runs.mjs';

export const SCAFFOLD_START = '<!-- fisher:scaffold:start -->';
export const SCAFFOLD_END = '<!-- fisher:scaffold:end -->';

function dateOnly(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function kstToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

function kstDate(iso) {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(parsed);
}

function memberAuthors(root, member) {
  const authors = new Set([member]);
  // github_login lives in the Fisher runtime config, the same mapping the
  // activity pipeline uses for actor resolution.
  try {
    const configPath = resolve(root, 'workspace', 'fisher', 'config', 'external-activity.yml');
    const config = parseYaml(readFileSync(configPath, 'utf8')) ?? {};
    const login = config?.members?.[member]?.github_login;
    if (login) authors.add(login);
  } catch { /* config unreadable — member name alone still matches */ }
  return [...authors];
}

function collectCommits(root, member, date) {
  const args = [
    'log',
    `--since=${date}T00:00:00+09:00`,
    `--until=${date}T23:59:59+09:00`,
    '--date=format:%H:%M',
    '--format=%h|%ad|%an|%s',
  ];
  let raw = '';
  try {
    raw = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TZ: 'Asia/Seoul' },
    });
  } catch {
    return [];
  }
  const authors = memberAuthors(root, member).map((name) => name.toLowerCase());
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, time, author, ...subject] = line.split('|');
      return { hash, time, author, subject: subject.join('|') };
    })
    .filter((commit) => authors.includes(String(commit.author ?? '').toLowerCase()));
}

/**
 * Gather the day's pastward facts for one member (D2: the scaffold is facts
 * only — commits, agent-run outcomes, tasks touched — never a judgment line).
 */
export function buildLogScaffold(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const member = options.member;
  if (!member) throw new Error('log scaffold requires --member');
  assertKnownMember(root, member);
  const date = dateOnly(options.date) ?? kstToday();

  const commits = options.commits ?? collectCommits(root, member, date);

  const runs = (options.runs ?? listRunAttempts(root, { limit: 200 }))
    .map((run) => {
      const events = [];
      if (kstDate(run.claimed_at) === date) events.push('claimed');
      if (kstDate(run.completed_at) === date) events.push('completed');
      if (kstDate(run.failed_at) === date) events.push('failed');
      return { run_id: run.run_id, task_id: run.task_id ?? null, status: run.status ?? null, events };
    })
    .filter((run) => run.events.length > 0);

  const tasksTouched = loadManifest(root)
    .filter((item) => item.type === 'task' && item.owner === member)
    .filter((item) => dateOnly(item.updated_at) === date)
    .map((item) => ({ id: item.id, title: item.title, status: item.status }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    generated_at: new Date().toISOString(),
    member,
    date,
    commits,
    runs,
    tasks_touched: tasksTouched,
  };
}

export function renderScaffoldSection(scaffold) {
  const lines = [
    SCAFFOLD_START,
    '## Auto scaffold',
    '<!-- Written by Fisher (D2): pastward facts only. Reflection and judgment lines stay member-authored. -->',
    `Generated at ${scaffold.generated_at} for ${scaffold.date}.`,
    '',
    `### Commits (${scaffold.commits.length})`,
  ];
  for (const commit of scaffold.commits) {
    lines.push(`- ${commit.time} \`${commit.hash}\` ${commit.subject}`);
  }
  if (scaffold.commits.length === 0) lines.push('- (none)');

  lines.push('', `### Agent runs (${scaffold.runs.length})`);
  for (const run of scaffold.runs) {
    lines.push(`- \`${run.run_id}\` ${run.task_id ?? '-'} — ${run.events.join('+')}, now ${run.status ?? '-'}`);
  }
  if (scaffold.runs.length === 0) lines.push('- (none)');

  lines.push('', `### Tasks touched (${scaffold.tasks_touched.length})`);
  for (const task of scaffold.tasks_touched) {
    lines.push(`- ${task.title} (\`${task.id}\`, ${task.status})`);
  }
  if (scaffold.tasks_touched.length === 0) lines.push('- (none)');

  lines.push(SCAFFOLD_END);
  return lines.join('\n');
}

/**
 * Replace a marker-delimited section of a member's daily log, creating the log
 * when it is absent. Only the text between the markers is ever touched; every
 * human-authored line outside them survives.
 *
 * The log is the single durable record of a member's day — there is no
 * `digests/` directory — so more than one unattended writer lands here. Each
 * owns its own marker pair and nothing else, which is what keeps machine-written
 * and member-written content separable inside one file.
 *
 * Unbalanced markers throw rather than auto-repair: a half-written section means
 * a previous run died mid-write, and guessing which half to keep can silently
 * destroy a member's text.
 */
export function applyMarkedSection(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const { member, date, section, startMarker, endMarker, label = 'scaffold' } = options;
  if (!member || !date || !section) throw new Error('applyMarkedSection requires member, date, section');
  if (!startMarker || !endMarker) throw new Error('applyMarkedSection requires startMarker, endMarker');

  const logDir = resolve(root, 'workspace', member, 'logs');
  const logPath = resolve(logDir, `${date}.md`);

  if (!existsSync(logPath)) {
    mkdirSync(logDir, { recursive: true });
    writeFileSync(logPath, `# ${date}\n\n${section}\n`, 'utf8');
    return { path: logPath, created: true, replaced: false };
  }

  const current = readFileSync(logPath, 'utf8');
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);

  if ((start === -1) !== (end === -1)) {
    throw new Error(`unbalanced ${label} markers in ${logPath} — fix the file by hand before re-running`);
  }

  let next;
  let replaced = false;
  if (start !== -1) {
    next = current.slice(0, start) + section + current.slice(end + endMarker.length);
    replaced = true;
  } else {
    next = `${current.trimEnd()}\n\n${section}\n`;
  }

  if (next !== current) writeFileSync(logPath, next, 'utf8');
  return { path: logPath, created: false, replaced };
}

/**
 * Write the scaffold into the member's daily log, marker-scoped and
 * idempotent (precedent: /snap's Horizon-section replace). Only the text
 * between the markers is ever replaced; every human-authored line survives.
 */
export function applyLogScaffold(repoRoot, options = {}) {
  const { member, date, section } = options;
  if (!member || !date || !section) throw new Error('applyLogScaffold requires member, date, section');
  return applyMarkedSection(repoRoot, {
    member,
    date,
    section,
    startMarker: SCAFFOLD_START,
    endMarker: SCAFFOLD_END,
    label: 'scaffold',
  });
}
