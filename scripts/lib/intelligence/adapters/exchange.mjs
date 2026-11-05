// graph-exchange/v0 JSONL import: one record per line, `record: node|edge`.
// This is how other repos (auditor protocol knowledge, chain locators) feed
// the projection without sharing code.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeNode, makeEdge, normalizeRel } from '../lib/model.mjs';

export function loadExchangeDir(dir, report) {
  const nodes = [];
  const edges = [];
  if (!dir || !existsSync(dir)) return { nodes, edges };
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
    const path = join(dir, f);
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      try {
        const r = JSON.parse(line);
        if (r.record === 'node') {
          const { record, ...fields } = r;
          nodes.push(makeNode(fields));
        } else if (r.record === 'edge') {
          const { record, ...fields } = r;
          const norm = fields.rel.includes(':') ? { rel: fields.rel, unknown: false, migratedFrom: null } : normalizeRel(fields.rel);
          if (norm.unknown) report.unknownRelations.push({ id: fields.src, rel: fields.rel, target: fields.dst, file: f });
          edges.push(makeEdge({ ...fields, rel: norm.rel, origin: fields.origin ?? `exchange:${f}` }));
        } else {
          report.parseErrors.push({ path: `${f}:${i + 1}`, error: `unknown record kind ${r.record}` });
        }
      } catch (err) {
        report.parseErrors.push({ path: `${f}:${i + 1}`, error: String(err.message) });
      }
    });
  }
  return { nodes, edges };
}
