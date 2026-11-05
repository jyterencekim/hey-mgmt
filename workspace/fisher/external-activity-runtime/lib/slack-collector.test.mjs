import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { SlackCollector, extractTextFromSlackFile } from './slack-collector.mjs';

function config(overrides = {}) {
  return {
    bot: {
      workspace_url: 'https://kaiafoundation.slack.com',
    },
    collector: {
      enabled: true,
      poll_seconds: 300,
      state_path: '.runtime/slack-collector/state.json',
      file_cache_dir: '.runtime/slack-collector/files',
      raw_event_dir: '.runtime/slack-collector/raw',
      history_overlap_seconds: 900,
      initial_lookback_hours: 24,
      file_download_max_bytes: 1024 * 1024,
      channels: [
        { id: 'C123', name: 'jpyc-research', include_threads: true, include_files: true },
      ],
    },
    members: {
      jared: { slack_user_id: 'U07EPER3998', slack_dm_id: 'D07E8TSQB1V' },
      terence: { slack_user_id: 'U098SMD9TBJ', slack_dm_id: 'D098Y4RTL9X' },
    },
    ...overrides,
  };
}

function writeMembersVocab(repoRoot, members = ['jared', 'terence', 'oliver']) {
  const vocabDir = resolve(repoRoot, 'content', 'vocab');
  mkdirSync(vocabDir, { recursive: true });
  writeFileSync(
    resolve(vocabDir, 'members.yml'),
    `members:\n${members.map((member) => `  - name: ${member}\n    role: team\n`).join('')}`,
    'utf8',
  );
}

describe('extractTextFromSlackFile', () => {
  it('extracts visible text from HTML files', () => {
    const text = extractTextFromSlackFile({
      name: 'jpyc-yield-simulator.html',
      mimetype: 'text/html',
      filetype: 'html',
      content: Buffer.from('<html><body><h1>JPYC Yield</h1><script>bad()</script><p>Simulator</p></body></html>'),
    });
    assert.equal(text, 'JPYC Yield Simulator');
  });
});

