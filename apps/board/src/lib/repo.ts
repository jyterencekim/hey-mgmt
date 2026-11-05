import { isAbsolute, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))

export const repoRoot = resolve(__dirname, "../../../..")

export function toRepoAbsolutePath(path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path)
}

export function toVsCodeHref(path: string): string {
  return `vscode://file/${encodeURI(toRepoAbsolutePath(path))}`
}

export function toArtifactHref(id: string): string {
  return id.startsWith("task_") ? `/tasks/${id}/` : `/artifacts/${id}/`
}
