import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function stableHash(value) {
  const input = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
}

export function excerpt(text, limit = 140) {
  const normalized = normalizeText(text).replace(/\s+/g, ' ');
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

export function decodeHtmlEntities(text) {
  return String(text ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

export function htmlToText(html) {
  const withoutTags = String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|tr|h[1-6]|div|section|article|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');
  return normalizeText(
    decodeHtmlEntities(withoutTags)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
  );
}

export function writeTextFile(path, text) {
  ensureDir(dirname(path));
  writeFileSync(path, `${normalizeText(text)}\n`, 'utf8');
  return path;
}

export function lower(value) {
  return String(value ?? '').trim().toLowerCase();
}
