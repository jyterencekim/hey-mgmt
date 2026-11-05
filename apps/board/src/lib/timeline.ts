import { roadmapData } from "@/lib/manifest"
import type { Initiative, Task } from "@/lib/types"
import type { RoadmapProp } from "@/components/islands/GoalTimeline"

// Build the GoalTimeline island prop as plain JSON. Only the fields the island
// renders cross the boundary; hrefs are derived from ids inside the island.
function serializeTask(t: Task) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    owner: t.owner,
    due_date: t.due_date,
    component: t.component ?? null,
    start_date: t.start_date ?? null,
    target_date: t.target_date ?? null,
    created_at: t.created_at,
  }
}

function serializeInitiative(initiative: Initiative, tasks: Task[]) {
  return {
    id: initiative.id,
    title: initiative.title,
    status: initiative.status,
    priority: initiative.priority,
    owner: initiative.owner,
    timeline_start: initiative.timeline_start,
    timeline_end: initiative.timeline_end,
    initiative_kind: initiative.initiative_kind ?? null,
    prd_doc: initiative.prd_doc ?? null,
    components: initiative.components ?? [],
    kickoff_date: initiative.kickoff_date ?? null,
    baseline_tasks: initiative.baseline_tasks ?? [],
    tasks: tasks.map(serializeTask),
  }
}

export function serializedRoadmap(): RoadmapProp | null {
  const roadmap = roadmapData()
  if (!roadmap) return null
  return {
    goals: roadmap.goals.map(({ goal, detail, initiatives }) => ({
      goal: {
        id: goal.id,
        title: goal.title,
        status: goal.status,
        target_date: detail.target_date,
        metric: detail.metric,
        target: detail.target,
        current: detail.current,
      },
      initiatives: initiatives.map(({ initiative, tasks }) =>
        serializeInitiative(initiative, tasks)
      ),
    })),
    noGoal: roadmap.noGoal.map(({ initiative, tasks }) =>
      serializeInitiative(initiative, tasks)
    ),
  }
}
