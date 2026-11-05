import { marked } from "marked"

// Synchronous renderer with GFM features (tables, autolinks, strikethrough).
// We deliberately leave HTML in source intact — board content is authored by
// the team, not user-supplied, so XSS isn't a concern here. If that ever
// changes, swap to DOMPurify on the output.
marked.setOptions({
  gfm: true,
  breaks: false,
})

export function renderMarkdown(md: string): string {
  if (!md || md.trim().length === 0) return ""
  // marked.parse returns sync when called without options.async; cast for ts.
  return marked.parse(md) as string
}
