import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNotionCoverage,
  buildNotionCoverageCheckpoint,
  assertRecentNotionCoverage,
} from "./notion-coverage.mjs";

test('a successful individual page cannot certify an unfinished recent lane', () => {
  assert.throws(() => assertRecentNotionCoverage({ queriedRows: [], fetchedPages: [], nextCursor: 'provider-page-2' }), /non-terminal/);
  assert.equal(assertRecentNotionCoverage({ queriedRows: [], fetchedPages: [], nextCursor: null }).pass, true);
});

const oldRows = [
  { url: "https://app.notion.com/old-a", Name: "Old A", Created: "2026-08-12T05:00:00Z" },
  { url: "https://app.notion.com/old-b", Name: "Old B", Created: "2026-08-11T05:00:00Z" },
];
const klipRow = {
  url: "https://app.notion.com/3c03b4fc974e80b4a49bf9216fd71e2a",
  Name: "Klip 미팅",
  Created: "2026-08-18T05:19:21Z",
};

test("fails when a new query row is omitted by a stale hard-coded fetch list", () => {
  assert.throws(
    () =>
      assertNotionCoverage({
        queriedRows: [...oldRows, klipRow],
        fetchedPages: oldRows.map((row) => ({
          url: row.url,
          title: row.Name,
          created: row.Created,
          ok: true,
        })),
      }),
    (error) => {
      assert.equal(error.code, "ERR_NOTION_COVERAGE");
      assert.deepEqual(error.checkpoint.missingUrls, [klipRow.url]);
      return true;
    },
  );
});

test("passes only when every returned URL was fetched successfully", () => {
  const queriedRows = [...oldRows, klipRow];
  const checkpoint = assertNotionCoverage({
    queriedRows,
    fetchedPages: queriedRows.map((row) => ({
      url: row.url.replace("https://app.notion.com/", "https://app.notion.com/p/"),
      title: row.Name,
      created: row.Created,
      ok: true,
    })),
    nextCursor: "opaque-next-cursor",
  });

  assert.equal(checkpoint.pass, true);
  assert.equal(checkpoint.queriedCount, 3);
  assert.equal(checkpoint.fetchedCount, 3);
  assert.equal(checkpoint.nextCursor, "opaque-next-cursor");
});

test("fails closed when fetch metadata or connector calls are incomplete", () => {
  const checkpoint = buildNotionCoverageCheckpoint({
    queriedRows: [klipRow],
    fetchedPages: [{ url: klipRow.url, title: "Klip 미팅", ok: true }],
    errors: ["historical page query timed out"],
  });

  assert.equal(checkpoint.pass, false);
  assert.deepEqual(checkpoint.malformedFetches, [klipRow.url]);
  assert.deepEqual(checkpoint.errors, ["historical page query timed out"]);
});
