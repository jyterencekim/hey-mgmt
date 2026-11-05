import { loadTasks, taskInitiatives } from "@/lib/manifest";
import { toSerializedTask } from "@/lib/workspace";

export async function GET() {
  const tasks = loadTasks();
  const initiativeOf = taskInitiatives();
  const serialized = tasks.map((t) => ({
    ...toSerializedTask(t),
    initiative: initiativeOf.get(t.id) ?? null,
  }));
  return new Response(JSON.stringify(serialized), {
    headers: { "Content-Type": "application/json" },
  });
}
