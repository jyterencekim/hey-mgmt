const REQUIRED_LANES = [
  "public_channel",
  "private_channel",
  "im",
  "mpim",
  "mentions",
  "participated_threads",
];

export function buildSlackCoverageCheckpoint({ lanes, errors = [] }) {
  if (!lanes || typeof lanes !== "object" || Array.isArray(lanes)) {
    throw new TypeError("lanes must be an object keyed by Slack coverage lane");
  }
  if (!Array.isArray(errors)) throw new TypeError("errors must be an array");

  const missingLanes = REQUIRED_LANES.filter((lane) => !lanes[lane]);
  const incompleteLanes = REQUIRED_LANES.filter((lane) => {
    const state = lanes[lane];
    return state && (state.pages < 1 || state.terminal !== true || state.nextCursor);
  });
  const malformedLanes = REQUIRED_LANES.filter((lane) => {
    const state = lanes[lane];
    return state &&
      (!Number.isInteger(state.pages) ||
        state.pages < 0 ||
        !Number.isInteger(state.results) ||
        state.results < 0);
  });

  return {
    pass:
      errors.length === 0 &&
      missingLanes.length === 0 &&
      incompleteLanes.length === 0 &&
      malformedLanes.length === 0,
    requiredLanes: REQUIRED_LANES,
    lanes,
    missingLanes,
    incompleteLanes,
    malformedLanes,
    errors,
  };
}

export function assertSlackCoverage(input) {
  const checkpoint = buildSlackCoverageCheckpoint(input);
  if (checkpoint.pass) return checkpoint;

  const reasons = [];
  if (checkpoint.missingLanes.length) {
    reasons.push(`missing lanes: ${checkpoint.missingLanes.join(", ")}`);
  }
  if (checkpoint.incompleteLanes.length) {
    reasons.push(`non-terminal lanes: ${checkpoint.incompleteLanes.join(", ")}`);
  }
  if (checkpoint.malformedLanes.length) {
    reasons.push(`malformed lanes: ${checkpoint.malformedLanes.join(", ")}`);
  }
  if (checkpoint.errors.length) reasons.push(`errors: ${checkpoint.errors.join("; ")}`);

  const error = new Error(`SLACK_COVERAGE failed: ${reasons.join(" | ")}`);
  error.code = "ERR_SLACK_COVERAGE";
  error.checkpoint = checkpoint;
  throw error;
}
