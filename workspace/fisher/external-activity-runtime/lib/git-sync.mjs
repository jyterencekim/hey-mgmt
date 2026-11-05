import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

let _lock = Promise.resolve();

/**
 * Serialise all git operations so concurrent collectors / approval actions
 * never race against each other.
 */
export function withGitLock(fn) {
  const next = _lock.then(fn, fn);
  _lock = next.catch(() => {});
  return next;
}

function git(repoRoot, args, { ignoreError = false, timeout = 60_000 } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout,
    }).trim();
  } catch (error) {
    if (ignoreError) return (error.stdout ?? '').trim();
    throw error;
  }
}

function resolveConflictsKeepBoth(repoRoot) {
  const raw = git(repoRoot, ['diff', '--name-only', '--diff-filter=U'], { ignoreError: true });
  const files = raw.split('\n').filter(Boolean);
  if (files.length === 0) return false;

  for (const file of files) {
    const filePath = resolve(repoRoot, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      const resolved = content
        .replace(/^<<<<<<< [^\n]*\n/gm, '')
        .replace(/^=======\n/gm, '')
        .replace(/^>>>>>>> [^\n]*\n/gm, '');
      writeFileSync(filePath, resolved, 'utf8');
      git(repoRoot, ['add', file]);
    } catch {
      // If we can't resolve a file, accept theirs so we never block the loop
      git(repoRoot, ['checkout', '--theirs', file], { ignoreError: true });
      git(repoRoot, ['add', file]);
    }
  }
  return true;
}

export async function gitPull(repoRoot, logger = console) {
  try {
    git(repoRoot, ['fetch', '--prune'], { timeout: 30_000 });
  } catch (err) {
    logger.error?.(`[git-sync] fetch failed: ${err.message}`);
    return false;
  }

  // Fast-forward when possible
  try {
    git(repoRoot, ['merge', '--ff-only', 'origin/main']);
    logger.log?.('[git-sync] pulled latest (fast-forward)');
    return true;
  } catch { /* not fast-forwardable */ }

  // Try rebase
  try {
    git(repoRoot, ['pull', '--rebase', 'origin', 'main']);
    logger.log?.('[git-sync] pulled latest (rebase)');
    return true;
  } catch {
    git(repoRoot, ['rebase', '--abort'], { ignoreError: true });
  }

  // Fall back to merge, resolve conflicts keeping both sides
  try {
    git(repoRoot, ['merge', 'origin/main', '--no-edit']);
    logger.log?.('[git-sync] pulled latest (merge)');
    return true;
  } catch {
    if (resolveConflictsKeepBoth(repoRoot)) {
      git(repoRoot, ['commit', '--no-edit'], { ignoreError: true });
      logger.log?.('[git-sync] pulled latest — conflicts auto-resolved (kept both sides)');
      return true;
    }
    git(repoRoot, ['merge', '--abort'], { ignoreError: true });
    logger.error?.('[git-sync] pull failed, continuing with local state');
    return false;
  }
}

export function gitCommitAndPush(repoRoot, message, logger = console) {
  // Stage content & workspace changes (the tracked dirs the connector modifies)
  git(repoRoot, ['add', 'content/', 'workspace/'], { ignoreError: true });

  const staged = git(repoRoot, ['diff', '--cached', '--name-only'], { ignoreError: true });
  if (!staged) {
    logger.log?.('[git-sync] no changes to commit');
    return false;
  }

  git(repoRoot, ['commit', '-m', message]);
  logger.log?.(`[git-sync] committed: ${message}`);

  // Rebase on remote before push
  try {
    git(repoRoot, ['fetch', '--prune'], { timeout: 30_000 });
  } catch { /* offline is okay, push will fail below */ }

  try {
    git(repoRoot, ['rebase', 'origin/main']);
  } catch {
    git(repoRoot, ['rebase', '--abort'], { ignoreError: true });
    try {
      git(repoRoot, ['merge', 'origin/main', '--no-edit']);
    } catch {
      if (resolveConflictsKeepBoth(repoRoot)) {
        git(repoRoot, ['commit', '--no-edit'], { ignoreError: true });
        logger.log?.('[git-sync] pre-push conflict auto-resolved (kept both sides)');
      } else {
        git(repoRoot, ['merge', '--abort'], { ignoreError: true });
      }
    }
  }

  try {
    git(repoRoot, ['push', 'origin', 'main'], { timeout: 30_000 });
    logger.log?.('[git-sync] pushed to remote');
  } catch (err) {
    logger.error?.(`[git-sync] push failed: ${err.message}`);
  }
  return true;
}

/**
 * Wrap an async operation with pull-before + commit-and-push-after.
 * Returns the operation's result. If the operation produces no tracked file
 * changes, nothing is committed.
 */
export async function withGitSync(repoRoot, label, fn, logger = console) {
  return withGitLock(async () => {
    await gitPull(repoRoot, logger);
    const result = await fn();
    gitCommitAndPush(repoRoot, `activity: ${label}`, logger);
    return result;
  });
}

export async function withGitBatch(repoRoot, label, fn, logger = console) {
  return withGitLock(async () => {
    await gitPull(repoRoot, logger);
    const result = await fn();
    gitCommitAndPush(repoRoot, `activity: ${label}`, logger);
    return result;
  });
}
