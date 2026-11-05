import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, extname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { ingestActivityEvents } from '../../../../scripts/lib/activity-runner.mjs';
import { appendKnowledgeEntry } from '../../../../scripts/lib/activity-state.mjs';
import {
  readJson,
  stableHash,
  writeJson,
} from './collector-utils.mjs';

/**
 * Parse repos from content/vocab/repos.yml.
 * Returns [{ owner, repo, name }] for entries with a github.com remote.
 */
function parseReposYml(repoRoot) {
  const ymlPath = resolve(repoRoot, 'content/vocab/repos.yml');
  let raw;
  try { raw = readFileSync(ymlPath, 'utf8'); } catch { return []; }
  const repos = [];
  const lines = raw.split('\n');
  let currentName = '';
  for (const line of lines) {
    const nameMatch = line.match(/^\s*-\s*name:\s*(.+)/);
    if (nameMatch) { currentName = nameMatch[1].trim(); continue; }
    const remoteMatch = line.match(/^\s*remote:\s*(https:\/\/github\.com\/([^/]+)\/([^/\s]+))/);
    if (remoteMatch) {
      const owner = remoteMatch[2];
      const repo = remoteMatch[3].replace(/\.git$/, '');
      repos.push({ owner, repo, name: currentName || repo });
    }
  }
  return repos;
}

function normalizeOwnerRepo(value) {
  if (!value) return '';
  return String(value)
    .trim()
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '');
}

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function branchMatchesPatterns(branch, patterns = []) {
  if (!patterns.length) return branch === 'main';
  return patterns.some((pattern) => globToRegExp(pattern).test(branch));
}

function repoEntryOwnerRepo(entry) {
  return normalizeOwnerRepo(entry?.owner_repo ?? entry?.repo ?? entry?.remote ?? entry?.name);
}

function formatKstDate(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function activitySignature(values) {
  return createHash('sha256').update(values.join('|')).digest('hex').slice(0, 16);
}

function safeKey(value) {
  return String(value).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140) || 'file';
}

function markdownTitle(path, content) {
  const withoutFrontmatter = String(content ?? '').replace(/^---\n[\s\S]*?\n---\n?/, '');
  const heading = withoutFrontmatter.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 180);
  return basename(path, extname(path)).replace(/[-_]+/g, ' ').trim() || path;
}

function summarizeMarkdown(content, fallbackTitle) {
  const body = String(content ?? '')
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/^[-*]\s*$/.test(line));
  const summary = body.slice(0, 8).join(' ').replace(/\s+/g, ' ').trim();
  return (summary || fallbackTitle || 'Tracked onchain-analysis knowledge file').slice(0, 1200);
}

