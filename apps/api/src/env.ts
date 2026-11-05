import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(__dirname, "../../..")

export function loadDotenv(): void {
  try {
    const raw = readFileSync(resolve(repoRoot, ".env"), "utf8")
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      const [, key, rawValue] = m
      if (process.env[key]) continue
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "")
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
}

export const PORT = Number(process.env.HEY_API_PORT ?? process.env.SUPEREARN_API_PORT ?? 4317)
export const HOST = process.env.HEY_API_HOST ?? process.env.SUPEREARN_API_HOST ?? "127.0.0.1"
