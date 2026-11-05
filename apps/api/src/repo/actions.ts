import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { repoRoot } from "../env.js"
import {
  getCanonicalDirtyPaths,
  queueActionGitSync,
  type GitSyncResult,
} from "./git.js"

const execFileAsync = promisify(execFile)

type FlagSpec = {
  param: string
  flag: string
  required?: boolean
}

type ActionSpec = {
  argv: string[]
  flags: FlagSpec[]
  rebuildIndex: boolean
  commitChanges: boolean
}

const ACTIONS: Record<string, ActionSpec> = {
  "inbox/ack": {
    argv: ["inbox", "ack"],
    flags: [
      { param: "workspace", flag: "--workspace", required: true },
      { param: "item", flag: "--item", required: true },
      { param: "note", flag: "--note" },
    ],
    rebuildIndex: false,
    commitChanges: true,
  },
  "inbox/discard": {
    argv: ["inbox", "discard"],
    flags: [
      { param: "workspace", flag: "--workspace", required: true },
      { param: "item", flag: "--item", required: true },
      { param: "reason", flag: "--reason" },
    ],
    rebuildIndex: false,
    commitChanges: true,
  },
  "inbox/promote": {
    argv: ["inbox", "promote"],
    flags: [
      { param: "workspace", flag: "--workspace", required: true },
      { param: "item", flag: "--item", required: true },
      { param: "type", flag: "--type", required: true },
      { param: "title", flag: "--title" },
    ],
    rebuildIndex: true,
    commitChanges: true,
  },
  "inbox/reply": {
    argv: ["inbox", "reply"],
    flags: [
      { param: "workspace", flag: "--workspace", required: true },
      { param: "item", flag: "--item", required: true },
      { param: "body", flag: "--body", required: true },
      { param: "title", flag: "--title" },
    ],
    rebuildIndex: false,
    commitChanges: true,
  },
  "task/ack": {
    argv: ["task", "ack"],
    flags: [
      { param: "task", flag: "--task", required: true },
      { param: "by", flag: "--by" },
      { param: "note", flag: "--note" },
    ],
    rebuildIndex: true,
    commitChanges: true,
  },
  "task/complete": {
    argv: ["work", "complete"],
    flags: [
      { param: "task", flag: "--task", required: true },
      { param: "summary", flag: "--summary" },
    ],
    rebuildIndex: true,
    commitChanges: true,
  },
  "task/claim": {
    argv: ["task", "claim"],
    flags: [
      { param: "task", flag: "--task", required: true },
      { param: "by", flag: "--by" },
      { param: "note", flag: "--note" },
    ],
    rebuildIndex: true,
    commitChanges: true,
  },
  "task/status": {
    argv: ["task", "status"],
    flags: [
      { param: "task", flag: "--task", required: true },
      { param: "status", flag: "--to", required: true },
      { param: "by", flag: "--by" },
      { param: "note", flag: "--note" },
    ],
    rebuildIndex: true,
    commitChanges: true,
  },
  "task/fail": {
    argv: ["work", "fail"],
    flags: [
      { param: "task", flag: "--task", required: true },
      { param: "reason", flag: "--reason", required: true },
    ],
    rebuildIndex: true,
    commitChanges: true,
  },
}

export type ActionKey = keyof typeof ACTIONS

export function isKnownAction(key: string): key is ActionKey {
  return Object.prototype.hasOwnProperty.call(ACTIONS, key)
}

function formatCommandError(err: {
  stderr?: string
  stdout?: string
  message?: string
}): string {
  const raw = (err.stderr || err.stdout || err.message || "Unknown error").trim()
  if (!raw) return "Unknown error"

  try {
    const parsed = JSON.parse(raw) as { error?: unknown }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim()
    }
  } catch {
    // Fall through to the raw command output.
  }

  return raw
}

export async function runAction(
  key: ActionKey,
  params: Record<string, unknown>
): Promise<
  | { ok: true; stdout: string; git?: GitSyncResult }
  | { ok: false; error: string }
> {
  const spec = ACTIONS[key]
  const args: string[] = [...spec.argv]

  for (const flag of spec.flags) {
    const raw = params[flag.param]
    if (raw === undefined || raw === null || raw === "") {
      if (flag.required) {
        return { ok: false, error: `Missing required field: ${flag.param}` }
      }
      continue
    }
    if (typeof raw !== "string") {
      return { ok: false, error: `Invalid type for field: ${flag.param}` }
    }
    args.push(flag.flag, raw)
  }

  try {
    const before = spec.commitChanges
      ? await getCanonicalDirtyPaths()
      : new Set<string>()
    const { stdout } = await execFileAsync("./hey", args, {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    })
    if (spec.rebuildIndex) {
      await execFileAsync("./hey", ["index", "build"], {
        cwd: repoRoot,
        env: process.env,
        maxBuffer: 8 * 1024 * 1024,
      }).catch(() => undefined)
    }
    const git = spec.commitChanges
      ? queueActionGitSync(key, params, before)
      : undefined
    return { ok: true, stdout, ...(git ? { git } : {}) }
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string }
    return {
      ok: false,
      error: formatCommandError(e),
    }
  }
}
