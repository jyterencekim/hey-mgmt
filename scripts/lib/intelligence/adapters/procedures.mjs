// x_procedure_graph blocks on mgmt playbooks -> proc: nodes and procedural edges.
import { makeNode, makeEdge } from '../lib/model.mjs';
import { validateProcedureGraph } from '../lib/procedure.mjs';

/**
 * @param {object} args { playbookId (mgmt:playbook_x), owner, assertedAt, graph }
 * @returns {{ nodes, edges, errors }}
 */
export function projectProcedureGraph({ playbookId, owner, assertedAt, graph }) {
  const local = playbookId.replace(/^mgmt:playbook_/, '');
  const errors = validateProcedureGraph(graph, playbookId);
  if (errors.length) return { nodes: [], edges: [], errors };

  const pid = (id) => `proc:${local}/${id}`;
  const nodes = graph.nodes.map((n) => makeNode({
    id: pid(n.id),
    kind: n.kind ?? 'action',
    memory: 'procedural',
    title: n.title ?? n.id,
    owner,
    source: playbookId,
    meta: n.tool ? { tool: n.tool } : {},
  }));
  const by = `member:${owner ?? 'team'}`;
  const edges = graph.edges.map((e) => makeEdge({
    src: pid(e.src),
    rel: e.rel,
    dst: pid(e.dst),
    attrs: {
      ...(e.condition ? { condition: e.condition } : {}),
      guidance: e.guidance,
      ...(e.pitfalls ? { pitfalls: e.pitfalls } : {}),
    },
    asserted_by: e.asserted_by ?? by,
    asserted_at: e.asserted_at ?? assertedAt,
    evidence: Array.isArray(e.evidence) ? e.evidence : [],
    strength: e.strength ?? 'source_asserted',
    status: e.status ?? 'accepted',
    supersedes: e.supersedes ?? null,
    origin: 'procedure_graph',
  }));
  for (const n of nodes) {
    edges.push(makeEdge({
      src: playbookId, rel: 'parent_of', dst: n.id,
      asserted_by: by, asserted_at: assertedAt, origin: 'procedure_graph',
    }));
  }
  return { nodes, edges, errors: [] };
}
