import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { repoRoot } from "../env.js"

const execFileAsync = promisify(execFile)

export type GitSyncResult = {
  committed: boolean
  pushed: boolean
  commit?: string
  skipped?: string
  warnings?: string[]
}

function parsePorcelainPaths(raw: string): Set<string> {
  const paths = new Set<string>()
  const entries = raw.split("\0").filter(Boolean)

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    if (entry.length < 4) continue
    const status = entry.slice(0, 2)
    const path = entry.slice(3)
    if (path) paths.add(path)
    if (status.includes("R") || status.includes("C")) {
      const nextPath = entries[i + 1]
      if (nextPath) paths.add(nextPath)
      i += 1
    }
  }

  return paths
}

export async function getCanonicalDirtyPaths(): Promise<Set<string>> {
  const { stdout } = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "-z", "--", "content", "workspace"],
    {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    }
  )
  return parsePorcelainPaths(stdout)
}

function actionCommitSubject(
  key: string,
  params: Record<string, unknown>
): string {
  const target =
    typeof params.task === "string"
      ? params.task
      : typeof params.item === "string"
        ? params.item
        : typeof params.workspace === "string"
          ? params.workspace
          : "board"
  return `Board action ${key} ${target}`.slice(0, 72)
}

async function commitAndPushActionChanges(
  key: string,
  params: Record<string, unknown>,
  before: Set<string>
): Promise<GitSyncResult> {
  const after = await getCanonicalDirtyPaths()
  const candidates = [...after].filter((path) => !before.has(path))
  const preExisting = [...after].filter((path) => before.has(path))
  const warnings =
    preExisting.length > 0
      ? [
          `Skipped pre-existing dirty canonical paths: ${preExisting.join(", ")}`,
        ]
      : []

  if (candidates.length === 0) {
    return {
      committed: false,
      pushed: false,
      skipped: "No new canonical content/workspace changes detected",
      warnings,
    }
  }

  try {
    await execFileAsync("./hey", ["validate"], {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string }
    return {
      committed: false,
      pushed: false,
      skipped: "Validation failed; action changes were left uncommitted",
      warnings: [
        ...warnings,
        (
          e.stderr ||
          e.stdout ||
          e.message ||
          "Unknown validation error"
        ).trim(),
      ],
    }
  }

  await execFileAsync("git", ["add", "--", ...candidates], {
    cwd: repoRoot,
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  })

  const { stdout: staged } = await execFileAsync(
    "git",
    ["diff", "--cached", "--name-only", "--", ...candidates],
    {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    }
  )
  if (!staged.trim()) {
    return {
      committed: false,
      pushed: false,
      skipped: "No staged canonical changes after action",
      warnings,
    }
  }

  await execFileAsync(
    "git",
    ["commit", "-m", actionCommitSubject(key, params)],
    {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    }
  )
  const { stdout: commit } = await execFileAsync(
    "git",
    ["rev-parse", "--short", "HEAD"],
    {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    }
  )

  try {
    const { stdout: branch } = await execFileAsync(
      "git",
      ["branch", "--show-current"],
      {
        cwd: repoRoot,
        env: process.env,
        maxBuffer: 8 * 1024 * 1024,
      }
    )
    const currentBranch = branch.trim()
    if (!currentBranch) {
      return {
        committed: true,
        pushed: false,
        commit: commit.trim(),
        warnings: [
          ...warnings,
          "Commit created but push skipped: detached HEAD",
        ],
      }
    }
    await execFileAsync(
      "git",
      ["pull", "--rebase", "--autostash", "origin", currentBranch],
      {
        cwd: repoRoot,
        env: process.env,
        maxBuffer: 8 * 1024 * 1024,
      }
    )
    await execFileAsync("git", ["push", "origin", currentBranch], {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    })
    return {
      committed: true,
      pushed: true,
      commit: commit.trim(),
      warnings,
    }
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string }
    return {
      committed: true,
      pushed: false,
      commit: commit.trim(),
      warnings: [
        ...warnings,
        `Commit created but push failed: ${(e.stderr || e.stdout || e.message || "Unknown git error").trim()}`,
      ],
    }
  }
}

let gitSyncQueue: Promise<void> = Promise.resolve()

export function queueActionGitSync(
  key: string,
  params: Record<string, unknown>,
  before: Set<string>
): GitSyncResult {
  gitSyncQueue = gitSyncQueue
    .then(() => commitAndPushActionChanges(key, params, before))
    .then((result) => {
      console.info("[hey-api] git sync finished", result)
    })
    .catch((err: unknown) => {
      console.error("[hey-api] git sync failed", err)
    })

  return {
    committed: false,
    pushed: false,
    skipped: "Git sync queued",
  }
}
