import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function readGatewayToken() {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), '.hermes', 'hermes.json'), 'utf8'));
    return config?.gateway?.auth?.token ?? '';
  } catch {
    return '';
  }
}

const BASE_URL = process.env.HERMES_BASE_URL ?? 'http://localhost:18789';
const AUTH_TOKEN = process.env.HERMES_AUTH_TOKEN || readGatewayToken();
const DEFAULT_MODEL = process.env.HERMES_MODEL ?? 'hermes/default';
const BACKEND_MODEL = process.env.HERMES_BACKEND_MODEL ?? 'openai-codex/gpt-5.4';

function buildHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    'x-hermes-model': BACKEND_MODEL,
  };
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  return headers;
}

export async function chatCompletion({ messages, model, temperature, maxTokens }) {
  const body = {
    model: model ?? DEFAULT_MODEL,
    messages,
    ...(temperature !== undefined && { temperature }),
    ...(maxTokens !== undefined && { max_tokens: maxTokens }),
  };

  const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Hermes request failed: ${response.status} ${response.statusText}\n${text}`);
  }

  return response.json();
}

function parseJsonFromLlmResponse(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse JSON from LLM response:\n${text}`);
  }
}

export async function classifyAndSummarize({ sourceText, title, source, linkedContent }) {
  const systemPrompt = `You are a knowledge-base curator for a team. Classify and summarize content for durable team knowledge preservation.

Artifact types (choose exactly one):
- decision: Actual decisions only — ADRs, policy confirmations. NOT meeting notes that merely mention decisions.
- meeting: Meeting notes or meeting summaries.
- task: Action items, follow-ups, todos with a clear owner or deadline.
- playbook: How-to guides, procedures, runbooks, step-by-step instructions.
- note: Everything else.

Domain tags (choose exactly one): product, research, gtm, operations, legal

Return ONLY valid JSON matching this schema exactly:
{
  "worth_distilling": boolean,
  "confidence": number (0–1),
  "reasons": string[],
  "artifact_type": "decision" | "meeting" | "task" | "playbook" | "note" | null,
  "domain_tag": "product" | "research" | "gtm" | "operations" | "legal" | null,
  "title": string | null,
  "summary_points": string[],
  "skip_reason": string | null
}

Set worth_distilling to false (with a skip_reason) if the content is too short, trivial, a one-liner, or not worth preserving as durable team knowledge.`;

  const parts = [`Title: ${title ?? '(none)'}`, `Source: ${source ?? '(none)'}`];
  if (linkedContent) parts.push(`Linked context:\n${linkedContent}`);
  parts.push(`Content:\n${sourceText}`);

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: parts.join('\n\n') },
  ];

  const result = await chatCompletion({ messages, temperature: 0.2 });
  const raw = result.choices?.[0]?.message?.content ?? '';
  return parseJsonFromLlmResponse(raw);
}

export async function generateContentUpdateDraft({ artifactTitle, artifactBody, sourceText, eventTitle, eventSource }) {
  const systemPrompt = `You are updating a team knowledge-base artifact with new information from an external source.

Given:
- The EXISTING artifact content (title + body)
- NEW source content from an external event (Slack, Confluence, Google Drive)

Your job: extract ONLY the new, useful information from the source that is NOT already in the artifact, and produce a concise update.

Rules:
- Do NOT repeat information already in the artifact
- Do NOT rewrite the entire artifact — only produce the NEW additions
- Keep updates concise and factual
- Use bullet points for progress updates
- Include dates when available
- Write in the same language as the artifact (Korean or English)
- If the source contains no new useful information, say so

Return ONLY valid JSON:
{
  "has_new_info": boolean,
  "section": string,
  "content": string,
  "summary": string
}

- has_new_info: false if the source adds nothing new to the artifact
- section: which section to append to (e.g. "Progress", "Context", "Notes", "External Signals"). Pick the most appropriate existing section, or suggest "Progress" for task updates
- content: the markdown content to APPEND to that section (not the full section)
- summary: one-line Korean summary of what changed (for Slack notification)`;

  const userMessage = [
    `Existing artifact: "${artifactTitle}"`,
    `---`,
    artifactBody.slice(0, 50000),
    `---`,
    ``,
    `New source: [${eventSource}] ${eventTitle}`,
    `---`,
    sourceText.slice(0, 50000),
  ].join('\n');

  try {
    const result = await chatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.2,
    });
    const raw = result.choices?.[0]?.message?.content ?? '';
    return parseJsonFromLlmResponse(raw);
  } catch (err) {
    console.error('[generateContentUpdateDraft] LLM call failed:', err.message);
    return { has_new_info: false, section: null, content: null, summary: `LLM error: ${err.message}` };
  }
}

