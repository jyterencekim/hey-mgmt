import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ConfluenceCollector } from './confluence-collector.mjs';

function config(overrides = {}) {
  return {
    confluence: {
      enabled: true,
      poll_seconds: 600,
      state_path: '.runtime/confluence-collector/state.json',
      raw_event_dir: '.runtime/confluence-collector/raw',
      file_cache_dir: '.runtime/confluence-collector/files',
      initial_lookback_hours: 24,
      max_pages_per_poll: 10,
      pages: [{ id: '149783426', title: 'Roadmap' }],
      spaces: [{ key: 'USDT', include_recent_pages: 2 }],
    },
    members: {
      jared: { confluence_names: ['Jared Lee'] },
      terence: { confluence_names: ['Terence Kim'] },
    },
    ...overrides,
  };
}

describe('ConfluenceCollector', () => {
  it('ingests allowlisted pages and recent space pages', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'confluence-collector-'));
    let ingestedEvents = [];
    const fakeFetch = async (url) => {
      if (String(url).includes('/content/search')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              { id: '149783426' },
              { id: '200000001' },
            ],
          }),
        };
      }

      if (String(url).includes('/content/149783426')) {
        return {
          ok: true,
          json: async () => ({
            id: '149783426',
            title: 'Roadmap',
            body: { storage: { value: '<p>Launch v1 this week</p>' } },
            history: {
              lastUpdated: {
                when: '2026-03-17T00:00:00.000Z',
                by: { displayName: 'Jared Lee' },
              },
            },
            version: { number: 8 },
            _links: { base: 'https://kaia-foundation.atlassian.net', webui: '/wiki/spaces/USDT/pages/149783426' },
          }),
        };
      }

      if (String(url).includes('/content/200000001')) {
        return {
          ok: true,
          json: async () => ({
            id: '200000001',
            title: 'Partner Notes',
            body: { storage: { value: '<p>Terence updated assumptions</p>' } },
            history: {
              lastUpdated: {
                when: '2026-03-17T01:00:00.000Z',
                by: { displayName: 'Terence Kim' },
              },
            },
            version: { number: 2 },
            _links: { base: 'https://kaia-foundation.atlassian.net', webui: '/wiki/spaces/USDT/pages/200000001' },
          }),
        };
      }

      throw new Error(`Unhandled fetch ${url}`);
    };

    const collector = new ConfluenceCollector({
      repoRoot,
      config: config(),
      fetchImpl: fakeFetch,
      email: 'jared@example.com',
      token: 'token',
      baseUrl: 'https://kaia-foundation.atlassian.net',
      ingestEvents: ({ events }) => {
        ingestedEvents = events;
        return { event_count: events.length, candidate_count: 0, log_results: [] };
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.event_count, 2);
    assert.deepEqual(
      ingestedEvents.map((event) => [event.object_id, event.workspace_owner]),
      [
        ['149783426', 'jared'],
        ['200000001', 'terence'],
      ]
    );
  });
});