describe('SlackCollector', () => {
  it('captures lead-only messages, threads, and files without ingesting them', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'slack-leads-'));
    const leadChannel = { id: 'CLEADS', name: 'superearn_news', include_threads: true, include_files: true, capture_only: true };
    const cfg = config();
    cfg.collector.channels = [leadChannel];
    const calls = [];
    const fakeFetch = async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('conversations.history')) return { ok: true, json: async () => ({ ok: true, messages: [{ ts: '1710000000.000100', user: 'U07EPER3998', text: 'Unverified X lead', thread_ts: '1710000000.000100', reply_count: 1, files: [{ id: 'FLEAD' }] }], response_metadata: {} }) };
      if (href.includes('conversations.replies')) return { ok: true, json: async () => ({ ok: true, messages: [{ ts: '1710000000.000100', user: 'U07EPER3998', text: 'Unverified X lead', files: [{ id: 'FLEAD' }] }, { ts: '1710000001.000100', user: 'U07EPER3998', text: 'Not related to product' }] }) };
      if (href.includes('files.info')) return { ok: true, json: async () => ({ ok: true, file: { id: 'FLEAD', user: 'U07EPER3998', title: 'Lead', name: 'lead.txt', mimetype: 'text/plain', size: 4, created: 1710000000, url_private_download: 'https://files.example/FLEAD' } }) };
      if (href.includes('files.example')) return { ok: true, arrayBuffer: async () => Buffer.from('lead') };
      if (href.includes('users.info')) return { ok: true, json: async () => ({ ok: true, user: { profile: { display_name: 'Jared Lee' } } }) };
      throw new Error(`Unhandled fetch ${url}`);
    };
    const collector = new SlackCollector({ repoRoot, config: cfg, token: 'xoxb-test', fetchImpl: fakeFetch, ingestEvents: async () => { throw new Error('lead-only content entered activity ingestion'); } });
    const result = await collector.pollOnce();
    assert.equal(result.event_count, 0);
    assert.equal(result.candidate_count, 0);
    assert.equal(result.channel_errors.length, 0);
    assert.equal(result.thread_errors.length, 0);
    assert.equal(result.file_errors.length, 0);
    assert.equal(calls.some((url) => url.includes('conversations.replies')), true);
    assert.equal(calls.some((url) => url.includes('files.info')), true);
    assert.equal(JSON.parse(readFileSync(resolve(repoRoot, '.runtime/slack-collector/raw/messages/message__CLEADS__1710000000_000100.json'), 'utf8')).channel.capture_only, true);
    assert.equal(readFileSync(resolve(repoRoot, '.runtime/slack-collector/files/FLEAD/lead.txt'), 'utf8'), 'lead');
    assert.equal(collector.readState().files.file__FLEAD.capture_only, true);
  });

  it('ingests message, thread, and file events from an allowlisted channel', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'slack-collector-'));
    const calls = [];
    const fakeFetch = async (url) => {
      calls.push(url);
      if (String(url).includes('conversations.history')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            messages: [{
              ts: '1710000000.000100',
              user: 'U07EPER3998',
              text: 'JPYC research update',
              thread_ts: '1710000000.000100',
              reply_count: 1,
              files: [{ id: 'F123' }],
            }],
            response_metadata: {},
          }),
        };
      }
      if (String(url).includes('conversations.replies')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            messages: [
              { ts: '1710000000.000100', user: 'U07EPER3998', text: 'JPYC research update' },
              { ts: '1710000300.000200', user: 'U07EPER3998', text: 'Uploaded simulator html' },
            ],
          }),
        };
      }
      if (String(url).includes('files.info')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            file: {
              id: 'F123',
              user: 'U07EPER3998',
              title: 'JPYC Yield Simulator',
              name: 'jpyc-yield-simulator.html',
              mimetype: 'text/html',
              filetype: 'html',
              size: 64,
              created: 1710000000,
              permalink: 'https://kaiafoundation.slack.com/files/U07EPER3998/F123/jpyc-yield-simulator.html',
              url_private_download: 'https://files.example/F123',
            },
          }),
        };
      }
      if (String(url).includes('users.info')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            user: { profile: { display_name: 'Jared Lee' } },
          }),
        };
      }
      if (String(url).includes('files.example')) {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from('<html><body>Simulator v2</body></html>'),
        };
      }
      throw new Error(`Unhandled fetch ${url}`);
    };

    let ingestedEvents = [];
    const collector = new SlackCollector({
      repoRoot,
      config: config(),
      token: 'xoxb-test',
      fetchImpl: fakeFetch,
      ingestEvents: async ({ events }) => {
        ingestedEvents = events;
        return { event_count: events.length, candidate_count: 0, log_results: [] };
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.event_count, 3);
    assert.equal(ingestedEvents.some((event) => event.object_type === 'slack-message'), true);
    assert.equal(ingestedEvents.some((event) => event.object_type === 'slack-thread'), true);
    assert.equal(ingestedEvents.some((event) => event.object_type === 'slack-file'), true);
    assert.equal(ingestedEvents.every((event) => event.workspace_owner === 'jared'), true);
  });

  it('OCRs image attachments even when legacy image ignore config is present', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'slack-collector-'));
    const collectorConfig = config({
      collector: {
        enabled: true,
        poll_seconds: 300,
        state_path: '.runtime/slack-collector/state.json',
        file_cache_dir: '.runtime/slack-collector/files',
        raw_event_dir: '.runtime/slack-collector/raw',
        history_overlap_seconds: 900,
        initial_lookback_hours: 24,
        file_download_max_bytes: 1024 * 1024,
        image_ocr_enabled: true,
        ignored_file_mimetype_prefixes: ['image/'],
        ignored_file_extensions: ['.png'],
        channels: [
          { id: 'C123', name: 'jpyc-research', include_threads: false, include_files: true },
        ],
      },
    });
    const fakeFetch = async (url) => {
      const href = String(url);
      if (href.includes('conversations.history')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            messages: [{
              ts: '1710000000.000100',
              user: 'U07EPER3998',
              text: 'LP screenshot',
              files: [{ id: 'FPNG', mimetype: 'image/png', name: 'lp.png', filetype: 'png' }],
            }],
            response_metadata: {},
          }),
        };
      }
      if (href.includes('files.info')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            file: {
              id: 'FPNG',
              user: 'U07EPER3998',
              title: 'LP screenshot',
              name: 'lp.png',
              mimetype: 'image/png',
              filetype: 'png',
              size: 8,
              created: 1710000000,
              permalink: 'https://kaiafoundation.slack.com/files/U07EPER3998/FPNG/lp.png',
              url_private_download: 'https://files.example/FPNG',
            },
          }),
        };
      }
      if (href.includes('users.info')) {
        return {
          ok: true,
          json: async () => ({ ok: true, user: { profile: { display_name: 'Jared Lee' } } }),
        };
      }
      if (href.includes('files.example')) {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from('fake-png'),
        };
      }
      throw new Error(`Unhandled fetch ${url}`);
    };

    let ingestedEvents = [];
    const collector = new SlackCollector({
      repoRoot,
      config: collectorConfig,
      token: 'xoxb-test',
      fetchImpl: fakeFetch,
      ocrImage: async (filePath) => {
        assert.equal(filePath.endsWith('/FPNG/lp.png'), true);
        return 'Position value $11,493.09\nOut of range';
      },
      ingestEvents: ({ events }) => {
        ingestedEvents = events;
        return { event_count: events.length, candidate_count: 0, log_results: [] };
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.event_count, 2);
    const fileEvent = ingestedEvents.find((event) => event.object_type === 'slack-file');
    assert.ok(fileEvent);
    assert.match(fileEvent.summary, /OCR text from image LP screenshot/);
    assert.match(fileEvent.summary, /Position value \$11,493\.09/);
    assert.match(readFileSync(fileEvent.raw_ref, 'utf8'), /Out of range/);
  });

  it('continues polling remaining channels when one channel is unreadable', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'slack-collector-'));
    let ingestedEvents = [];
    const collectorConfig = config({
      collector: {
        enabled: true,
        poll_seconds: 300,
        state_path: '.runtime/slack-collector/state.json',
        file_cache_dir: '.runtime/slack-collector/files',
        raw_event_dir: '.runtime/slack-collector/raw',
        history_overlap_seconds: 900,
        initial_lookback_hours: 24,
        file_download_max_bytes: 1024 * 1024,
        channels: [
          { id: 'CBAD', name: 'missing-channel', include_threads: true, include_files: true },
          { id: 'C123', name: 'jpyc-research', include_threads: false, include_files: false },
        ],
      },
    });
    const fakeFetch = async (url) => {
      const href = String(url);
      if (href.includes('conversations.history') && href.includes('channel=CBAD')) {
        return { ok: true, json: async () => ({ ok: false, error: 'not_in_channel' }) };
      }
      if (href.includes('conversations.history') && href.includes('channel=C123')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            messages: [{ ts: '1710000000.000100', user: 'U07EPER3998', text: 'still captured' }],
            response_metadata: {},
          }),
        };
      }
      if (href.includes('users.info')) {
        return {
          ok: true,
          json: async () => ({ ok: true, user: { profile: { display_name: 'Jared Lee' } } }),
        };
      }
      throw new Error(`Unhandled fetch ${url}`);
    };
    const collector = new SlackCollector({
      repoRoot,
      config: collectorConfig,
      token: 'xoxb-test',
      fetchImpl: fakeFetch,
      ingestEvents: ({ events }) => {
        ingestedEvents = events;
        return { event_count: events.length, candidate_count: 0, log_results: [] };
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.event_count, 1);
    assert.equal(ingestedEvents[0].object_id, 'message__C123__1710000000_000100');
    assert.equal(result.channel_errors.length, 1);
    assert.equal(result.channel_errors[0].channel_id, 'CBAD');
    assert.match(result.channel_errors[0].error, /not_in_channel/);
  });

  it('continues ingesting messages when files.info access is denied for an attachment', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'slack-collector-'));
    let ingestedEvents = [];
    const fakeFetch = async (url) => {
      const href = String(url);
      if (href.includes('conversations.history')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            messages: [{
              ts: '1710000000.000100',
              user: 'U07EPER3998',
              text: 'still capture the message',
              files: [{ id: 'FDENIED' }],
            }],
            response_metadata: {},
          }),
        };
      }
      if (href.includes('files.info')) {
        return {
          ok: true,
          json: async () => ({ ok: false, error: 'access_denied' }),
        };
      }
      if (href.includes('users.info')) {
        return {
          ok: true,
          json: async () => ({ ok: true, user: { profile: { display_name: 'Jared Lee' } } }),
        };
      }
      throw new Error(`Unhandled fetch ${url}`);
    };

    const collector = new SlackCollector({
      repoRoot,
      config: config(),
      token: 'xoxb-test',
      fetchImpl: fakeFetch,
      ingestEvents: ({ events }) => {
        ingestedEvents = events;
        return { event_count: events.length, candidate_count: 0, log_results: [] };
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.event_count, 1);
    assert.equal(ingestedEvents[0].object_type, 'slack-message');
    assert.equal(result.file_errors.length, 1);
    assert.equal(result.file_errors[0].file_id, 'FDENIED');
    assert.match(result.file_errors[0].error, /access_denied/);
  });

  it('infers workspace owner for an unpaired Slack member from profile data', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'slack-collector-'));
    writeMembersVocab(repoRoot);
    const collectorConfig = config({
      members: {
        jared: { slack_user_id: 'U07EPER3998', slack_dm_id: 'D07E8TSQB1V' },
        terence: { slack_user_id: 'U098SMD9TBJ', slack_dm_id: 'D098Y4RTL9X' },
        oliver: {},
      },
      collector: {
        enabled: true,
        poll_seconds: 300,
        state_path: '.runtime/slack-collector/state.json',
        file_cache_dir: '.runtime/slack-collector/files',
        raw_event_dir: '.runtime/slack-collector/raw',
        history_overlap_seconds: 900,
        initial_lookback_hours: 24,
        file_download_max_bytes: 1024 * 1024,
        channels: [
          { id: 'C123', name: 'jpyc-research', include_threads: false, include_files: false },
        ],
      },
    });
    let ingestedEvents = [];
    const fakeFetch = async (url) => {
      if (String(url).includes('conversations.history')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            messages: [{
              ts: '1710000000.000100',
              user: 'U0OLIVER999',
              text: 'Need a repo summary',
            }],
            response_metadata: {},
          }),
        };
      }
      if (String(url).includes('users.info')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            user: {
              name: 'oliver.kim',
              profile: {
                display_name: 'Oliver Kim',
                real_name: 'Oliver Kim',
              },
            },
          }),
        };
      }
      throw new Error(`Unhandled fetch ${url}`);
    };
    const collector = new SlackCollector({
      repoRoot,
      config: collectorConfig,
      token: 'xoxb-test',
      fetchImpl: fakeFetch,
      ingestEvents: ({ events }) => {
        ingestedEvents = events;
        return { event_count: events.length, candidate_count: 0, log_results: [] };
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.event_count, 1);
    assert.equal(ingestedEvents[0].workspace_owner, 'oliver');
    assert.equal(ingestedEvents[0].actor, 'Oliver Kim');
  });
});
