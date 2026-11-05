import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DriveCollector } from './drive-collector.mjs';

function config(overrides = {}) {
  return {
    drive: {
      enabled: true,
      mode: 'google_api',
      state_path: '.runtime/drive-collector/state.json',
      raw_event_dir: '.runtime/drive-collector/raw',
      file_cache_dir: '.runtime/drive-collector/files',
      file_download_max_bytes: 1024 * 1024,
      initial_lookback_hours: 168,
      max_files_per_poll: 10,
      max_changes_per_poll: 10,
      max_sheets_per_file: 5,
      shared_drives: ['drive-1'],
      folders: [],
      files: [],
    },
    members: {
      jared: { drive_emails: ['jared.lee@kaia.io'] },
    },
    ...overrides,
  };
}

describe('DriveCollector', () => {
  it('initializes the Drive start page token on first poll', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'drive-collector-'));
    const collector = new DriveCollector({
      repoRoot,
      config: config(),
      auth: {
        isConfigured: () => true,
        accessToken: async () => 'token',
      },
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes('/changes/startPageToken')) {
          return {
            ok: true,
            json: async () => ({ startPageToken: 'start-token-1' }),
          };
        }
        if (href.includes('/drive/v3/files')) {
          return {
            ok: true,
            json: async () => ({ files: [] }),
          };
        }
        throw new Error(`Unhandled fetch ${url}`);
      },
      ingestEvents: () => {
        throw new Error('ingest should not run on initialization');
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.reason, 'initialized_start_page_token');
    assert.equal(result.event_count, 0);
  });

  it('enumerates allowlisted My Drive folders during backfill', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'drive-collector-'));
    let ingestedEvents = [];
    const cfg = config();
    cfg.drive.folders = ['folder-my-drive'];
    const collector = new DriveCollector({
      repoRoot,
      config: cfg,
      auth: {
        isConfigured: () => true,
        accessToken: async () => 'token',
      },
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes('/changes/startPageToken') && !href.includes('driveId=')) {
          return {
            ok: true,
            json: async () => ({ startPageToken: 'start-token-default' }),
          };
        }
        if (href.includes('/changes/startPageToken') && href.includes('driveId=drive-1')) {
          return {
            ok: true,
            json: async () => ({ startPageToken: 'start-token-shared' }),
          };
        }
        if (href.includes('/drive/v3/files/folder-my-drive')) {
          return {
            ok: true,
            json: async () => ({
              id: 'folder-my-drive',
              name: 'Meet Recordings',
              mimeType: 'application/vnd.google-apps.folder',
              modifiedTime: '2026-04-09T01:00:00.000Z',
              webViewLink: 'https://drive.google.com/drive/folders/folder-my-drive',
              owners: [{ displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' }],
              lastModifyingUser: { displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' },
            }),
          };
        }
        if (href.includes('/drive/v3/files') && href.includes('folder-my-drive') && !href.includes('driveId=')) {
          return {
            ok: true,
            json: async () => ({
              files: [{
                id: 'doc-my-drive-1',
                name: 'Weekly Iteration Sync - 2026/03/30 10:58 KST - Notes by Gemini',
                mimeType: 'application/vnd.google-apps.document',
                modifiedTime: '2026-03-30T01:58:00.000Z',
                parents: ['folder-my-drive'],
                webViewLink: 'https://drive.google.com/file/d/doc-my-drive-1/view',
                owners: [{ displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' }],
                lastModifyingUser: { displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' },
              }],
            }),
          };
        }
        if (href.includes('/drive/v3/files') && href.includes('driveId=drive-1')) {
          return {
            ok: true,
            json: async () => ({ files: [] }),
          };
        }
        if (href.includes('/drive/v3/files') && !href.includes('driveId=')) {
          return {
            ok: true,
            json: async () => ({ files: [] }),
          };
        }
        if (href.includes('docs.googleapis.com') && href.includes('/documents/doc-my-drive-1')) {
          return {
            ok: true,
            json: async () => ({
              body: {
                content: [{
                  paragraph: {
                    elements: [{ textRun: { content: 'Weekly meeting notes captured from My Drive folder.' } }],
                  },
                }],
              },
            }),
          };
        }
        throw new Error(`Unhandled fetch ${url}`);
      },
      ingestEvents: ({ events }) => {
        ingestedEvents = events;
        return { event_count: events.length, candidate_count: 0, log_results: [] };
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.event_count, 1);
    assert.equal(ingestedEvents[0].object_id, 'doc-my-drive-1');
    assert.match(ingestedEvents[0].summary, /Weekly meeting notes captured/);
  });

  it('ingests allowlisted changes and extracts Google Docs text', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'drive-collector-'));
    let ingestedEvents = [];
    const collector = new DriveCollector({
      repoRoot,
      config: config(),
      auth: {
        isConfigured: () => true,
        accessToken: async () => 'token',
      },
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes('/changes/startPageToken') && !href.includes('driveId=')) {
          return { ok: true, json: async () => ({ startPageToken: 'start-token-default' }) };
        }
        if (href.includes('/changes/startPageToken') && href.includes('driveId=drive-1')) {
          return { ok: true, json: async () => ({ startPageToken: 'start-token-shared' }) };
        }
        if (href.includes('/changes') && href.includes('pageToken=start-token-default') && !href.includes('driveId=')) {
          return { ok: true, json: async () => ({ changes: [], newStartPageToken: 'start-token-default-2' }) };
        }
        if (href.includes('/changes') && href.includes('pageToken=start-token-1') && href.includes('driveId=drive-1') && href.includes('corpora=drive')) {
          return {
            ok: true,
            json: async () => ({
              newStartPageToken: 'start-token-2',
              changes: [{
                fileId: 'doc-777',
                time: '2026-03-17T03:00:00.000Z',
                file: {
                  id: 'doc-777',
                  name: 'JPYC Research',
                  mimeType: 'application/vnd.google-apps.document',
                  modifiedTime: '2026-03-17T03:00:00.000Z',
                  driveId: 'drive-1',
                  webViewLink: 'https://drive.google.com/file/d/doc-777/view',
                  owners: [{ displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' }],
                  lastModifyingUser: { displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' },
                },
              }],
            }),
          };
        }
        if (href.includes('docs.googleapis.com')) {
          return {
            ok: true,
            json: async () => ({
              body: {
                content: [{
                  paragraph: {
                    elements: [
                      { textRun: { content: 'Research summary ' } },
                      { textRun: { content: 'for JPYC launch readiness.' } },
                    ],
                  },
                }],
              },
            }),
          };
        }
        throw new Error(`Unhandled fetch ${url}`);
      },
      ingestEvents: ({ events }) => {
        ingestedEvents = events;
        return { event_count: events.length, candidate_count: 0, log_results: [] };
      },
    });

    collector.writeState({
      files: {},
      streams: {
        default: {
          page_token: 'start-token-default',
          start_page_token: 'start-token-default',
          new_start_page_token: null,
        },
        'shared:drive-1': {
          page_token: 'start-token-1',
          start_page_token: 'start-token-1',
          new_start_page_token: null,
        },
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.event_count, 1);
    assert.equal(ingestedEvents[0].object_id, 'doc-777');
    assert.equal(ingestedEvents[0].workspace_owner, 'jared');
    assert.match(ingestedEvents[0].summary, /JPYC launch readiness/);
  });

  it('backfills recent shared-drive files on first poll', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'drive-collector-'));
    let ingestedEvents = [];
    const collector = new DriveCollector({
      repoRoot,
      config: config(),
      auth: {
        isConfigured: () => true,
        accessToken: async () => 'token',
      },
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes('/changes/startPageToken') && !href.includes('driveId=')) {
          return { ok: true, json: async () => ({ startPageToken: 'start-token-default' }) };
        }
        if (href.includes('/changes/startPageToken') && href.includes('driveId=drive-1')) {
          return { ok: true, json: async () => ({ startPageToken: 'start-token-1' }) };
        }
        if (href.includes('/drive/v3/files') && !href.includes('driveId=')) {
          return { ok: true, json: async () => ({ files: [] }) };
        }
        if (href.includes('/drive/v3/files') && href.includes('driveId=drive-1')) {
          return {
            ok: true,
            json: async () => ({
              files: [{
                id: 'doc-888',
                name: 'FLOQ brief',
                mimeType: 'application/vnd.google-apps.document',
                modifiedTime: '2026-03-30T03:00:00.000Z',
                driveId: 'drive-1',
                webViewLink: 'https://drive.google.com/file/d/doc-888/view',
                owners: [{ displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' }],
                lastModifyingUser: { displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' },
              }],
            }),
          };
        }
        if (href.includes('docs.googleapis.com') && href.includes('/documents/doc-888')) {
          return {
            ok: true,
            json: async () => ({
              body: {
                content: [{
                  paragraph: {
                    elements: [{ textRun: { content: 'FLOQ partner update' } }],
                  },
                }],
              },
            }),
          };
        }
        throw new Error(`Unhandled fetch ${url}`);
      },
      ingestEvents: ({ events }) => {
        ingestedEvents = events;
        return { event_count: events.length, candidate_count: 0, log_results: [] };
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.event_count, 1);
    assert.equal(ingestedEvents[0].object_id, 'doc-888');
    assert.match(ingestedEvents[0].summary, /FLOQ partner update/);
  });

  it('enumerates files directly under allowlisted folders during backfill', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'drive-collector-'));
    let ingestedEvents = [];
    const collector = new DriveCollector({
      repoRoot,
      config: (() => {
        const cfg = config();
        cfg.drive.folders = ['folder-1'];
        return cfg;
      })(),
      auth: {
        isConfigured: () => true,
        accessToken: async () => 'token',
      },
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes('/changes/startPageToken') && !href.includes('driveId=')) {
          return { ok: true, json: async () => ({ startPageToken: 'start-token-default' }) };
        }
        if (href.includes('/changes/startPageToken') && href.includes('driveId=drive-1')) {
          return { ok: true, json: async () => ({ startPageToken: 'start-token-shared' }) };
        }
        if (href.includes('/changes') && href.includes('pageToken=start-token-default') && !href.includes('driveId=')) {
          return { ok: true, json: async () => ({ changes: [], newStartPageToken: 'start-token-default-2' }) };
        }
        if (href.includes('/drive/v3/files/folder-1')) {
          return {
            ok: true,
            json: async () => ({
              id: 'folder-1',
              name: 'Meetings',
              mimeType: 'application/vnd.google-apps.folder',
              modifiedTime: '2026-04-09T01:00:00.000Z',
              driveId: 'drive-1',
              owners: [{ displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' }],
              lastModifyingUser: { displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' },
            }),
          };
        }
        if (href.includes('/drive/v3/files') && href.includes('driveId=drive-1') && href.includes('folder-1')) {
          return {
            ok: true,
            json: async () => ({
              files: [{
                id: 'doc-folder-1',
                name: 'Meeting notes 2026-04-09',
                mimeType: 'application/vnd.google-apps.document',
                modifiedTime: '2099-04-09T01:00:00.000Z',
                driveId: 'drive-1',
                parents: ['folder-1'],
                webViewLink: 'https://drive.google.com/file/d/doc-folder-1/view',
                owners: [{ displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' }],
                lastModifyingUser: { displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' },
              }],
            }),
          };
        }
        if (href.includes('/drive/v3/files') && href.includes('driveId=drive-1')) {
          return {
            ok: true,
            json: async () => ({ files: [] }),
          };
        }
        if (href.includes('/drive/v3/files') && !href.includes('driveId=')) {
          return {
            ok: true,
            json: async () => ({ files: [] }),
          };
        }
        if (href.includes('docs.googleapis.com') && href.includes('/documents/doc-folder-1')) {
          return {
            ok: true,
            json: async () => ({
              body: {
                content: [{
                  paragraph: {
                    elements: [{ textRun: { content: 'Partner meeting memo for April 9.' } }],
                  },
                }],
              },
            }),
          };
        }
        throw new Error(`Unhandled fetch ${url}`);
      },
      ingestEvents: ({ events }) => {
        ingestedEvents = events;
        return { event_count: events.length, candidate_count: 0, log_results: [] };
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.event_count, 1);
    assert.equal(ingestedEvents[0].object_id, 'doc-folder-1');
    assert.match(ingestedEvents[0].summary, /Partner meeting memo/);
  });

  it('extracts docx text when an office text extractor is available', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'drive-collector-'));
    let ingestedEvents = [];
    const collector = new DriveCollector({
      repoRoot,
      config: config({ drive: { ...config().drive, initial_lookback_hours: 0 } }),
      auth: {
        isConfigured: () => true,
        accessToken: async () => 'token',
      },
      officeTextExtractor: () => 'FLOQ legal and risk review',
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes('/changes/startPageToken') && !href.includes('driveId=')) {
          return { ok: true, json: async () => ({ startPageToken: 'start-token-default' }) };
        }
        if (href.includes('/changes/startPageToken') && href.includes('driveId=drive-1')) {
          return { ok: true, json: async () => ({ startPageToken: 'start-token-shared' }) };
        }
        if (href.includes('/changes') && href.includes('pageToken=start-token-default') && !href.includes('driveId=')) {
          return { ok: true, json: async () => ({ changes: [], newStartPageToken: 'start-token-default-2' }) };
        }
        if (href.includes('/changes') && href.includes('pageToken=start-token-1') && href.includes('driveId=drive-1')) {
          return {
            ok: true,
            json: async () => ({
              newStartPageToken: 'start-token-2',
              changes: [{
                fileId: 'docx-1',
                time: '2026-03-27T13:52:13.000Z',
                file: {
                  id: 'docx-1',
                  name: 'SuperEarn - FLOQ Risk Report 20260305.docx',
                  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  modifiedTime: '2026-03-27T13:52:13.000Z',
                  driveId: 'drive-1',
                  size: 1234,
                  webViewLink: 'https://drive.google.com/file/d/docx-1/view',
                  owners: [{ displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' }],
                  lastModifyingUser: { displayName: 'Jared Lee', emailAddress: 'jared.lee@kaia.io' },
                },
              }],
            }),
          };
        }
        if (href.includes('/files/docx-1?alt=media')) {
          return {
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          };
        }
        throw new Error(`Unhandled fetch ${url}`);
      },
      ingestEvents: ({ events }) => {
        ingestedEvents = events;
        return { event_count: events.length, candidate_count: 0, log_results: [] };
      },
    });


    collector.writeState({
      files: {},
      streams: {
        default: {
          page_token: 'start-token-default',
          start_page_token: 'start-token-default',
          new_start_page_token: null,
        },
        'shared:drive-1': {
          page_token: 'start-token-1',
          start_page_token: 'start-token-1',
          new_start_page_token: null,
        },
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.event_count, 1);
    assert.match(ingestedEvents[0].summary, /FLOQ legal and risk review/);
  });

  it('returns missing_credentials when google auth is not configured', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'drive-collector-'));
    const collector = new DriveCollector({
      repoRoot,
      config: config(),
      auth: {
        isConfigured: () => false,
        accessToken: async () => 'token',
      },
      fetchImpl: async () => {
        throw new Error('fetch should not run without credentials');
      },
    });

    const result = await collector.pollOnce();

    assert.equal(result.reason, 'missing_credentials');
    assert.equal(result.event_count, 0);
  });
});
