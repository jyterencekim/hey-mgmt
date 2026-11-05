import type { Task } from "./types.js";

/**
 * Get current ISO week string (e.g. "2026-W18").
 */
export function getCurrentIteration(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  // ISO week: week containing Thursday
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekNum = Math.floor((now.getTime() - startOfWeek1.getTime()) / msPerWeek) + 1;
  // Handle year boundary (week 0 = last week of prev year, week 53+ = first week of next year)
  if (weekNum < 1) {
    return getCurrentIterationForYear(year - 1);
  }
  const maxWeek = getISOWeeksInYear(year);
  if (weekNum > maxWeek) {
    return `${year + 1}-W01`;
  }
  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}

function getISOWeeksInYear(year: number): number {
  // A year has 53 ISO weeks if Jan 1 is Thursday, or if it's a leap year and Jan 1 is Wednesday
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const dec31 = new Date(Date.UTC(year, 11, 31)).getUTCDay();
  return jan1 === 4 || dec31 === 4 ? 53 : 52;
}

function getCurrentIterationForYear(year: number): string {
  const weeks = getISOWeeksInYear(year);
  return `${year}-W${String(weeks).padStart(2, "0")}`;
}

/**
 * Group tasks by iteration. Returns Map<iteration|"unassigned", Task[]>.
 * (v2/R5) Tasks with iteration: null are grouped under the key "unassigned".
 */
export function groupByIteration(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.iteration ?? "unassigned";
    const bucket = map.get(key) ?? [];
    bucket.push(task);
    map.set(key, bucket);
  }
  // Sort: descending by iteration key (unassigned goes last)
  const sorted = new Map<string, Task[]>();
  const keys = [...map.keys()].sort((a, b) => {
    if (a === "unassigned") return 1;
    if (b === "unassigned") return -1;
    return b.localeCompare(a);
  });
  for (const k of keys) {
    sorted.set(k, map.get(k)!);
  }
  return sorted;
}

/**
 * List all unique non-null iterations from tasks, sorted descending.
 * (v2/R5) Does NOT include "unassigned" — null-iteration tasks excluded from getStaticPaths.
 */
export function listIterations(tasks: Task[]): string[] {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (task.iteration !== null && task.iteration !== undefined) {
      seen.add(task.iteration);
    }
  }
  return [...seen].sort((a, b) => b.localeCompare(a));
}

/**
 * (v2/R5) Count tasks with null iteration.
 */
export function countUnassignedTasks(tasks: Task[]): number {
  return tasks.filter((t) => t.iteration === null || t.iteration === undefined).length;
}
