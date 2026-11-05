import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, relative, sep, dirname, join } from 'node:path';
import matter from 'gray-matter';

const WIKI_LINK_ID_RE = /\[\[((task|decision|meeting|playbook|note|initiative|goal)_[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?)\]\]/gi;
const MARKDOWN_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const ID_IN_TEXT_RE = /((task|decision|meeting|playbook|note|initiative|goal)_[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?)/;

function normalizePath(p) {
  return p.split(sep).join('/');
}

function normalizeParsedValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeParsedValue(entry));
  }

  if (value && typeof value === 'object') {
    const obj = {};
    for (const [key, entry] of Object.entries(value)) {
      obj[key] = normalizeParsedValue(entry);
    }
    return obj;
  }

  return value;
}

function stableSortValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => stableSortValue(entry));
  }

  if (value && typeof value === 'object') {
    const obj = {};
    for (const key of Object.keys(value).sort()) {
      obj[key] = stableSortValue(value[key]);
    }
    return obj;
  }

  return value;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function walkMarkdownFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'memory') continue;
      files.push(...walkMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function extractLinksOut(body, relationsOut) {
  const ids = new Set((relationsOut ?? []).map((relation) => relation.target));

  for (const match of body.matchAll(WIKI_LINK_ID_RE)) {
    ids.add(match[1]);
  }

  for (const match of body.matchAll(MARKDOWN_LINK_RE)) {
    const href = match[1];
    const idMatch = href.match(ID_IN_TEXT_RE);
    if (idMatch) {
      ids.add(idMatch[1]);
    }
  }

  return [...ids].sort();
}

export function parseArtifact(filePath, contentRoot) {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = matter(raw);

  const frontmatter = normalizeParsedValue(parsed.data ?? {});
  const id = String(frontmatter.id ?? '').trim();
  const type = String(frontmatter.type ?? '').trim();
  const title = String(frontmatter.title ?? '').trim() || id;

  const relationsOut = Array.isArray(frontmatter.relations)
    ? frontmatter.relations
        .map((entry) => {
          if (typeof entry === 'string') {
            return { type: 'links_to', target: entry.trim() };
          }
          if (entry && typeof entry === 'object') {
            return {
              type: String(entry.type ?? '').trim(),
              target: String(entry.target ?? '').trim()
            };
          }
          return null;
        })
        .filter((relation) => relation && relation.type && relation.target)
    : [];

  const body = String(parsed.content ?? '').trim();
  const linksOut = extractLinksOut(body, relationsOut);
  const relativePath = normalizePath(relative(contentRoot, filePath));

  const metaStable = JSON.stringify(stableSortValue(frontmatter));
  const bodyStable = body;

  return {
    id,
    type,
    title,
    filePath,
    relativePath,
    body,
    frontmatter,
    relationsOut,
    linksOut,
    hashes: {
      meta_hash: sha256(metaStable),
      body_hash: sha256(bodyStable),
      content_hash: sha256(`${metaStable}\n${bodyStable}`)
    }
  };
}

export function readArtifacts(contentRoot) {
  const { artifacts, errors } = readArtifactsWithErrors(contentRoot);
  if (errors.length > 0) {
    throw new Error(errors[0].message);
  }
  return artifacts;
}

export function readArtifactsWithErrors(contentRoot) {
  const root = resolve(contentRoot);
  if (!statSync(root).isDirectory()) {
    throw new Error(`Content root is not a directory: ${contentRoot}`);
  }

  const artifacts = [];
  const errors = [];

  for (const path of walkMarkdownFiles(root)) {
    try {
      artifacts.push(parseArtifact(path, root));
    } catch (error) {
      errors.push({
        path: normalizePath(relative(root, path)),
        message: `invalid markdown frontmatter: ${error.message}`
      });
    }
  }

  return { artifacts, errors };
}

export function writeArtifact(filePath, frontmatter, body) {
  const content = matter.stringify(body, frontmatter);
  const tmpPath = join(dirname(filePath), `.${Date.now()}.tmp`);
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, filePath);
}
