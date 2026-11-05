import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtraFields, parseFieldValue } from '../field-parser.mjs';

describe('parseFieldValue()', () => {
  it('keeps plain scalars as strings', () => {
    assert.equal(parseFieldValue('2026-W10'), '2026-W10');
    assert.equal(parseFieldValue('SuperearnCore'), 'SuperearnCore');
  });

  it('parses arrays and objects safely', () => {
    assert.deepEqual(parseFieldValue('[jared, terence, oliver]'), ['jared', 'terence', 'oliver']);
    assert.deepEqual(parseFieldValue('{"type":"supports","target":"decision_x"}'), { type: 'supports', target: 'decision_x' });
  });
});

describe('parseExtraFields()', () => {
  it('parses multiple key=value pairs without naive comma splitting', () => {
    const fields = parseExtraFields([
      'attendees=[jared, terence, oliver, eb]',
      'start_at=2026-03-07T10:00:00Z',
      'end_at=2026-03-07T11:00:00Z'
    ]);

    assert.deepEqual(fields.attendees, ['jared', 'terence', 'oliver', 'eb']);
    assert.equal(fields.start_at, '2026-03-07T10:00:00Z');
    assert.equal(fields.end_at, '2026-03-07T11:00:00Z');
  });
});