function fileContentForKnowledge(content, maxChars = 60_000) {
  const normalized = String(content ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}\n\n[Truncated for Fisher knowledge indexing: original ${normalized.length} chars]`;
}

function trackedFileMatches(path, repoConfig, collectorConfig) {
  const dirs = repoConfig.file_dirs ?? collectorConfig.file_dirs ?? ['insights', 'observations', 'reports', 'research'];
  const extensions = repoConfig.file_extensions ?? collectorConfig.file_extensions ?? ['.md', '.mdx', '.qmd'];
  const normalizedPath = String(path ?? '').replace(/^\/+/, '');
  if (!extensions.includes(extname(normalizedPath).toLowerCase())) return false;
  return dirs.some((dir) => normalizedPath === dir || normalizedPath.startsWith(`${String(dir).replace(/\/+$/, '')}/`));
}

function mapGitHubLoginToMember(config, login) {
  if (!login) return null;
  const normalizedLogin = login.toLowerCase();
  for (const [memberKey, member] of Object.entries(config.members ?? {})) {
    const ghLogin = (member?.github_login ?? '').toLowerCase();
    if (ghLogin && ghLogin === normalizedLogin) return memberKey;
  }
  return null;
}

function ghCli(args) {
  try {
    return execSync(`gh ${args}`, {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function ghJson(args) {
  const raw = ghCli(args);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function ghLines(args) {
  const raw = ghCli(args);
  if (!raw) return [];
  return raw.split('\n').map((line) => line.trim()).filter(Boolean);
}

function ghBlobContent(ownerRepo, sha) {
  const blob = ghJson(`api repos/${ownerRepo}/git/blobs/${sha}`);
  const encoded = typeof blob?.content === 'string' ? blob.content.replace(/\s+/g, '') : '';
  if (!encoded) return '';
  try { return Buffer.from(encoded, 'base64').toString('utf8'); } catch { return ''; }
}

function shouldCollectPullRequestEvents(repoConfig, collectorConfig) {
  return repoConfig.collect_pr_events === true || collectorConfig.collect_pr_events === true;
}

export class GitHubCollector {
  constructor({
    repoRoot,
    config,
    ingestEvents = ingestActivityEvents,
  }) {
    this.repoRoot = repoRoot;
    this.config = config;
    this.ingestEvents = ingestEvents;
    this.collectorConfig = config.github ?? {};
    this.statePath = resolve(repoRoot, this.collectorConfig.state_path ?? '.runtime/github-collector/state.json');
    this.rawEventDir = resolve(repoRoot, this.collectorConfig.raw_event_dir ?? '.runtime/github-collector/raw');
  }

  readState() {
    return readJson(this.statePath, { repos: {} });
  }

  writeState(state) {
    writeJson(this.statePath, state);
  }

  writeRawJson(kind, key, value) {
    const path = resolve(this.rawEventDir, kind, `${key}.json`);
    writeJson(path, value);
    return path;
  }

  ghIsAvailable() {
    const whoami = ghCli('api user --jq .login');
    return Boolean(whoami);
  }

  collectRepos() {
    const repoVocab = parseReposYml(this.repoRoot);
    const configuredRepos = Array.isArray(this.collectorConfig.repositories)
      ? this.collectorConfig.repositories
      : [];
    const overrides = this.collectorConfig.repository_overrides ?? {};

    const selected = configuredRepos.length > 0
      ? repoVocab.filter((repo) => {
          const ownerRepo = `${repo.owner}/${repo.repo}`;
          return configuredRepos.some((entry) => {
            const configuredOwnerRepo = repoEntryOwnerRepo(entry);
            return configuredOwnerRepo === ownerRepo || configuredOwnerRepo === repo.name;
          });
        })
      : repoVocab;

    return selected.map((repo) => {
      const ownerRepo = `${repo.owner}/${repo.repo}`;
      const inline = configuredRepos.find((entry) => {
        const configuredOwnerRepo = repoEntryOwnerRepo(entry);
        return configuredOwnerRepo === ownerRepo || configuredOwnerRepo === repo.name;
      }) ?? {};
      const override = overrides[ownerRepo] ?? overrides[repo.name] ?? {};
      return { ...repo, config: { ...inline, ...override } };
    });
  }

  async trackPRs({ ownerRepo, state, events, limit }) {
    const repoState = state.repos[ownerRepo] ??= { prs: {}, issues: {}, files: {} };

    // Open PRs
    const openPrs = ghJson(
      `pr list --repo ${ownerRepo} --state open --limit ${limit} --json number,title,author,createdAt,updatedAt,reviewDecision,url,state`
    );

    // Recently merged/closed PRs
    const sinceDate = new Date(Date.now() - (this.collectorConfig.initial_lookback_days ?? 7) * 86400_000)
      .toISOString().slice(0, 10);
    const closedPrs = ghJson(
      `pr list --repo ${ownerRepo} --state merged --limit ${limit} --search "merged:>=${sinceDate}" --json number,title,author,mergedAt,updatedAt,url,state`
    );

    const allPrs = [...openPrs, ...closedPrs];

    for (const pr of allPrs) {
      const prNum = String(pr.number);
      const fingerprint = stableHash({
        state: pr.state,
        title: pr.title,
        updated_at: pr.updatedAt || pr.mergedAt,
        review_decision: pr.reviewDecision ?? '',
      });

      if (repoState.prs[prNum]?.fingerprint === fingerprint) continue;

      const rawPath = this.writeRawJson('prs', `${ownerRepo.replace('/', '-')}-${prNum}`, pr);
      const author = pr.author?.login ?? 'unknown';
      const workspaceOwner = mapGitHubLoginToMember(this.config, author)
        ?? this.config.approval?.artifact_owner_fallback ?? 'alice';

      const prState = pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open';
      const reviewNote = pr.reviewDecision ? ` [${pr.reviewDecision}]` : '';

      events.push({
        source: 'github',
        object_type: 'github-pr',
        object_id: `${ownerRepo}/pull/${prNum}`,
        object_title: `PR #${prNum}: ${pr.title}`,
        object_url: pr.url || `https://github.com/${ownerRepo}/pull/${prNum}`,
        actor: author,
        workspace_owner: workspaceOwner,
        changed_at: pr.updatedAt || pr.mergedAt || pr.createdAt,
        native_change_id: `pr-${prNum}-${fingerprint.slice(0, 8)}`,
        summary: `GitHub PR ${prState}${reviewNote}: ${pr.title}`,
        raw_ref: rawPath,
        content_hint: {
          status: prState,
          review_decision: pr.reviewDecision ?? '',
        },
      });

      repoState.prs[prNum] = {
        fingerprint,
        updated_at: pr.updatedAt || pr.mergedAt,
        last_polled_at: new Date().toISOString(),
      };
    }
  }

  async trackIssues({ ownerRepo, state, events, limit }) {
    const repoState = state.repos[ownerRepo] ??= { prs: {}, issues: {}, files: {} };

    const openIssues = ghJson(
      `issue list --repo ${ownerRepo} --state open --limit ${limit} --json number,title,author,createdAt,updatedAt,url,state,assignees`
    );

    for (const issue of openIssues) {
      const issueNum = String(issue.number);
      const fingerprint = stableHash({
        state: issue.state,
        title: issue.title,
        updated_at: issue.updatedAt,
      });

      if (repoState.issues[issueNum]?.fingerprint === fingerprint) continue;

      const rawPath = this.writeRawJson('issues', `${ownerRepo.replace('/', '-')}-${issueNum}`, issue);
      const author = issue.author?.login ?? 'unknown';

      // Map to the assigned member, fall back to author, then fallback
      const assigneeLogin = issue.assignees?.[0]?.login;
      const workspaceOwner = mapGitHubLoginToMember(this.config, assigneeLogin)
        ?? mapGitHubLoginToMember(this.config, author)
        ?? this.config.approval?.artifact_owner_fallback ?? 'alice';

      events.push({
        source: 'github',
        object_type: 'github-issue',
        object_id: `${ownerRepo}/issues/${issueNum}`,
        object_title: `Issue #${issueNum}: ${issue.title}`,
        object_url: issue.url || `https://github.com/${ownerRepo}/issues/${issueNum}`,
        actor: author,
        workspace_owner: workspaceOwner,
        changed_at: issue.updatedAt || issue.createdAt,
        native_change_id: `issue-${issueNum}-${fingerprint.slice(0, 8)}`,
        summary: `GitHub issue ${issue.state === 'OPEN' ? 'open' : 'closed'}: ${issue.title}`,
        raw_ref: rawPath,
        content_hint: {
          status: issue.state === 'OPEN' ? 'open' : 'closed',
        },
      });

      repoState.issues[issueNum] = {
        fingerprint,
        updated_at: issue.updatedAt,
        last_polled_at: new Date().toISOString(),
      };
    }
  }

  listBranches(ownerRepo) {
    return ghLines(`api repos/${ownerRepo}/branches?per_page=100 --jq '.[].name'`);
  }

  async trackCommits({ ownerRepo, repoConfig, state, events, limit }) {
    const repoState = state.repos[ownerRepo] ??= { prs: {}, issues: {}, commits: {} };
    repoState.commits ??= {};

    const branchPatterns = repoConfig.branch_patterns
      ?? this.collectorConfig.branch_patterns
      ?? ['main'];
    const branches = this.listBranches(ownerRepo)
      .filter((branch) => branchMatchesPatterns(branch, branchPatterns));
    if (branches.length === 0) return;

    const sinceMs = Date.now() - (this.collectorConfig.initial_lookback_days ?? 7) * 86400_000;
    const commitsBySha = new Map();

    for (const branch of branches) {
      const branchCommits = ghJson(
        `api repos/${ownerRepo}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}`
      );
      for (const commit of Array.isArray(branchCommits) ? branchCommits : []) {
        const sha = commit.sha;
        if (!sha) continue;
        const changedAt = commit.commit?.committer?.date ?? commit.commit?.author?.date;
        if (changedAt && Date.parse(changedAt) < sinceMs) continue;
        const entry = commitsBySha.get(sha) ?? { commit, branches: [] };
        entry.branches.push(branch);
        commitsBySha.set(sha, entry);
      }
    }

    for (const [sha, entry] of commitsBySha.entries()) {
      const commit = entry.commit;
      const message = commit.commit?.message ?? '';
      const title = message.split('\n').find(Boolean) ?? sha.slice(0, 12);
      const changedAt = commit.commit?.committer?.date ?? commit.commit?.author?.date ?? new Date().toISOString();
      const branchesForCommit = [...new Set(entry.branches)].sort();
      const fingerprint = stableHash({ sha, message, changed_at: changedAt });

      if (repoState.commits[sha]?.fingerprint === fingerprint) {
        repoState.commits[sha] = {
          ...repoState.commits[sha],
          branches: branchesForCommit,
          last_polled_at: new Date().toISOString(),
        };
        continue;
      }

      const detail = ghJson(`api repos/${ownerRepo}/commits/${sha}`);
      const rawPath = this.writeRawJson('commits', `${ownerRepo.replace('/', '-')}-${sha}`, {
        ...(detail && !Array.isArray(detail) ? detail : commit),
        branches: branchesForCommit,
      });
      const author = commit.author?.login ?? commit.commit?.author?.name ?? 'unknown';
      const workspaceOwner = mapGitHubLoginToMember(this.config, commit.author?.login)
        ?? this.config.approval?.artifact_owner_fallback ?? 'alice';
      const filesChanged = Array.isArray(detail?.files) ? detail.files.length : undefined;

      events.push({
        source: 'github',
        object_type: 'github-commit',
        object_id: `${ownerRepo}/commit/${sha}`,
        object_title: `Commit ${sha.slice(0, 7)}: ${title}`,
        object_url: commit.html_url || `https://github.com/${ownerRepo}/commit/${sha}`,
        actor: author,
        workspace_owner: workspaceOwner,
        changed_at: changedAt,
        native_change_id: `commit-${sha.slice(0, 12)}-${fingerprint.slice(0, 8)}`,
        summary: `GitHub commit on ${ownerRepo} (${branchesForCommit.join(', ')}): ${title}`,
        raw_ref: rawPath,
        content_hint: {
          status: 'commit',
          repository: ownerRepo,
          branches: branchesForCommit,
          files_changed: filesChanged,
        },
      });

      repoState.commits[sha] = {
        fingerprint,
        branches: branchesForCommit,
        updated_at: changedAt,
        last_polled_at: new Date().toISOString(),
      };
    }
  }

  async trackFiles({ ownerRepo, repoConfig, state, events, limit }) {
    const repoState = state.repos[ownerRepo] ??= { prs: {}, issues: {}, files: {} };
    repoState.files ??= {};

    const branchPatterns = repoConfig.branch_patterns
      ?? this.collectorConfig.branch_patterns
      ?? ['main'];
    const branches = this.listBranches(ownerRepo)
      .filter((branch) => branchMatchesPatterns(branch, branchPatterns));
    if (branches.length === 0) return;

    let processed = 0;
    const maxContentChars = Math.max(1_000, Number(repoConfig.max_file_content_chars ?? this.collectorConfig.max_file_content_chars ?? 60_000));

    for (const branch of branches) {
      if (processed >= limit) break;
      const tree = ghJson(`api repos/${ownerRepo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
      const entries = Array.isArray(tree?.tree) ? tree.tree : [];
      const files = entries
        .filter((entry) => entry?.type === 'blob' && trackedFileMatches(entry.path, repoConfig, this.collectorConfig))
        .sort((a, b) => String(a.path).localeCompare(String(b.path)));

      for (const file of files) {
        if (processed >= limit) break;
        const stateKey = `${branch}:${file.path}`;
        const fingerprint = stableHash({ branch, path: file.path, sha: file.sha, size: file.size ?? null });
        if (repoState.files[stateKey]?.fingerprint === fingerprint) continue;

        const content = ghBlobContent(ownerRepo, file.sha);
        if (!content.trim()) continue;

        const changedAt = new Date().toISOString();
        const title = markdownTitle(file.path, content);
        const summary = summarizeMarkdown(content, title);
        const objectId = `${ownerRepo}/blob/${branch}/${file.path}`;
        const objectUrl = `https://github.com/${ownerRepo}/blob/${encodeURIComponent(branch)}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
        const nativeChangeId = `file-${stableHash({ branch, path: file.path, sha: file.sha }).slice(0, 12)}`;
        const rawPath = this.writeRawJson('files', `${ownerRepo.replace('/', '-')}-${safeKey(branch)}-${safeKey(file.path)}-${file.sha.slice(0, 12)}`, {
          owner_repo: ownerRepo,
          branch,
          path: file.path,
          sha: file.sha,
          size: file.size ?? null,
          url: objectUrl,
          title,
          summary,
          content,
        });

        const event = {
          source: 'github',
          object_type: 'github-file',
          object_id: objectId,
          object_title: `onchain-analysis ${file.path}: ${title}`,
          object_url: objectUrl,
          actor: 'github',
          workspace_owner: this.config.approval?.artifact_owner_fallback ?? 'alice',
          changed_at: changedAt,
          native_change_id: nativeChangeId,
          summary: `GitHub tracked knowledge file on ${ownerRepo} (${branch}): ${file.path} — ${summary}`,
          raw_ref: rawPath,
          content_hint: {
            status: 'file-indexed',
            repository: ownerRepo,
            branch,
            path: file.path,
            sha: file.sha,
            size: file.size ?? null,
          },
        };
        events.push(event);

        const kstDate = formatKstDate(changedAt);
        appendKnowledgeEntry(this.repoRoot, {
          id: `kn_${stableHash(['github-file', ownerRepo, branch, file.path, file.sha]).slice(0, 24)}`,
          source: 'github',
          object_id: objectId,
          object_type: 'github-file',
          title: `${title} (${file.path})`,
          summary,
          url: objectUrl,
          actors: ['github'],
          workspace_owner: this.config.approval?.artifact_owner_fallback ?? 'alice',
          date: kstDate,
          changed_at: changedAt,
          topics: ['onchain-analysis', file.path.split('/')[0]].filter(Boolean),
          classification: 'distill',
          status: 'indexed',
          linked_artifact: null,
          agent_reason: 'Auto-distilled from a tracked onchain-analysis knowledge file for Fisher qmd indexing.',
          relevance_score: 0.82,
          signature: activitySignature(['github', objectId, kstDate, nativeChangeId]),
          repository: ownerRepo,
          branch,
          path: file.path,
          content: fileContentForKnowledge(content, maxContentChars),
        });

        repoState.files[stateKey] = {
          fingerprint,
          sha: file.sha,
          size: file.size ?? null,
          last_polled_at: new Date().toISOString(),
        };
        processed += 1;
      }
    }
  }

  async pollOnce() {
    if (this.collectorConfig.enabled === false) {
      return { enabled: false, event_count: 0, candidate_count: 0, log_results: [] };
    }

    if (!this.ghIsAvailable()) {
      return { enabled: true, event_count: 0, candidate_count: 0, log_results: [], reason: 'gh_not_authenticated' };
    }

    const repos = this.collectRepos();
    if (repos.length === 0) {
      return { enabled: true, event_count: 0, candidate_count: 0, log_results: [], reason: 'no_repos' };
    }

    const state = this.readState();
    state.repos ??= {};
    const events = [];
    const maxPrs = Math.max(1, Number(this.collectorConfig.max_prs_per_repo ?? 20));
    const maxIssues = Math.max(1, Number(this.collectorConfig.max_issues_per_repo ?? 10));

    for (const { owner, repo, config: repoConfig = {} } of repos) {
      const ownerRepo = `${owner}/${repo}`;
      try {
        const eventTypes = repoConfig.event_types ?? this.collectorConfig.event_types ?? ['pr', 'issue'];
        const maxCommits = Math.max(1, Number(repoConfig.max_commits_per_branch ?? this.collectorConfig.max_commits_per_branch ?? 20));
        const maxFiles = Math.max(1, Number(repoConfig.max_files_per_repo ?? this.collectorConfig.max_files_per_repo ?? 200));
        if (eventTypes.includes('pr') && shouldCollectPullRequestEvents(repoConfig, this.collectorConfig)) {
          await this.trackPRs({ ownerRepo, state, events, limit: maxPrs });
        }
        if (eventTypes.includes('issue')) {
          await this.trackIssues({ ownerRepo, state, events, limit: maxIssues });
        }
        if (eventTypes.includes('commit')) {
          await this.trackCommits({ ownerRepo, repoConfig, state, events, limit: maxCommits });
        }
        if (eventTypes.includes('file')) {
          await this.trackFiles({ ownerRepo, repoConfig, state, events, limit: maxFiles });
        }
      } catch (err) {
        // Per-repo failure: log and continue (same as other collectors)
        console.error(`[github-collector] ${ownerRepo}: ${err.message}`);
      }
    }

    this.writeState(state);
    if (events.length === 0) {
      return { enabled: true, event_count: 0, candidate_count: 0, log_results: [] };
    }
    return this.ingestEvents({ repoRoot: this.repoRoot, events });
  }
}

export function startGitHubCollector({ collector, intervalSeconds, logger = console }) {
  const seconds = Math.max(60, Number(intervalSeconds ?? 600));
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await collector.pollOnce();
      logger.log?.(`[github-collector] poll complete: ${result.event_count} event(s), ${result.candidate_count} candidate(s)${result.reason ? ` (${result.reason})` : ''}`);
    } catch (error) {
      logger.error?.(`[github-collector] poll failed: ${error.message}`);
    } finally {
      inFlight = false;
    }
  };

  setInterval(() => { void tick(); }, seconds * 1000);
  return tick();
}
