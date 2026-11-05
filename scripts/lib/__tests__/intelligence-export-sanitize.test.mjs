import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { isNodePermitted, sanitizeGraph, exportFromDb } from '../intelligence/lib/sanitize.mjs';

describe('intelligence export and sanitization', () => {
  const sampleNodes = [
    {
      id: 'mgmt:decision_adr-goal-as-seventh-type',
      ns: 'mgmt',
      kind: 'decision',
      memory: 'semantic',
      title: 'Goal as Seventh Type',
      source: 'content/decisions/decision_adr-goal-as-seventh-type.md',
      tags: ['Engineering'],
    },
    {
      id: 'mgmt:meeting_2026-09-10-internal-sync',
      ns: 'mgmt',
      kind: 'meeting',
      memory: 'episodic',
      title: 'Internal Sync',
      source: 'content/meetings/2026/09/meeting_2026-09-10-internal-sync.md',
      tags: ['Internal'],
    },
    {
      id: 'mgmt:task_workspace-personal-notes',
      ns: 'mgmt',
      kind: 'task',
      memory: 'episodic',
      title: 'Personal Workspace Note',
      source: 'workspace/charlie/tasks/task_personal.md',
      tags: [],
    },
    {
      id: 'mgmt:note_confidential-deal',
      ns: 'mgmt',
      kind: 'note',
      memory: 'episodic',
      title: 'Secret Deal',
      source: 'content/notes/note_secret.md',
      tags: ['Confidential'],
    },
    {
      id: 'auditor:market_venue:aave',
      ns: 'auditor',
      kind: 'market_venue',
      memory: 'semantic',
      title: 'Aave V3',
      source: 'auditor:/api/protocol-knowledge/facts',
      tags: [],
    },
    {
      id: 'ext:kn_slack_message_123',
      ns: 'ext',
      kind: 'slack-message',
      memory: 'episodic',
      title: 'Slack Chat',
      source: 'workspace/fisher/knowledge/2026-09.jsonl',
      tags: [],
    },
    {
      id: 'proc:deploy/check_balance',
      ns: 'proc',
      kind: 'check',
      memory: 'procedural',
      title: 'Check balance',
      source: 'content/playbooks/playbook_deploy.md',
      tags: [],
    },
    {
      id: 'oa:doc:insights/funding-arb',
      ns: 'oa',
      kind: 'insight',
      memory: 'episodic',
      title: 'Funding Arb',
      source: 'onchain-analysis:insights/funding-arb.md',
      tags: [],
    },
  ];

  const sampleEdges = [
    // valid public-to-public edge
    {
      src: 'mgmt:decision_adr-goal-as-seventh-type',
      rel: 'supports',
      dst: 'auditor:market_venue:aave',
      asserted_by: 'member:charlie',
      status: 'accepted',
      strength: 'verifier_confirmed',
    },
    // edge connecting to meeting (meeting is excluded in public scope)
    {
      src: 'mgmt:decision_adr-goal-as-seventh-type',
      rel: 'mentions',
      dst: 'mgmt:meeting_2026-09-10-internal-sync',
      asserted_by: 'member:charlie',
      status: 'accepted',
      strength: 'source_asserted',
    },
    // edge connecting to workspace task (excluded in public scope)
    {
      src: 'mgmt:task_workspace-personal-notes',
      rel: 'implements',
      dst: 'mgmt:decision_adr-goal-as-seventh-type',
      asserted_by: 'member:charlie',
      status: 'accepted',
      strength: 'source_asserted',
    },
    // edge connecting to confidential note (excluded in public scope)
    {
      src: 'mgmt:note_confidential-deal',
      rel: 'supports',
      dst: 'auditor:market_venue:aave',
      asserted_by: 'member:charlie',
      status: 'accepted',
      strength: 'source_asserted',
    },
    // edge connecting to external slack message (excluded in public scope)
    {
      src: 'ext:kn_slack_message_123',
      rel: 'mentions',
      dst: 'mgmt:decision_adr-goal-as-seventh-type',
      asserted_by: 'agent:fisher',
      status: 'accepted',
      strength: 'heuristic_signal',
    },
    // edge between proc and oa (both public)
    {
      src: 'proc:deploy/check_balance',
      rel: 'evidenced_by',
      dst: 'oa:doc:insights/funding-arb',
      asserted_by: 'member:charlie',
      status: 'accepted',
      strength: 'source_asserted',
    },
  ];

  it('filters nodes according to public policy', () => {
    assert.equal(isNodePermitted(sampleNodes[0], { scope: 'public' }), true); // decision in content/
    assert.equal(isNodePermitted(sampleNodes[1], { scope: 'public' }), false); // internal meeting
    assert.equal(isNodePermitted(sampleNodes[2], { scope: 'public' }), false); // workspace task
    assert.equal(isNodePermitted(sampleNodes[3], { scope: 'public' }), false); // confidential tag
    assert.equal(isNodePermitted(sampleNodes[4], { scope: 'public' }), true); // auditor venue
    assert.equal(isNodePermitted(sampleNodes[5], { scope: 'public' }), false); // ext slack message
    assert.equal(isNodePermitted(sampleNodes[6], { scope: 'public' }), true); // proc check
    assert.equal(isNodePermitted(sampleNodes[7], { scope: 'public' }), true); // oa doc
  });

  it('allows all nodes under scope: all', () => {
    for (const n of sampleNodes) {
      assert.equal(isNodePermitted(n, { scope: 'all' }), true);
    }
  });

  it('eliminates dangling edges when nodes are filtered out', () => {
    const { nodes, edges, stats } = sanitizeGraph({
      nodes: sampleNodes,
      edges: sampleEdges,
      options: { scope: 'public' },
    });

    assert.equal(stats.total_nodes, 8);
    assert.equal(stats.exported_nodes, 4); // decision, auditor venue, proc check, oa doc
    assert.equal(stats.excluded_nodes, 4);

    assert.equal(stats.total_edges, 6);
    assert.equal(stats.exported_edges, 2); // only the 2 edges between public nodes remain
    assert.equal(stats.excluded_edges, 4);

    const exportedNodeIds = new Set(nodes.map((n) => n.id));
    for (const e of edges) {
      assert.ok(exportedNodeIds.has(e.src), `src ${e.src} must exist in exported nodes`);
      assert.ok(exportedNodeIds.has(e.dst), `dst ${e.dst} must exist in exported nodes`);
    }
  });

  it('exports from database correctly in sqlite/jsonl format', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE nodes(
        id TEXT PRIMARY KEY, ns TEXT NOT NULL, kind TEXT NOT NULL, memory TEXT NOT NULL,
        title TEXT, status TEXT, owner TEXT, tags_json TEXT, created_at TEXT, updated_at TEXT,
        valid_from TEXT, valid_to TEXT, as_of TEXT, source TEXT, meta_json TEXT
      );
      CREATE TABLE edges(
        src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, attrs_json TEXT,
        asserted_by TEXT NOT NULL, asserted_at TEXT, evidence_json TEXT, strength TEXT NOT NULL,
        status TEXT NOT NULL, supersedes TEXT, derived INTEGER NOT NULL DEFAULT 0, origin TEXT,
        PRIMARY KEY(src, rel, dst)
      );
    `);

    const insN = db.prepare('INSERT INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const n of sampleNodes) {
      insN.run(n.id, n.ns, n.kind, n.memory, n.title, null, null, JSON.stringify(n.tags), null, null, null, null, null, n.source, '{}');
    }
    const insE = db.prepare('INSERT INTO edges VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const e of sampleEdges) {
      insE.run(e.src, e.rel, e.dst, '{}', e.asserted_by, '2026-09-22', '[]', e.strength, e.status, null, 0, 'test');
    }

    const { nodes, edges, stats } = exportFromDb(db, { scope: 'public' });
    assert.equal(nodes.length, 4);
    assert.equal(edges.length, 2);
    assert.equal(stats.exported_nodes, 4);
    assert.equal(stats.exported_edges, 2);
    db.close();
  });
});
