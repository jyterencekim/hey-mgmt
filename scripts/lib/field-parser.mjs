import { parse as parseYaml } from 'yaml';

function normalizeParsedValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeParsedValue(entry));
  }

  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = normalizeParsedValue(entry);
    }
    return out;
  }

  return value;
}

function shouldParseStructuredValue(raw) {
  if (!raw) return false;
  if (/^[\[{]/.test(raw)) return true;
  if (/^(true|false|null)$/i.test(raw)) return true;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return true;
  if (/^['"].*['"]$/.test(raw)) return true;
  return false;
}

export function parseFieldValue(raw) {
  const value = String(raw ?? '').trim();
  if (!shouldParseStructuredValue(value)) {
    return value;
  }

  try {
    return normalizeParsedValue(parseYaml(value));
  } catch (error) {
    throw new Error(`invalid field value '${value}': ${error.message}`);
  }
}

export function parseExtraFields(pairs = []) {
  const extraFields = {};

  for (const pair of pairs) {
    const eq = String(pair).indexOf('=');
    if (eq === -1) continue;

    const key = String(pair).slice(0, eq).trim();
    const rawValue = String(pair).slice(eq + 1).trim();
    if (!key) continue;

    extraFields[key] = parseFieldValue(rawValue);
  }

  return extraFields;
}
