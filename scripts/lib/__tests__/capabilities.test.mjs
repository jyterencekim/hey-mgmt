import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cmpVersion, CAPABILITIES, CAPABILITIES_VERSION, intelligenceStatus } from '../capabilities.mjs';

// cmpVersion is the decision logic behind the `tooling-current` capability:
// a checkout whose hey/skills version is LOWER than origin/main's must read as
// "behind" and nudge a pull. These tests encode that intent — not just the math.
describe('cmpVersion', () => {
  it('orders an older version before a newer one (drives the "behind main" nudge)', () => {
    assert.ok(cmpVersion('0.2.0', '0.3.0') < 0, '0.2.0 must be behind 0.3.0');
    assert.ok(cmpVersion('0.3.0', '0.2.0') > 0, '0.3.0 must be ahead of 0.2.0');
  });

  it('compares numerically, not lexically', () => {
    // Lexical string compare would rank "0.10.0" < "0.9.0" — a member on 0.9.0
    // would then be wrongly told they are current. Must be numeric.
    assert.ok(cmpVersion('0.10.0', '0.9.0') > 0, '0.10.0 is newer than 0.9.0');
    assert.ok(cmpVersion('0.9.0', '0.10.0') < 0, '0.9.0 is behind 0.10.0');
  });

  it('treats equal and length-mismatched-but-equal versions as equal', () => {
    assert.equal(cmpVersion('1.0.0', '1.0.0'), 0);
    assert.equal(cmpVersion('1.0', '1.0.0'), 0);
    assert.equal(cmpVersion('1', '1.0.0'), 0);
  });

  it('treats missing trailing parts as zero', () => {
    assert.ok(cmpVersion('1.2', '1.2.1') < 0, '1.2 (==1.2.0) is behind 1.2.1');
  });
});

describe('capabilities registry', () => {
  it('registers tooling-current as a diagnostic', () => {
    const tc = CAPABILITIES.find((c) => c.id === 'tooling-current');
    assert.ok(tc, 'tooling-current capability is registered');
    assert.equal(tc.kind, 'diagnostic', 'never auto-applied — pulling is interactive');
    assert.equal(tc.version, 3);
  });

  it('registers intelligence-graph as optional at the current capabilities version', () => {
    // Cloning a private org repo can fail for a member without access, and the
    // build is per-developer, so it is offered (prompted), never auto-applied.
    const ig = CAPABILITIES.find((c) => c.id === 'intelligence-graph');
    assert.ok(ig, 'intelligence-graph capability is registered');
    assert.equal(ig.kind, 'optional');
    assert.equal(ig.version, CAPABILITIES_VERSION, 'shipped in the latest capabilities version');
    assert.equal(typeof ig.apply, 'function');
  });

  it('every capability exposes a check()', () => {
    for (const c of CAPABILITIES) {
      assert.equal(typeof c.check, 'function', `${c.id} must have check()`);
    }
  });
});

describe('intelligenceStatus', () => {
  // The graph is gitignored in the sibling, so a fresh clone is "not ready" until
  // installed and built; each missing stage names the next step apply() takes.
  it('walks clone → install → build and reports the stage that is missing', () => {
    const base = mkdtempSync(join(tmpdir(), 'hey-cap-'));
    const mgmt = join(base, 'hey-mgmt');
    const sib = join(base, 'hey-intelligence');
    mkdirSync(mgmt);
    const prev = process.env.KG_INTELLIGENCE_ROOT;
    delete process.env.KG_INTELLIGENCE_ROOT;
    try {
      assert.equal(intelligenceStatus(mgmt).missing, 'clone');
      mkdirSync(join(sib, 'bin'), { recursive: true });
      writeFileSync(join(sib, 'bin/kg.mjs'), '');
      assert.equal(intelligenceStatus(mgmt).missing, 'install');
      mkdirSync(join(sib, 'node_modules'));
      assert.equal(intelligenceStatus(mgmt).missing, 'build');
      mkdirSync(join(sib, 'build'));
      writeFileSync(join(sib, 'build/graph.jsonl'), '');
      const s = intelligenceStatus(mgmt);
      assert.equal(s.ok, true);
      assert.match(s.detail, /^built \d{4}-\d{2}-\d{2}/);
    } finally {
      if (prev !== undefined) process.env.KG_INTELLIGENCE_ROOT = prev;
    }
  });
});
