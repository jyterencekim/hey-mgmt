---
id: playbook_style-guide-ko
type: playbook
title: '스타일 가이드: 이 레포의 문체'
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
    title: 간결한 글쓰기 원칙
---

# 스타일 가이드: 이 레포의 문체

짧고 명확하고 일관되게 씁니다. 규칙을 우선합니다. 이 가이드는 레포의 한국어 문서/아티팩트 전반에 적용됩니다.

## 핵심 원칙

- 짧은 문장; 불필요한 말을 뺍니다.
- 능동태를 우선; 주체가 도움이 되면 명시합니다.
- 긍정형으로 서술; 이중 부정을 피합니다.
- 구체적이고 명확한 어휘를 씁니다.
- 문장 하나엔 생각 하나; 문단 하나엔 주제 하나.
- 지시문은 현재형/명령형을 기본으로 합니다.
- 목록은 병렬 구조를 유지합니다.

## 구조와 형식

- 제목: 1–3단어, Title Case, 문장부호 없음.
- 불릿: `-` 사용, 짧게; 깊은 중첩은 피합니다.
- 코드/경로/명령어: 백틱으로 감쌉니다.
- 날짜: `YYYY-MM-DD`; 이터레이션: `YYYY-WNN`.
- 프론트매터: 최소 필수 필드만; 비표준은 `x_*` 접두사.
- 링크: 가능하면 레포 상대 경로를 우선합니다.

## 어휘 선택

- 쉬운 단어를 우선; 용어는 한 번 정의합니다.
- 같은 개념에는 같은 용어를 씁니다; 동의어 남발 금지.
- 태그/엔티티/오너는 `content/vocab/`를 따릅니다.
- 결정/플레이북에서 모호어(아마, 어느 정도 등)는 피합니다.
- 군더더기(매우, 사실은 등)는 필요할 때만 씁니다.

## 톤

- 직접적, 중립적, 지시형.
- 수사의문문을 피하고 규칙을 단정적으로 씁니다.
- 예시는 짧고 구체적으로 듭니다.

## 규범 키워드 (Normative)

- 정책 강도를 표시할 때 RFC 2119 키워드를 사용합니다.
- 대문자 표기: MUST, MUST NOT, SHOULD, SHOULD NOT, MAY.
- 한국어 문서에서는 필요 시 병기합니다: 반드시(MUST), 권장(SHOULD), 선택(MAY).
- 에이전트 준수율을 높일 때는 MUST 대문자 표기를 우선합니다.

## 예시

- 나쁨: “큰 작업은 쪼개면 좋을 것 같습니다.”
- 좋음: “1주 이터레이션에 안 맞으면 작업을 쪼갭니다.”

## 적용

- 사람: PR 리뷰에서 문체 확인.
- 에이전트: 초안을 가이드에 맞게 재작성.
- 애매하면, 간결성과 명확성을 우선.
