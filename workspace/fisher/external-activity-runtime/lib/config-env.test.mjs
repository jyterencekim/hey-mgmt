import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { loadHermesSlackToken } from './config.mjs';

describe('loadHermesSlackToken', () => {
  it('loads only the Slack token from the selected Hermes profile and preserves an existing token', () => {
    const home = mkdtempSync(resolve(tmpdir(), 'hermes-slack-env-'));
    const oldHome = process.env.HERMES_HOME;
    const oldToken = process.env.SLACK_BOT_TOKEN;
    const oldOther = process.env.OTHER_SECRET;
    try {
      mkdirSync(home, { recursive: true });
      writeFileSync(resolve(home, '.env'), 'SLACK_BOT_TOKEN=test-token\nOTHER_SECRET=must-not-load\n');
      process.env.HERMES_HOME = home;
      delete process.env.SLACK_BOT_TOKEN;
      delete process.env.OTHER_SECRET;
      loadHermesSlackToken();
      assert.equal(process.env.SLACK_BOT_TOKEN, 'test-token');
      assert.equal(process.env.OTHER_SECRET, undefined);
      process.env.SLACK_BOT_TOKEN = 'existing-token';
      loadHermesSlackToken();
      assert.equal(process.env.SLACK_BOT_TOKEN, 'existing-token');
    } finally {
      for (const [key, value] of [['HERMES_HOME', oldHome], ['SLACK_BOT_TOKEN', oldToken], ['OTHER_SECRET', oldOther]]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(home, { recursive: true, force: true });
    }
  });
});
