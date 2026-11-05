---
id: playbook_style-guide
type: playbook
title: 'Style Guide: Elements for This Repo'
created_at: '2026-04-07'
updated_at: '2026-04-07'
playbook_version: 1.0.0
owner: team
status: active
tags:
  - Documentation
  - Operations
relations:
  - type: supports
    target: playbook_golden-principles
  - type: supports
    target: playbook_operating-philosophy
sources:
  - kind: book
    ref: 'Strunk, William Jr.; White, E.B. The Elements of Style'
    title: Concise writing principles
---

# Style Guide: Elements for This Repo

Write clearly, briefly, and consistently. Prefer rules over exceptions. These conventions apply to all English-language artifacts and docs in this repo.

## Core Rules

- Prefer short sentences; remove needless words.
- Use active voice; name the actor when helpful.
- Put statements in positive form; avoid double negatives.
- Use definite, specific, concrete language.
- One idea per sentence; one topic per paragraph.
- Prefer present tense and imperative mood for instructions.
- Keep parallel structure in lists and headings.

## Structure and Formatting

- Headings: 1–3 words, Title Case, no trailing punctuation.
- Bullets: use `-` with short lines; avoid deep nesting.
- Code/paths/commands: wrap in backticks.
- Dates: `YYYY-MM-DD`; Iteration: `YYYY-WNN`.
- Frontmatter: minimal required fields; nonstandard fields use `x_*`.
- Links: prefer repo-relative paths over external URLs when possible.

## Word Choice

- Prefer simple words over jargon; define terms once.
- Use consistent terms; don’t invent synonyms for the same concept.
- Use the shared vocab (`content/vocab/`) for tags, entities, owners.
- Avoid weasel words (might, maybe, somewhat) in decisions and playbooks.
- Avoid filler (very, basically, actually) unless clarifying.

## Tone

- Direct, neutral, and instructional.
- Avoid rhetorical questions; state the rule.
- Examples are short and concrete.

## Normative Keywords

- Use RFC 2119 keywords for policy strength.
- Capitalize: MUST, MUST NOT, SHOULD, SHOULD NOT, MAY.
- Use sparingly and consistently:
  - MUST — non‑negotiable requirement.
  - SHOULD — strong recommendation; deviations are rare and justified.
  - MAY — optional behavior.
- Prefer “MUST” when capitalization increases agent compliance.

## Examples

- Weak: “It would be a good idea to maybe consider splitting big tasks.”
- Strong: “Split tasks that don’t fit a 1-week iteration.”

## Enforcement

- Humans: review PRs for style.
- Agents: rewrite drafts to follow this guide.
- When unsure, choose brevity and clarity.