export async function matchToExistingArtifact({ event, candidates, sourceText }) {
  const systemPrompt = `You are matching an external event to existing artifacts in a team knowledge base.

Given an incoming event from an external tool (Slack, Confluence, Google Drive) and a list of existing artifacts, determine whether this event is an update related to one of the existing artifacts.

Match criteria:
- The event and artifact should be about the SAME topic, project feature, or work item
- Title overlap, entity overlap, or topical continuity are strong signals
- Source type compatibility matters: a Drive document update likely matches a task or note about the same topic
- Do NOT match if the event is only tangentially related
- Consider Korean and English titles referring to the same topic as matches

Return ONLY valid JSON:
{
  "matched": boolean,
  "confidence": number (0-1),
  "artifact_id": string | null,
  "artifact_title": string | null,
  "match_reason": string
}

Rules:
- Set matched=true ONLY if confidence >= 0.7
- If no artifact is a strong match, set matched=false with confidence < 0.7
- artifact_id must be the exact id from the candidate list, or null if no match`;

  const candidateList = candidates
    .map((c, i) => `${i + 1}. id="${c.id}" type=${c.type} title="${c.title}" status=${c.status ?? '-'}`)
    .join('\n');

  const parts = [
    `Event:`,
    `- Source: ${event.source}`,
    `- Type: ${event.object_type}`,
    `- Title: ${event.object_title}`,
    `- Summary: ${event.summary}`,
  ];
  if (sourceText) parts.push(`\nSource text (excerpt):\n${sourceText.slice(0, 2000)}`);
  parts.push(`\nExisting artifacts (${candidates.length}):\n${candidateList}`);

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: parts.join('\n') },
  ];

  try {
    const result = await chatCompletion({ messages, temperature: 0.1 });
    const raw = result.choices?.[0]?.message?.content ?? '';
    return parseJsonFromLlmResponse(raw);
  } catch (err) {
    console.error('[matchToExistingArtifact] LLM call failed:', err.message);
    return { matched: false, confidence: 0, artifact_id: null, match_reason: `LLM error: ${err.message}` };
  }
}

export async function classifyDomain({ content, title, areaField, tags }) {
  const systemPrompt = `You are classifying content into a domain tag for a team knowledge base.

Domain tags:
- product: Product features, UX, roadmap, specs
- research: User research, market analysis, data studies
- gtm: Go-to-market, marketing, sales, growth, BD
- operations: Internal ops, infra, processes, legal-adjacent ops
- legal: Contracts, compliance, regulatory, legal counsel
- general: Does not clearly fit any above category

Return ONLY valid JSON:
{ "domain_tag": "product" | "research" | "gtm" | "operations" | "legal" | "general" }`;

  const parts = [];
  if (title) parts.push(`Title: ${title}`);
  if (areaField) parts.push(`Area: ${areaField}`);
  if (tags?.length) parts.push(`Tags: ${tags.join(', ')}`);
  parts.push(`Content:\n${content}`);

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: parts.join('\n\n') },
  ];

  const result = await chatCompletion({ messages, temperature: 0.1 });
  const raw = result.choices?.[0]?.message?.content ?? '';
  return parseJsonFromLlmResponse(raw);
}
