import { describe, expect, it } from "vitest"
import {
  compareTasksBySort,
  normalizeTaskSort,
  TASK_SORT_OPTIONS,
} from "../lib/task-sort.js"
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

function sortedIds(sort: string, tasks: SerializedTask[]): string[] {
  return [...tasks]
    .sort((a, b) => compareTasksBySort(a, b, sort))
    .map((t) => t.id)
}

describe("task sorting", () => {
  const tasks = [
    task({
      id: "task_alpha",
      title: "Alpha",
      status: "blocked",
      priority: "routine",
      owner: "bob",
      iteration: "2026-W16",
      due_date: "2026-05-03",
      updated_at: "2026-04-22",
    }),
    task({
      id: "task_bravo",
      title: "Bravo",
      status: "ready",
      priority: "do",
      owner: "alice",
      iteration: "2026-W18",
      due_date: "2026-04-29",
      updated_at: "2026-04-21",
    }),
    task({
      id: "task_charlie",
      title: "Charlie",
      status: "done",
      priority: "drop",
      owner: "charlie",
      iteration: null,
      due_date: null,
      updated_at: "2026-04-23",
    }),
  ]

  it("normalizes unknown and legacy sort values", () => {
    expect(normalizeTaskSort("unknown")).toBe("priority_asc")
    expect(normalizeTaskSort("priority")).toBe("priority_asc")
  })

  it("offers sort options for visible task fields", () => {
    expect(TASK_SORT_OPTIONS.map((option) => option.value)).toEqual([
      "due_asc",
      "due_desc",
      "priority_asc",
      "priority_desc",
      "status_asc",
      "status_desc",
      "owner_asc",
      "owner_desc",
      "iteration_desc",
      "iteration_asc",
      "title_asc",
      "title_desc",
      "updated_desc",
      "updated_asc",
    ])
  })

  it("sorts due dates with undated tasks last", () => {
    expect(sortedIds("due_asc", tasks)).toEqual([
      "task_bravo",
      "task_alpha",
      "task_charlie",
    ])
    expect(sortedIds("due_desc", tasks)).toEqual([
      "task_alpha",
      "task_bravo",
      "task_charlie",
    ])
  })

  it("sorts priority in both directions", () => {
    expect(sortedIds("priority_asc", tasks)).toEqual([
      "task_bravo",
      "task_alpha",
      "task_charlie",
    ])
    expect(sortedIds("priority_desc", tasks)).toEqual([
      "task_charlie",
      "task_alpha",
      "task_bravo",
    ])
  })

  it("sorts status, owner, iteration, title, and updated fields", () => {
    expect(sortedIds("status_asc", tasks)).toEqual([
      "task_bravo",
      "task_alpha",
      "task_charlie",
    ])
    expect(sortedIds("owner_desc", tasks)).toEqual([
      "task_charlie",
      "task_alpha",
      "task_bravo",
    ])
    expect(sortedIds("iteration_desc", tasks)).toEqual([
      "task_bravo",
      "task_alpha",
      "task_charlie",
    ])
    expect(sortedIds("title_desc", tasks)).toEqual([
      "task_charlie",
      "task_bravo",
      "task_alpha",
    ])
    expect(sortedIds("updated_desc", tasks)).toEqual([
      "task_charlie",
      "task_alpha",
      "task_bravo",
    ])
  })
})
