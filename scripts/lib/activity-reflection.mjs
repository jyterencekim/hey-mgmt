/**
 * activity-reflection.mjs
 *
 * Second-pass reflection router for the Fisher autonomous collection pipeline.
 * Routes classified agent decisions into promote / observe / filter tiers.
 */

/**
 * Classify an agent decision into a reflection tier.
 *
 * @param {{ decision: string, confidence: number, reflection?: string }} agentDecision
 * @param {{ promotion_confidence_threshold: number, observation_confidence_threshold: number }} reflectionConfig
 * @returns {'promote' | 'observe' | 'filter'}
 */
export function classifyReflection(agentDecision, reflectionConfig) {
  const { decision, confidence, reflection } = agentDecision;
  const { promotion_confidence_threshold, observation_confidence_threshold } = reflectionConfig;

  if (reflection === 'promote' || reflection === 'observe' || reflection === 'filter') {
    return reflection;
  }

  if (decision === 'skip') return 'filter';

  if (confidence >= promotion_confidence_threshold) return 'promote';
  if (confidence >= observation_confidence_threshold) return 'observe';
  return 'filter';
}

function buildSubstance(agentDecision) {
  // Prefer the agent's explicit update_draft.summary (the literal change made
  // to team knowledge). Fall back to summary_points, then the event summary
  // from the source system so the digest always has substance even when the
  // agent was terse.
  const draftSummary = agentDecision.update_draft?.summary;
  if (typeof draftSummary === 'string' && draftSummary.trim()) return draftSummary.trim();

  const points = agentDecision.summary_points;
  if (Array.isArray(points) && points.length > 0) {
    return points.map((p) => String(p).trim()).filter(Boolean).join(' · ');
  }

  const eventSummary = agentDecision._event_data?.summary;
  if (typeof eventSummary === 'string' && eventSummary.trim()) return eventSummary.trim();

  return null;
}

function buildObservation(agentDecision, tier, relevance) {
  const ev = agentDecision._event_data ?? {};
  return {
    date: ev.kst_date ?? null,
    signature: agentDecision.event_signatures?.[0] ?? null,
    source: ev.source ?? null,
    title: ev.object_title ?? null,
    actor: ev.actor ?? null,
    time: ev.changed_at ?? null,
    url: ev.object_url ?? null,
    relevance,
    reason: agentDecision.match_reason ?? agentDecision.skip_reason ?? null,
    summary: buildSubstance(agentDecision),
    tier,
    event_data: ev,
    ...(tier === 'promoted' ? { promoted_to: agentDecision.artifact_id ?? null } : {}),
  };
}

/**
 * Route a single agent decision to the appropriate tier result.
 *
 * @param {object} agentDecision
 * @param {object} reflectionConfig
 * @returns {object | null} null for filter, otherwise { tier, observation, promotion }
 */
export function routeReflectionDecision(agentDecision, reflectionConfig) {
  const tier = classifyReflection(agentDecision, reflectionConfig);

  if (tier === 'filter') return null;

  if (tier === 'promote') {
    return {
      tier: 'promoted',
      observation: buildObservation(agentDecision, 'promoted', 'high'),
      promotion: {
        decision: agentDecision.decision ?? null,
        artifact_id: agentDecision.artifact_id ?? null,
        confidence: agentDecision.confidence ?? null,
        match_reason: agentDecision.match_reason ?? null,
        update_draft: agentDecision.update_draft ?? null,
        title: agentDecision.title ?? agentDecision._event_data?.object_title ?? null,
        summary_points: agentDecision.summary_points ?? [],
        artifact_type: agentDecision.artifact_type ?? null,
        domain_tag: agentDecision.domain_tag ?? null,
        event_signatures: agentDecision.event_signatures ?? [],
        _event_data: agentDecision._event_data ?? null,
        _source_text: agentDecision._source_text ?? null,
      },
    };
  }

  // observe
  return {
    tier: 'observed',
    observation: buildObservation(agentDecision, 'observed', 'moderate'),
    promotion: null,
  };
}

/**
 * Process an array of agent decisions into promote / observe / filter buckets.
 *
 * @param {object[]} decisions
 * @param {object} reflectionConfig
 * @returns {{ promoted: object[], observed: object[], filtered: number }}
 */
export function processReflectionDecisions(decisions, reflectionConfig) {
  return decisions.reduce(
    (acc, decision) => {
      const result = routeReflectionDecision(decision, reflectionConfig);
      if (result === null) {
        return { ...acc, filtered: acc.filtered + 1 };
      }
      if (result.tier === 'promoted') {
        return { ...acc, promoted: [...acc.promoted, result] };
      }
      return { ...acc, observed: [...acc.observed, result] };
    },
    { promoted: [], observed: [], filtered: 0 },
  );
}
