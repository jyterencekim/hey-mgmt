import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReflection, routeReflectionDecision, processReflectionDecisions } from '../activity-reflection.mjs';

const CONFIG = { promotion_confidence_threshold: 0.8, observation_confidence_threshold: 0.5 };

function makeDecision(overrides = {}) {
  return {
    decision: 'match',
    confidence: 0.9,
    artifact_id: 'task_foo',
    event_signatures: ['sig-1'],
    match_reason: 'Direct topic match',
    _event_data: {
      source: 'jira',
      object_id: 'PROJ-1',
      object_type: 'issue',
      object_title: 'Fix the thing',
      object_url: 'https://jira.example/PROJ-1',
      actor: 'jared',
      changed_at: '2026-04-08T09:00:00+09:00',
      kst_date: '2026-04-08',
    },
    ...overrides,
  };
}

// ── classifyReflection ────────────────────────────────────────────────────────

describe('classifyReflection', () => {
  it('returns promote for match with confidence >= 0.8', () => {
    assert.equal(classifyReflection(makeDecision({ confidence: 0.8 }), CONFIG), 'promote');
    assert.equal(classifyReflection(makeDecision({ confidence: 0.95 }), CONFIG), 'promote');
  });

  it('returns observe for match with confidence 0.5–0.79', () => {
    assert.equal(classifyReflection(makeDecision({ confidence: 0.5 }), CONFIG), 'observe');
    assert.equal(classifyReflection(makeDecision({ confidence: 0.79 }), CONFIG), 'observe');
  });

  it('returns filter for skip with any confidence', () => {
    assert.equal(classifyReflection(makeDecision({ decision: 'skip', confidence: 0.9 }), CONFIG), 'filter');
    assert.equal(classifyReflection(makeDecision({ decision: 'skip', confidence: 0.1 }), CONFIG), 'filter');
  });

  it('returns filter for match with confidence < 0.5', () => {
    assert.equal(classifyReflection(makeDecision({ confidence: 0.49 }), CONFIG), 'filter');
    assert.equal(classifyReflection(makeDecision({ confidence: 0.0 }), CONFIG), 'filter');
  });

  it('respects explicit reflection: promote even with low confidence', () => {
    assert.equal(
      classifyReflection(makeDecision({ confidence: 0.1, reflection: 'promote' }), CONFIG),
      'promote',
    );
  });

  it('respects explicit reflection: observe from agent', () => {
    assert.equal(
      classifyReflection(makeDecision({ confidence: 0.9, reflection: 'observe' }), CONFIG),
      'observe',
    );
  });

  it('returns promote for distill with confidence >= 0.8', () => {
    assert.equal(
      classifyReflection(makeDecision({ decision: 'distill', confidence: 0.85 }), CONFIG),
      'promote',
    );
  });
});

// ── routeReflectionDecision ───────────────────────────────────────────────────

describe('routeReflectionDecision', () => {
  it('returns observation shape with tier=observed for moderate match', () => {
    const result = routeReflectionDecision(makeDecision({ confidence: 0.65 }), CONFIG);
    assert.ok(result !== null);
    assert.equal(result.tier, 'observed');
    assert.equal(result.observation.tier, 'observed');
    assert.equal(result.observation.relevance, 'moderate');
  });

  it('returns promotion shape with tier=promoted for high-confidence match', () => {
    const result = routeReflectionDecision(makeDecision({ confidence: 0.9 }), CONFIG);
    assert.ok(result !== null);
    assert.equal(result.tier, 'promoted');
    assert.equal(result.observation.tier, 'promoted');
    assert.equal(result.observation.relevance, 'high');
    assert.ok(result.promotion !== null);
  });

  it('returns null for filtered skip', () => {
    const result = routeReflectionDecision(makeDecision({ decision: 'skip', confidence: 0.9 }), CONFIG);
    assert.equal(result, null);
  });

  it('promoted result includes promotion.artifact_id from the decision', () => {
    const result = routeReflectionDecision(makeDecision({ confidence: 0.9, artifact_id: 'task_oracle' }), CONFIG);
    assert.equal(result.promotion.artifact_id, 'task_oracle');
  });

  it('observed result has promotion=null', () => {
    const result = routeReflectionDecision(makeDecision({ confidence: 0.65 }), CONFIG);
    assert.equal(result.promotion, null);
  });
});

// ── processReflectionDecisions ────────────────────────────────────────────────

describe('processReflectionDecisions', () => {
  it('counts promoted, observed, filtered correctly from mixed decisions', () => {
    const decisions = [
      makeDecision({ confidence: 0.95 }),                          // promote
      makeDecision({ confidence: 0.6 }),                           // observe
      makeDecision({ decision: 'skip', confidence: 0.9 }),         // filter
      makeDecision({ confidence: 0.3 }),                           // filter (low)
      makeDecision({ confidence: 0.82, artifact_id: 'task_bar' }), // promote
    ];

    const result = processReflectionDecisions(decisions, CONFIG);

    assert.equal(result.promoted.length, 2);
    assert.equal(result.observed.length, 1);
    assert.equal(result.filtered, 2);
  });

  it('returns empty arrays and filtered=0 for empty input', () => {
    const result = processReflectionDecisions([], CONFIG);
    assert.deepEqual(result.promoted, []);
    assert.deepEqual(result.observed, []);
    assert.equal(result.filtered, 0);
  });
});
