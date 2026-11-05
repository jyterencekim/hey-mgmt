import type { APIRoute, GetStaticPaths } from "astro"
import { listWeeklyEditions, readWeeklyHtml, type WeeklyEdition } from "@/lib/weekly"

// The edition file itself, served same-origin for the Weekly tab's iframe.
export const getStaticPaths: GetStaticPaths = () =>
  listWeeklyEditions().map((edition) => ({ params: { slug: edition.slug }, props: { edition } }))

export const GET: APIRoute = ({ props }) =>
  new Response(readWeeklyHtml((props as { edition: WeeklyEdition }).edition), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
