import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

type WatcherEvent = "add" | "change" | "unlink"
type FsWatcher = {
  on: (event: WatcherEvent, listener: (path: string) => void) => void
  add: (paths: string | string[]) => void
}
// Loose shape — vite's ModuleNode/ModuleGraph types are intentionally not
// imported here to keep this plugin decoupled from vite's exported types.
type ModuleGraph = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getModulesByFile: (file: string) => Set<any> | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invalidateModule: (mod: any) => void
}
type WebSocketServer = {
  send: (payload: { type: "full-reload"; path?: string }) => void
}
type ViteLikeServer = {
  watcher: FsWatcher
  moduleGraph: ModuleGraph
  ws: WebSocketServer
}
type VitePlugin = {
  name: string
  apply?: "serve" | "build"
  configureServer?: (server: ViteLikeServer) => void
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "../../../..")
const workspaceDir = resolve(repoRoot, "workspace")
const contentDir = resolve(repoRoot, "content")
const workspaceModuleFile = resolve(__dirname, "../lib/workspace.ts")
const iterationsModuleFile = resolve(__dirname, "../lib/iterations.ts")

function isCanonicalContentPath(p: string): boolean {
  return p.startsWith(workspaceDir) || p.startsWith(contentDir)
}

/**
 * Watch canonical content directories (workspace/, content/) that live outside
 * the Vite root. Without this, new inbox/task JSON files added by `./hey` (or
 * by the apps/api action endpoints) don't trigger module invalidation, so
 * pages with getStaticPaths keep serving 404s for items added after the dev
 * server booted.
 */
export default function contentWatcherPlugin(): VitePlugin {
  return {
    name: "board:content-watcher",
    apply: "serve",
    configureServer(server) {
      server.watcher.add([workspaceDir, contentDir])

      const invalidateCanonicalSources = () => {
        for (const file of [workspaceModuleFile, iterationsModuleFile]) {
          const mods = server.moduleGraph.getModulesByFile(file)
          if (!mods) continue
          for (const mod of mods) {
            server.moduleGraph.invalidateModule(mod)
          }
        }
        server.ws.send({ type: "full-reload", path: "*" })
      }

      const handleWatchedPath = (path: string) => {
        if (isCanonicalContentPath(path)) {
          invalidateCanonicalSources()
        }
      }

      server.watcher.on("add", handleWatchedPath)
      server.watcher.on("change", handleWatchedPath)
      server.watcher.on("unlink", handleWatchedPath)
    },
  }
}
