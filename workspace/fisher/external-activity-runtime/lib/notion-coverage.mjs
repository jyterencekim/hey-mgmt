function canonicalNotionUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("Every Notion row must have a non-empty url");
  }

  return value
    .trim()
    .replace("https://www.notion.so/", "https://app.notion.com/")
    .replace("https://notion.so/", "https://app.notion.com/")
    .replace("https://app.notion.com/p/", "https://app.notion.com/")
    .split("?")[0]
    .replace(/\/$/, "");
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();

  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }

  return [...duplicates].sort();
}

export function buildNotionCoverageCheckpoint({
  queriedRows,
  fetchedPages,
  nextCursor = null,
  errors = [],
}) {
  if (!Array.isArray(queriedRows)) {
    throw new TypeError("queriedRows must be an array of the actual query results");
  }
  if (!Array.isArray(fetchedPages)) {
    throw new TypeError("fetchedPages must be an array of fetch outcomes");
  }
  if (!Array.isArray(errors)) {
    throw new TypeError("errors must be an array");
  }

  const queryUrls = queriedRows.map((row) => canonicalNotionUrl(row.url));
  const successfulFetches = fetchedPages.filter((page) => page.ok === true);
  const fetchedUrls = successfulFetches.map((page) => canonicalNotionUrl(page.url));
  const querySet = new Set(queryUrls);
  const fetchedSet = new Set(fetchedUrls);

  const missingUrls = [...querySet].filter((url) => !fetchedSet.has(url)).sort();
  const unexpectedUrls = [...fetchedSet].filter((url) => !querySet.has(url)).sort();
  const duplicateQueryUrls = duplicateValues(queryUrls);
  const duplicateFetchedUrls = duplicateValues(fetchedUrls);
  const malformedFetches = successfulFetches
    .filter((page) => !page.title || !page.created)
    .map((page) => canonicalNotionUrl(page.url));
  const failedFetches = fetchedPages
    .filter((page) => page.ok !== true)
    .map((page) => canonicalNotionUrl(page.url));

  const pass =
    errors.length === 0 &&
    missingUrls.length === 0 &&
    unexpectedUrls.length === 0 &&
    duplicateQueryUrls.length === 0 &&
    duplicateFetchedUrls.length === 0 &&
    malformedFetches.length === 0 &&
    failedFetches.length === 0;

  return {
    pass,
    queriedCount: querySet.size,
    fetchedCount: fetchedSet.size,
    queriedUrls: [...querySet].sort(),
    fetchedUrls: [...fetchedSet].sort(),
    missingUrls,
    unexpectedUrls,
    duplicateQueryUrls,
    duplicateFetchedUrls,
    malformedFetches,
    failedFetches,
    nextCursor,
    errors,
  };
}

export function assertNotionCoverage(input) {
  const checkpoint = buildNotionCoverageCheckpoint(input);
  if (checkpoint.pass) return checkpoint;

  const reasons = [];
  if (checkpoint.missingUrls.length) {
    reasons.push(`missing fetched pages: ${checkpoint.missingUrls.join(", ")}`);
  }
  if (checkpoint.unexpectedUrls.length) {
    reasons.push(`unexpected fetched pages: ${checkpoint.unexpectedUrls.join(", ")}`);
  }
  if (checkpoint.failedFetches.length) {
    reasons.push(`failed fetches: ${checkpoint.failedFetches.join(", ")}`);
  }
  if (checkpoint.malformedFetches.length) {
    reasons.push(`fetches missing title/created: ${checkpoint.malformedFetches.join(", ")}`);
  }
  if (checkpoint.duplicateQueryUrls.length || checkpoint.duplicateFetchedUrls.length) {
    reasons.push("duplicate URLs detected");
  }
  if (checkpoint.errors.length) reasons.push(`errors: ${checkpoint.errors.join("; ")}`);

  const error = new Error(`NOTION_COVERAGE failed: ${reasons.join(" | ")}`);
  error.code = "ERR_NOTION_COVERAGE";
  error.checkpoint = checkpoint;
  throw error;
}

// The original assertion validates a single page and deliberately retains its
// next cursor. A whole recent lane must additionally prove terminal pagination.
export function assertRecentNotionCoverage(input) {
  const checkpoint = assertNotionCoverage(input);
  if (checkpoint.nextCursor) {
    const error = new Error(`NOTION_COVERAGE non-terminal recent lane: ${checkpoint.nextCursor}`);
    error.code = 'ERR_NOTION_COVERAGE';
    error.checkpoint = { ...checkpoint, pass: false };
    throw error;
  }
  return checkpoint;
}
