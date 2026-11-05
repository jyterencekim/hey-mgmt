import { describe, it, expect } from "vitest";
import {
  getCurrentIteration,
  groupByIteration,
  listIterations,
  countUnassignedTasks,
} from "../lib/iterations.js";
import { loadTasks } from "../lib/manifest.js";

describe("getCurrentIteration", () => {
  it("returns a string matching ISO week format (YYYY-Www)", () => {
    const result = getCurrentIteration();
    expect(result).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("returns a valid week number between W01 and W53", () => {
    const result = getCurrentIteration();
    const week = Number(result.split("-W")[1]);
    expect(week).toBeGreaterThanOrEqual(1);
    expect(week).toBeLessThanOrEqual(53);
  });
});

describe("listIterations (v2/R5)", () => {
  const tasks = loadTasks();

  it("returns an array of ISO week strings", () => {
    const iters = listIterations(tasks);
    for (const iter of iters) {
      expect(iter).toMatch(/^\d{4}-W\d{2}$/);
    }
  });

  it("does NOT include 'unassigned'", () => {
    const iters = listIterations(tasks);
    expect(iters).not.toContain("unassigned");
  });

  it("does NOT include null values", () => {
    const iters = listIterations(tasks);
    expect(iters.includes(null as unknown as string)).toBe(false);
  });

  it("is sorted descending", () => {
    const iters = listIterations(tasks);
    const sorted = [...iters].sort((a, b) => b.localeCompare(a));
    expect(iters).toEqual(sorted);
  });

  it("returns unique values", () => {
    const iters = listIterations(tasks);
    const unique = new Set(iters);
    expect(iters.length).toBe(unique.size);
  });
});

describe("countUnassignedTasks (v2/R5)", () => {
  const tasks = loadTasks();

  it("returns a non-negative number", () => {
    const count = countUnassignedTasks(tasks);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("matches count of null-iteration tasks in current manifest", () => {
    const count = countUnassignedTasks(tasks);
    const expected = tasks.filter((t) => !t.iteration).length;
    expect(count).toBe(expected);
  });

  it("sums to total task count when added to assigned tasks", () => {
    const unassigned = countUnassignedTasks(tasks);
    const assigned = tasks.filter((t) => t.iteration !== null && t.iteration !== undefined).length;
    expect(unassigned + assigned).toBe(tasks.length);
  });
});

describe("groupByIteration (v2/R5)", () => {
  const tasks = loadTasks();

  it("groups null-iteration tasks under 'unassigned'", () => {
    const groups = groupByIteration(tasks);
    const unassignedCount = countUnassignedTasks(tasks);
    if (unassignedCount > 0) {
      expect(groups.has("unassigned")).toBe(true);
      expect(groups.get("unassigned")!.length).toBe(unassignedCount);
    }
  });

  it("all tasks are represented across groups", () => {
    const groups = groupByIteration(tasks);
    const total = [...groups.values()].reduce((sum, arr) => sum + arr.length, 0);
    expect(total).toBe(tasks.length);
  });

  it("'unassigned' appears last in iteration order", () => {
    const groups = groupByIteration(tasks);
    const keys = [...groups.keys()];
    if (keys.includes("unassigned")) {
      expect(keys[keys.length - 1]).toBe("unassigned");
    }
  });
});
