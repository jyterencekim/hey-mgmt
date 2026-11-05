import { readFileSync } from 'node:fs';
import matter from 'gray-matter';
import { ARTIFACT_ID_RE } from './model.mjs';

const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
const MD_LINK_RE = /\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/g;

export function readMarkdown(path) {
  const raw = readFileSync(path, 'utf8');
  try {
    const { data, content } = matter(raw);
    return { data: data ?? {}, body: content ?? '' };
  } catch (err) {
    return { data: {}, body: raw, error: String(err.message ?? err) };
  }
}

/** Raw `[[target]]` link targets, in order, deduplicated. */
export function extractWikiLinks(body) {
  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(WIKI_LINK_RE)) {
    const t = m[1].trim();
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

/** Basenames (without .md) of markdown link hrefs, deduplicated. */
export function extractMarkdownLinkStems(body) {
  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(MD_LINK_RE)) {
    const href = m[1];
    if (/^[a-z]+:\/\//i.test(href)) continue;
    const stem = href.split('/').pop().replace(/\.md$/, '');
    if (!seen.has(stem)) { seen.add(stem); out.push(stem); }
  }
  return out;
}

export function isArtifactId(s) {
  return ARTIFACT_ID_RE.test(s);
}
