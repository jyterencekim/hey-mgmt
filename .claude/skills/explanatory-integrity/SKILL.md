---
name: explanatory-integrity
description: Close every substantive response with a plain-language summary for a sharp non-specialist, preserving exact mechanics and trade-offs without jargon or oversimplification.
owner: charlie
applies_to: [any repo, coding, writing, ops, planning]
updated: 2026-10-26
---

# Explanatory Integrity

Every substantive response ends with a **"옆집 할머니도 알아들을 수 있게 요약" (plain-language summary)** block. It is more serious and honest than "explain it to me like I'm 7": it never talks down, never hides behind fairy-tale metaphors, and never oversimplifies away the real mechanism, constraint, or risk — while remaining immediately understandable to an intelligent non-specialist.

## When to use

- Always on for substantive responses across coding, writing, operations, analysis, decisions, and planning.
- Skip only for one-line mechanical acknowledgments, raw command/SQL dumps with no narrative, or trivial yes/no answers where a summary would repeat the single line verbatim.

## The Audience Benchmark ("옆집 할머니")

Write the closing summary for a sharp, attentive adult neighbor who has **zero context** on our repositories, internal acronyms, or software/financial jargon, yet has full adult common sense about money, rules, ledgers, locks, receipts, waiting lines, and cause-and-effect.

- **Not ELI7:** Do not use childish analogies, cartoons, or patronizing tone. Treat the reader as an intelligent adult.
- **No oversimplification:** Do not round off the hard edges. If a fix only covers one path, if a manual step remains, or if a trade-off was accepted, state that boundary plainly.
- **Full precision in plain words:** Keep the real causal chain and concrete numbers (time windows, amounts, conditions), translating only the specialized terms into what they actually do in the world.

## Placement and Format

Place the block at the very end of the response, in the same language as the response:

```markdown
---
**👵 옆집 할머니도 알아들을 수 있게 요약**
<2–4 sentences (or up to 3 short bullets) explaining what happened, why it mattered, and what constraint or next step remains.>
```

(In English responses, use `**👵 Plain-Language Summary**`.)

## Four Rules of Explanatory Integrity

1. **Translate mechanism, not just outcome.** Do not stop at "버그를 고쳤습니다" or "설정을 바꿨습니다." State *what was going wrong in real terms* and *how the new rule or mechanism prevents it*.
2. **Replace jargon with what the thing actually does.**
   - Instead of `subgraph indexing lag`, say "장부를 화면에 옮겨 적는 프로그램이 뒤처지는 현상".
   - Instead of `ERC-4626 share price rebase guard`, say "예치금 영수증 1장당 가치를 계산할 때 갑자기 숫자가 튀지 않도록 막는 안전장치".
   - Instead of `git pull --rebase before push`, say "내가 고친 문서를 공용 서류함에 넣기 전에, 다른 사람이 먼저 올려둔 최신 변경사항을 내 문서 밑바탕에 먼저 합치는 작업".
3. **Keep the honest caveat.** If something is still unverified, gated on another person's approval, or carries a trade-off, name it in one plain clause. Honesty beats neatness.
4. **Stay brief and dense.** Two to four sentences. Every sentence must carry cause, mechanism, or consequence — zero filler.

## Anti-patterns

- **The Jargon Echo:** Repeating the technical summary in slightly shorter sentences while leaving terms like ` frontmatter`, `RPC`, `keeper cron`, `PPS`, or `idempotent` unexplained.
- **The ELI7 Caricature:** "장난감 상자에 블록을 넣는 것처럼..." — metaphors that invent a fake story instead of explaining the actual system with everyday words.
- **The Dishonest Happy Ending:** Saying "이제 모든 문제가 해결되어 안전합니다" when the change only added an alarm, or only fixed the test environment while production still awaits approval.

## Examples

### Example 1 — Code / Ops Change (Korean)

- **Bad (Jargon):** `EarnJPYC Veda keeper cron에 FX holiday calendar 체크를 추가해 주말/휴일 비유동 구간에서 Rondo order 발행을 막았습니다.`
- **Bad (ELI7 Oversimplification):** `가게 문이 닫힌 날에는 심부름꾼이 헛걸음하지 않게 달력을 달아주었어요!`
- **Good (Explanatory Integrity):**
  > **👵 옆집 할머니도 알아들을 수 있게 요약**
  > 엔화(JPYC)를 달러로 바꾸는 자동 프로그램이 지금까지는 외환시장이 쉬는 주말이나 공휴일에도 환전 주문을 넣으려다 불필요한 실패 기록을 남겼습니다. 이제는 외환시장 휴일 달력을 먼저 확인해서, 시장이 실제로 열려 있을 때만 자동 환전 주문을 내도록 규칙을 추가했습니다. 다만 아직 자동 실행 스위치(크론)는 꺼져 있어서, 최종 점검이 끝난 뒤에야 실제로 켜집니다.

### Example 2 — Architecture / Accounting Analysis (English)

- **Bad (Jargon):** `Chain-1 conservation residual was caused by unbooked bridge fee deltas on sibling EOAs derived from the dev wallet seed.`
- **Bad (ELI7 Oversimplification):** `We found some missing coins hiding in another pocket, so the piggy bank adds up now!`
- **Good (Explanatory Integrity):**
  > **👵 Plain-Language Summary**
  > When we compared the money entering our vault against the money sitting in our investment accounts, the totals were off by a small amount. That happened because the transfer fees paid when moving funds across networks were being paid out of a secondary operational wallet that our accounting book wasn't tracking yet. Adding that secondary wallet's fee receipts to the ledger makes the books balance without changing any customer balances.
