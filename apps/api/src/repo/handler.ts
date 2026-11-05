import type { Context } from "hono"
import { isKnownAction, runAction } from "./actions.js"

export async function handleRepoAction(c: Context, action: string) {
  if (!isKnownAction(action)) {
    return c.json({ error: `Unknown action: ${action}` }, 404)
  }
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON" }, 400)
  }
  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Body must be a JSON object" }, 400)
  }
  const result = await runAction(action, body as Record<string, unknown>)
  if (result.ok) {
    return c.json({ ok: true, stdout: result.stdout, git: result.git })
  }
  return c.json({ ok: false, error: result.error }, 400)
}
