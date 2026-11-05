import assert from "node:assert/strict";
import test from "node:test";

import { assertSlackCoverage } from "./slack-coverage.mjs";

const terminalLane = (results = 0, pages = 1) => ({
  pages,
  results,
  terminal: true,
  nextCursor: null,
});

test("fails when the scan covers only DMs and group DMs", () => {
  assert.throws(
    () =>
      assertSlackCoverage({
        lanes: {
          im: terminalLane(14),
          mpim: terminalLane(3),
        },
      }),
    (error) => {
      assert.equal(error.code, "ERR_SLACK_COVERAGE");
      assert.deepEqual(error.checkpoint.missingLanes, [
        "public_channel",
        "private_channel",
        "mentions",
        "participated_threads",
      ]);
      return true;
    },
  );
});

test("passes when every accessible Slack lane reaches a terminal cursor", () => {
  const checkpoint = assertSlackCoverage({
    lanes: {
      public_channel: terminalLane(92, 5),
      private_channel: terminalLane(43, 3),
      im: terminalLane(14),
      mpim: terminalLane(3),
      mentions: terminalLane(2),
      participated_threads: terminalLane(3),
    },
  });

  assert.equal(checkpoint.pass, true);
});

test("fails closed while any Slack pagination cursor remains", () => {
  const lanes = Object.fromEntries([
    "public_channel",
    "private_channel",
    "im",
    "mpim",
    "mentions",
    "participated_threads",
  ].map((lane) => [lane, terminalLane()]));
  lanes.private_channel = {
    pages: 1,
    results: 20,
    terminal: false,
    nextCursor: "opaque-page-2",
  };

  assert.throws(
    () => assertSlackCoverage({ lanes }),
    /non-terminal lanes: private_channel/,
  );
});
