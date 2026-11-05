import { spawnSync } from 'node:child_process';
import { validateRepository } from '../indexer.mjs';

function runGit(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  }
  return result.stdout.trim();
}

function hasMeetingSyncChanges(repoRoot, notificationPaths) {
  const result = spawnSync('git', ['status', '--short', '--', 'content', ...notificationPaths], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'git status failed').trim());
  }
  return Boolean(result.stdout.trim());
}

export function prepareMeetingGitSync({ repoRoot }) {
  runGit(repoRoot, ['pull', '--rebase', '--autostash']);
}

export function finalizeMeetingGitSync({ repoRoot, commitLabel, notificationPaths = [] }) {
  const validation = validateRepository(repoRoot);
  if (!validation.report.ok) {
    throw new Error(`Validation failed: ${validation.report.issues.map((issue) => issue.message).join('; ')}`);
  }

  if (!hasMeetingSyncChanges(repoRoot, notificationPaths)) {
    return { changed: false, committed: false, pushed: false };
  }

  runGit(repoRoot, ['add', 'content', ...notificationPaths]);
  runGit(repoRoot, ['commit', '-m', commitLabel]);
  runGit(repoRoot, ['push']);
  return { changed: true, committed: true, pushed: true };
}

export function runMeetingGitSync({ repoRoot, commitLabel }) {
  prepareMeetingGitSync({ repoRoot });
  return finalizeMeetingGitSync({ repoRoot, commitLabel });
}
