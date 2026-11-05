import { describe, expect, it } from "vitest"
import {
  getTaskDueState,
  getTaskRelationSignals,
  matchesTaskPreset,
  normalizeTaskPreset,
  OPEN_TASK_STATUSES,
  TASK_PRESETS,
} from "../lib/task-views.js"
import type { SerializedTask } from "../lib/types.js"

function valueOrDefault<K extends keyof SerializedTask>(
  overrides: Partial<SerializedTask>,
  key: K,
  fallback: SerializedTask[K]
): SerializedTask[K] {
  return Object.hasOwn(overrides, key) ? overrides[key]! : fallback
}

function task(overrides: Partial<SerializedTask>): SerializedTask {
  return {
    id: valueOrDefault(overrides, "id", "task_default"),
    title: valueOrDefault(overrides, "title", "Default"),
    status: valueOrDefault(overrides, "status", "ready"),
    priority: valueOrDefault(overrides, "priority", "plan"),
    owner: valueOrDefault(overrides, "owner", "alice"),
    iteration: valueOrDefault(overrides, "iteration", "2026-W17"),
    area: valueOrDefault(overrides, "area", null),
    due_date: valueOrDefault(overrides, "due_date", null),
    updated_at: valueOrDefault(overrides, "updated_at", "2026-04-20"),
    relations_out: valueOrDefault(overrides, "relations_out", []),
    tags: valueOrDefault(overrides, "tags", []),
    path: valueOrDefault(overrides, "path", "content/tasks/task_default.md"),
    vscodeHref: valueOrDefault(
      overrides,
      "vscodeHref",
      "vscode://file/task_default.md"
    ),
  }
}

const context = {
  currentMember: "alice",
  currentIteration: "2026-W17",
  today: "2026-04-27",
}

describe("task view presets", () => {
  it("normalizes unknown preset values to open", () => {
    expect(normalizeTaskPreset(null)).toBe("open")
    expect(normalizeTaskPreset(undefined)).toBe("open")
    expect(normalizeTaskPreset("unknown")).toBe("open")
    expect(normalizeTaskPreset("mine")).toBe("mine")
  })

  it("exposes the expected open statuses and preset options", () => {
    expect([...OPEN_TASK_STATUSES]).toEqual([
      "plan",
      "ready",
      "doing",
      "blocked",
    ])
    expect(TASK_PRESETS.map((preset) => preset.value)).toEqual([
      "open",
      "all",
      "mine",
      "current_iteration",
      "overdue",
      "due_soon",
      "no_due_date",
      "no_priority",
      "unassigned_iteration",
    ])
  })

  it("matches all tasks only for the all preset", () => {
    const done = task({ status: "done" })

    expect(matchesTaskPreset(done, "all", context)).toBe(true)
    expect(matchesTaskPreset(done, "open", context)).toBe(false)
  })

  it("matches open, mine, and current iteration presets", () => {
    expect(matchesTaskPreset(task({ status: "plan" }), "open", context)).toBe(
      true
    )
    expect(matchesTaskPreset(task({ owner: "alice" }), "mine", context)).toBe(
      true
    )
    expect(matchesTaskPreset(task({ owner: "charlie" }), "mine", context)).toBe(
      false
    )
    expect(
      matchesTaskPreset(
        task({ iteration: "2026-W17" }),
        "current_iteration",
        context
      )
    ).toBe(true)
    expect(
      matchesTaskPreset(
        task({ iteration: "2026-W16" }),
        "current_iteration",
        context
      )
    ).toBe(false)
  })

  it("matches due date and missing field presets against open tasks", () => {
    expect(
      matchesTaskPreset(task({ due_date: "2026-04-26" }), "overdue", context)
    ).toBe(true)
    expect(
      matchesTaskPreset(task({ due_date: "2026-05-04" }), "due_soon", context)
    ).toBe(true)
    expect(
      matchesTaskPreset(task({ due_date: null }), "no_due_date", context)
    ).toBe(true)
    expect(
      matchesTaskPreset(task({ priority: null }), "no_priority", context)
    ).toBe(true)
    expect(
      matchesTaskPreset(
        task({ iteration: null }),
        "unassigned_iteration",
        context
      )
    ).toBe(true)
  })

  it("does not match open-only presets for closed tasks", () => {
    const closed = task({
      status: "done",
      owner: "alice",
      iteration: null,
      due_date: "2026-04-26",
      priority: null,
    })

    expect(matchesTaskPreset(closed, "mine", context)).toBe(false)
    expect(matchesTaskPreset(closed, "current_iteration", context)).toBe(false)
    expect(matchesTaskPreset(closed, "overdue", context)).toBe(false)
    expect(matchesTaskPreset(closed, "no_due_date", context)).toBe(false)
    expect(matchesTaskPreset(closed, "no_priority", context)).toBe(false)
    expect(matchesTaskPreset(closed, "unassigned_iteration", context)).toBe(
      false
    )
  })
})

describe("getTaskDueState", () => {
  it("classifies overdue, due soon, dated, and undated tasks", () => {
    expect(
      getTaskDueState(task({ due_date: "2026-04-26" }), context.today)
    ).toBe("overdue")
    expect(
      getTaskDueState(task({ due_date: "2026-04-27" }), context.today)
    ).toBe("due_soon")
    expect(
      getTaskDueState(task({ due_date: "2026-05-04" }), context.today)
    ).toBe("due_soon")
    expect(
      getTaskDueState(task({ due_date: "2026-05-05" }), context.today)
    ).toBe("dated")
    expect(getTaskDueState(task({ due_date: null }), context.today)).toBe(
      "none"
    )
  })
})

describe("getTaskRelationSignals", () => {
  it("extracts blocking and blocked-by relation targets", () => {
    const signals = getTaskRelationSignals({
      ...task({ id: "task_alpha" }),
      relations_out: [
        { type: "blocks", target: "task_bravo" },
        { type: "blocked_by", target: "task_charlie" },
        { type: "links_to", target: "note_delta" },
      ],
    })

    expect(signals).toEqual({
      blockers: ["task_bravo"],
      blockedBy: ["task_charlie"],
      hasBlockers: true,
      hasBlockedBy: true,
    })
  })

  it("returns empty signals when no relevant relations exist", () => {
    expect(getTaskRelationSignals(task({}))).toEqual({
      blockers: [],
      blockedBy: [],
      hasBlockers: false,
      hasBlockedBy: false,
    })
  })
})
