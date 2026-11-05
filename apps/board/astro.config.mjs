// @ts-check

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"
import react from "@astrojs/react"
import contentWatcherPlugin from "./src/vite/contentWatcher.ts"

// Load the repo-root .env so server modules see MEMBER/LANGUAGE the same way
// `./hey` does. Without this, getCurrentMember() throws and the board fails
// to boot even when .env is correctly configured.
const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..")
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
  if (/** @type {NodeJS.ErrnoException} */ (err).code !== "ENOENT") throw err
}

const API_TARGET =
  process.env.hey-mgmt_API_URL ?? "http://127.0.0.1:4317"

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss(), contentWatcherPlugin()],
    // Proxy /api/* and /terminal/* to the local apps/api service
    // (Hono + raw http proxy on 4317 by default). Same-origin from the
    // browser's perspective, no CORS dance required. ws: true on /terminal
    // is required so the xterm.js websocket survives the proxy hop.
    server: {
      proxy: {
        "/api": {
          target: API_TARGET,
          changeOrigin: false,
        },
        "/search": {
          target: API_TARGET,
          changeOrigin: false,
        },
        "/pulse-stream": {
          target: API_TARGET,
          changeOrigin: false,
        },
        "/terminal": {
          target: API_TARGET,
          changeOrigin: false,
          ws: true,
        },
      },
    },
    // Pre-bundle deps used by the React islands. Without this, Vite only
    // discovers them lazily on first page load, and after a server restart
    // they can vanish from the optimizer cache while already-transformed
    // modules still reference their stale `?v=…` hashes. Visible symptom:
    // 504 "Outdated Optimize Dep" on /node_modules/.vite/deps/{radix-ui,
    // clsx,…}.js, hydration of InboxActions silently fails, the Ack /
    // Discard / Promote buttons render but their onClick handlers never
    // attach — so clicking them does nothing.
    optimizeDeps: {
      include: [
        "clsx",
        "tailwind-merge",
        "class-variance-authority",
        "radix-ui",
      ],
    },
  },
  integrations: [react()],
})
