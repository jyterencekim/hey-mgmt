import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { loadAll } from "@/lib/manifest"
import { repoRoot, toArtifactHref } from "@/lib/repo"
import themeCss from "@/lib/weekly-theme.css?raw"
import geistUrl from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url"
import geistMonoUrl from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url"

// Weekly progress editions written by /weekly-report into
// workspace/<member>/weekly-progress-YYYY-MM-DD[-external|-preview].html.
// The board shows them as-is: each file is a dated snapshot, never re-rendered.

export type WeeklyVariant = "internal" | "external" | "preview"

export interface WeeklyEdition {
  slug: string // "<member>-<date>[-<variant>]", unique across members
  member: string
  date: string // YYYY-MM-DD
  variant: WeeklyVariant
  path: string // absolute
}

const FILE_RE = /^weekly-progress-(\d{4}-\d{2}-\d{2})(?:-(external|preview))?\.html$/
const VARIANT_ORDER: Record<WeeklyVariant, number> = { internal: 0, external: 1, preview: 2 }

export function listWeeklyEditions(): WeeklyEdition[] {
  const workspace = join(repoRoot, "workspace")
  const out: WeeklyEdition[] = []
  for (const member of readdirSync(workspace)) {
    const dir = join(workspace, member)
    if (!statSync(dir).isDirectory()) continue
    for (const file of readdirSync(dir)) {
      const m = FILE_RE.exec(file)
      if (!m) continue
      const variant = (m[2] as WeeklyVariant | undefined) ?? "internal"
      out.push({
        slug: `${member}-${m[1]}${variant === "internal" ? "" : `-${variant}`}`,
        member,
        date: m[1],
        variant,
        path: join(dir, file),
      })
    }
  }
  return out.sort((a, b) =>
    a.date === b.date ? VARIANT_ORDER[a.variant] - VARIANT_ORDER[b.variant] : a.date < b.date ? 1 : -1
  )
}

/** The edition the Weekly tab opens on: the newest non-preview one. */
export function latestWeeklyEdition(editions = listWeeklyEditions()): WeeklyEdition | null {
  return editions.find((e) => e.variant === "internal") ?? editions[0] ?? null
}

// Skips chips already linked, e.g. in a copy saved from the Weekly tab.
const ID_CHIP_RE = /(?<!text-decoration:none">)<code>((?:task|initiative|decision|note|goal|meeting|playbook)_[a-z0-9-]+)<\/code>/g

// Board fonts, theme tokens and the light/dark choice the board stores in
// localStorage (same origin as the iframe, so a toggle reaches it as a
// storage event).
const BOARD_HEAD = `
<style data-board-theme>
@font-face { font-family: "Geist Variable"; font-weight: 100 900; font-display: swap; src: url("${geistUrl}") format("woff2-variations"); }
@font-face { font-family: "Geist Mono Variable"; font-weight: 100 900; font-display: swap; src: url("${geistMonoUrl}") format("woff2-variations"); }
${themeCss}
</style>
<script>
(function () {
  function apply() {
    var t = null
    try { t = localStorage.getItem("hey-theme") } catch (_) {}
    document.documentElement.classList.toggle("dark", t !== "light")
  }
  apply()
  window.addEventListener("storage", function (e) { if (e.key === "hey-theme") apply() })
})()
</script>
`

// The edition's HTML in the board's look, with every known artifact id chip
// turned into a link to its board page. Links target the top window because
// the edition renders in an iframe inside the board layout.
export function readWeeklyHtml(edition: WeeklyEdition): string {
  const known = new Set(loadAll().map((a) => a.id))
  const html = readFileSync(edition.path, "utf8").replace(ID_CHIP_RE, (chip, id: string) =>
    known.has(id)
      ? `<a href="${toArtifactHref(id)}" target="_top" style="text-decoration:none">${chip}</a>`
      : chip
  )
  if (html.includes("data-board-theme")) return html
  return html.includes("</head>") ? html.replace("</head>", `${BOARD_HEAD}</head>`) : BOARD_HEAD + html
}
