import { describe, it, expect } from "vitest"
import {
  listMembers,
  listCoreTeam,
  loadInboxFor,
  loadAllInbox,
  countOpenInbox,
  toSerializedTask,
} from "../lib/workspace.js"
import { loadTasks } from "../lib/manifest.js"

describe("listMembers (v2/R1)", () => {
  it("returns the starter workspace members sorted", () => {
    const members = listMembers()
    expect(members).toEqual(["alice", "bob", "fisher"])
  })

  it("listCoreTeam excludes non-human fisher workspace", () => {
    expect(listCoreTeam("alice")).toEqual(["alice", "bob"])
  })

  it("excludes dotfiles and non-directories (.DS_Store etc.)", () => {
    const members = listMembers()
    for (const m of members) {
      expect(m.startsWith(".")).toBe(false)
    }
  })

  it("returns a non-empty sorted array", () => {
    const members = listMembers()
    expect(members.length).toBeGreaterThan(0)
    const sorted = [...members].sort()
    expect(members).toEqual(sorted)
  })
})

describe("loadInboxFor (v2/R2)", () => {
  it("returns [] for alice and bob when inbox is empty", () => {
    expect(loadInboxFor("alice")).toEqual([])
    expect(loadInboxFor("bob")).toEqual([])
  })

  it("returns [] for non-existent member", () => {
    expect(loadInboxFor("nonexistent_member_xyz")).toEqual([])
  })
})

describe("loadAllInbox (v2/R2)", () => {
  it("completes without throwing across all members", () => {
    expect(() => loadAllInbox()).not.toThrow()
  })

  it("returns a Map with entries for all members", () => {
    const result = loadAllInbox()
    const members = listMembers()
    for (const m of members) {
      expect(result.has(m)).toBe(true)
    }
  })
})

describe("countOpenInbox", () => {
  it("returns 0 for empty starter workspaces", () => {
    const counts = countOpenInbox()
    expect(counts.get("alice")).toBe(0)
    expect(counts.get("bob")).toBe(0)
  })
})

describe("toSerializedTask (v3/C1)", () => {
  const tasks = loadTasks()

  it("preserves id", () => {
    for (const task of tasks.slice(0, 5)) {
      expect(toSerializedTask(task).id).toBe(task.id)
    }
  })

  it("does NOT include excluded fields", () => {
    const excluded = [
      "sources",
      "hashes",
      "feedback",
      "unresolved_entities",
      "entities",
      "links_out",
      "body",
      "created_at",
      "author",
      "type",
    ]
    for (const task of tasks.slice(0, 5)) {
      const serialized = toSerializedTask(task) as Record<string, unknown>
      for (const field of excluded) {
        expect(serialized).not.toHaveProperty(field)
      }
    }
  })

  it("includes only the allowed fields", () => {
    const allowed = new Set([
      "id",
      "title",
      "status",
      "priority",
      "owner",
      "iteration",
      "area",
      "due_date",
      "updated_at",
      "tags",
      "path",
      "vscodeHref",
      "relations_out",
    ])
    for (const task of tasks.slice(0, 10)) {
      const serialized = toSerializedTask(task)
      for (const key of Object.keys(serialized)) {
        expect(allowed.has(key)).toBe(true)
      }
    }
  })

  it("adds an absolute VS Code deep link", () => {
    for (const task of tasks.slice(0, 5)) {
      const serialized = toSerializedTask(task)
      expect(serialized.vscodeHref).toContain("vscode://file/")
      expect(serialized.vscodeHref).toContain(task.path)
    }
  })

  it("calibration: logs serialized JSON size for all tasks", () => {
    const allSerialized = tasks.map(toSerializedTask)
    const size = JSON.stringify(allSerialized).length
    console.log(
      `[calibration] serialized tasks JSON size: ${size} bytes (${(size / 1024).toFixed(1)} KB)`
    )
    expect(typeof size).toBe("number")
  })
})
