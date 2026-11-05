import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { loadManifest } from './indexer.mjs';

const execFileAsync = promisify(execFile);

export const OPEN_TASK_STATUSES = ['ready', 'doing', 'blocked', 'plan'];

// Only the two unambiguous reference forms carry a repository, so only these can
// be resolved. Bare "PR #123" is by far the most common shape in task bodies but
// names no repo, so it is deliberately ignored rather than guessed at.
const PR_URL = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/g;
const PR_SHORTHAND = /(?:^|[\s(\[`>])([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)\b/g;

// Words a task body uses to say a pull request has NOT landed yet. When the
// body says this and GitHub says MERGED, the file is stale in a way nobody has
// re-read — which is the failure this check exists to catch.
const PENDING_MARKERS = [
  'open', 'still open', 'awaiting', 'await', 'pending', 'not merged', 'unmerged',
  'not yet merged', 'in review', 'under review', 'to be merged', 'needs review',
  'not landed', 'yet to land', 'will land',
  '대기', '미머지', '리뷰 중', '머지 전', '아직',
];

const PENDING_PATTERN = new RegExp(`\\b(${PENDING_MARKERS.filter((m) => /^[a-z ]+$/.test(m)).join('|')})\\b`, 'i');
const PENDING_NON_LATIN = PENDING_MARKERS.filter((m) => !/^[a-z ]+$/.test(m));

function claimsPending(context) {
  const text = String(context ?? '');
  if (PENDING_PATTERN.test(text)) return true;
  return PENDING_NON_LATIN.some((marker) => text.includes(marker));
}

/**
 * Return the single source line containing an offset.
 *
 * A paragraph is too wide a window: YAML frontmatter is one unbroken block, and
 * a long prose paragraph reliably contains an incidental "open" or "waiting"
 * that has nothing to do with the reference. Measured against real task bodies,
 * the paragraph window produced mostly false positives; the line window does not.
 */
function lineAt(text, offset) {
  const start = text.lastIndexOf('\n', offset) + 1;
  const end = text.indexOf('\n', offset);
  return text.slice(start, end === -1 ? text.length : end);
}

/** Strip leading YAML frontmatter, which asserts nothing about PR state. */
function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  const offset = text.indexOf('\n', end + 1);
  return offset === -1 ? '' : ' '.repeat(offset + 1) + text.slice(offset + 1);
}

export function extractPrRefs(text) {
  const body = stripFrontmatter(String(text ?? ''));
  const found = new Map();
  const add = (owner, repo, number, offset) => {
    const key = `${owner}/${repo}#${number}`;
    const context = lineAt(body, offset);
    const existing = found.get(key);
    if (existing) {
      existing.claims_pending = existing.claims_pending || claimsPending(context);
      return;
    }
    found.set(key, {
      owner,
      repo,
      number: Number(number),
      key,
      claims_pending: claimsPending(context),
    });
  };
  for (const match of body.matchAll(PR_URL)) add(match[1], match[2], match[3], match.index);
  for (const match of body.matchAll(PR_SHORTHAND)) add(match[1], match[2], match[3], match.index);
  return [...found.values()];
}

async function ghPrState(ref) {
  const { stdout } = await execFileAsync('gh', [
    'pr', 'view', String(ref.number),
    '--repo', `${ref.owner}/${ref.repo}`,
    '--json', 'number,state,mergedAt,title',
  ], { maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  return { state: parsed.state, mergedAt: parsed.mergedAt ?? null, title: parsed.title ?? null };
}

async function pooled(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function fetchPrStates(refs, options = {}) {
  const fetcher = options.fetcher ?? ghPrState;
  const concurrency = Number(options.concurrency ?? 8);
  const states = new Map();
  const settled = await pooled(refs, concurrency, async (ref) => {
    try {
      return { key: ref.key, ...(await fetcher(ref)) };
    } catch (error) {
      return { key: ref.key, error: String(error?.message ?? error).split('\n')[0] };
    }
  });
  for (const entry of settled) states.set(entry.key, entry);
  return states;
}

/**
 * Find open tasks whose every referenced pull request has already merged.
 *
 * This is a reporting surface only — it never mutates a task. A merged PR is
 * evidence that the work landed, not proof that the definition of done is met,
 * so the decision to close stays with a human.
 */
export async function buildPrCheck(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const member = options.member ?? null;
  const statuses = new Set(options.statuses ?? OPEN_TASK_STATUSES);

  const tasks = loadManifest(root)
    .filter((item) => item.type === 'task')
    .filter((item) => statuses.has(item.status))
    .filter((item) => !member || item.owner === member);

  const refsByTask = new Map();
  const allRefs = new Map();
  for (const task of tasks) {
    let body = '';
    try {
      body = readFileSync(resolve(root, task.path), 'utf8');
    } catch {
      continue;
    }
    // Body first (it can assert pending state), then frontmatter `sources`.
    // Stripping frontmatter from the body scan costs Tier-2 coverage, so read it
    // back through the structured field — but never as a pending claim, since a
    // source entry records that a PR is relevant, not what state it is in.
    const refs = extractPrRefs(body);
    const byKey = new Map(refs.map((ref) => [ref.key, ref]));
    for (const source of task.sources ?? []) {
      for (const ref of extractPrRefs(String(source?.ref ?? ''))) {
        if (!byKey.has(ref.key)) byKey.set(ref.key, { ...ref, claims_pending: false });
      }
    }
    if (byKey.size === 0) continue;
    refsByTask.set(task.id, [...byKey.values()]);
    for (const ref of byKey.values()) allRefs.set(ref.key, ref);
  }

  const states = await fetchPrStates([...allRefs.values()], options);

  const contradictions = [];
  const allMerged = [];
  let unresolved = 0;
  for (const task of tasks) {
    const refs = refsByTask.get(task.id);
    if (!refs) continue;
    const resolved = refs
      .map((ref) => ({ ...ref, ...(states.get(ref.key) ?? {}) }))
      .filter((entry) => entry.state || entry.error);
    const failed = resolved.filter((entry) => entry.error);
    unresolved += failed.length;
    if (resolved.length === 0) continue;

    const describe = (entries) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      owner: task.owner ?? null,
      due_date: task.due_date ?? null,
      path: task.path,
      prs: entries.map((entry) => ({
        key: entry.key,
        state: entry.state,
        merged_at: entry.mergedAt ?? null,
        claims_pending: Boolean(entry.claims_pending),
      })),
    });

    // Tier 1 — the task body says this PR has not landed, and it has. The file
    // contradicts the world, so someone must re-read it. Independent of whether
    // other references resolved.
    const stale = resolved.filter((entry) => entry.state === 'MERGED' && entry.claims_pending);
    if (stale.length > 0) {
      contradictions.push(describe(stale));
      continue;
    }

    // Tier 2 — every reference merged. Weaker: most tasks cite the PRs that
    // built them, so this fires on healthy in-progress work too. Fail safe on
    // an unreadable reference, which is absence of evidence.
    if (failed.length > 0) continue;
    if (!resolved.every((entry) => entry.state === 'MERGED')) continue;
    allMerged.push(describe(resolved));
  }

  const byOldestMerge = (a, b) => {
    const left = a.prs.map((pr) => pr.merged_at ?? '').sort()[0] ?? '';
    const right = b.prs.map((pr) => pr.merged_at ?? '').sort()[0] ?? '';
    if (left !== right) return left.localeCompare(right);
    return a.id.localeCompare(b.id);
  };
  contradictions.sort(byOldestMerge);
  allMerged.sort(byOldestMerge);

  return {
    generated_at: new Date().toISOString(),
    member,
    checked_tasks: tasks.length,
    tasks_with_refs: refsByTask.size,
    unique_prs: allRefs.size,
    unresolved,
    contradictions,
    all_merged: allMerged,
  };
}

export function formatPrCheck(report) {
  const lines = ['', `Merged-PR check${report.member ? ` for ${report.member}` : ''}`, ''];
  lines.push(`Scanned ${report.checked_tasks} open task(s); ${report.tasks_with_refs} carry a resolvable PR reference (${report.unique_prs} unique PR(s)).`);
  if (report.unresolved > 0) {
    lines.push(`${report.unresolved} reference(s) could not be read — those tasks were skipped, not flagged.`);
  }
  lines.push('');

  const section = (heading, findings, note) => {
    if (findings.length === 0) return;
    lines.push(`${heading} (${findings.length})`);
    lines.push(`  ${note}`);
    lines.push('');
    for (const finding of findings) {
      const due = finding.due_date ? `, due ${finding.due_date}` : '';
      lines.push(`  ${finding.title}`);
      lines.push(`    ${finding.id} (${finding.status}${due}${finding.owner ? `, ${finding.owner}` : ''})`);
      for (const pr of finding.prs) {
        lines.push(`    - ${pr.key} merged ${pr.merged_at ? pr.merged_at.slice(0, 10) : '(date unknown)'}`);
      }
      lines.push('');
    }
  };

  section(
    'STALE TEXT — body says pending, GitHub says merged',
    report.contradictions,
    'The task file contradicts the world. Re-read it before anything else.'
  );
  section(
    'All referenced PRs merged',
    report.all_merged,
    'Weaker signal — a task usually cites the PRs that built it, so healthy in-progress work lands here too.'
  );

  if (report.contradictions.length === 0 && report.all_merged.length === 0) {
    lines.push('Nothing flagged.');
    lines.push('');
  } else {
    lines.push('A merged PR is evidence the work landed, not proof the definition of done is met.');
    lines.push('');
  }
  return lines.join('\n');
}
