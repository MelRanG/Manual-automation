# Harness Engineering Policy

이 문서는 Claude Code 세션에서 개발 품질을 체계적으로 보장하기 위한 실행 정책이다.
모든 비자명한 작업은 이 정책의 루프를 따른다.

## 원칙

1. **증거 없이 완료 주장 금지.** 코드가 컴파일된다 ≠ 기능이 완성됐다.
2. **최소 구현.** 요청하지 않은 기능, 추상화, 설정 가능성을 넣지 않는다.
3. **테스트가 먼저.** 실패하는 테스트 없이 프로덕션 코드를 작성하지 않는다.
4. **외과적 변경.** 요청과 직접 연결되지 않는 줄을 바꾸지 않는다.
5. **루프는 닫힌다.** 모든 작업은 검증 가능한 완료 조건을 갖고, 조건 충족까지 반복한다.

---

## 실행 루프

```
┌─────────────────────────────────────────────────────┐
│  1. DESIGN   (brainstorming → spec)                 │
│  2. PLAN     (writing-plans → task backlog)          │
│  3. BUILD    (subagent-driven-development / TDD)     │
│  4. VERIFY   (verification-before-completion)        │
│  5. SHIP     (finishing-a-development-branch)        │
└─────────────────────────────────────────────────────┘
       ↑                                    │
       └──── FAIL at any gate ──────────────┘
```

각 단계는 다음 단계로 넘어가기 전에 게이트를 통과해야 한다.

---

## 1. DESIGN (설계)

**트리거:** 새 기능, 기존 동작 변경, 아키텍처 결정이 필요한 작업
**스킬:** `superpowers:brainstorming`

### 게이트 조건
- [ ] 프로젝트 현재 상태 탐색 완료
- [ ] 사용자와 질문/답변으로 요구사항 명확화
- [ ] 2~3개 접근법 제시 + 트레이드오프 설명
- [ ] 사용자가 설계를 승인함
- [ ] spec 문서 저장: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- [ ] spec self-review 통과 (placeholder, 모순, 모호성 없음)

### 스킵 조건
단순 버그 수정, 1~2줄 변경, 설정 변경처럼 설계 판단이 불필요한 작업은 바로 3단계(BUILD)로.

---

## 2. PLAN (계획)

**트리거:** 설계 승인 후, 또는 3개 이상의 파일을 수정하는 작업
**스킬:** `superpowers:writing-plans`

### 산출물
- 계획 문서: `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`
- 각 Task는 2~5분 단위의 bite-sized step
- 모든 step에 실제 코드, 정확한 파일 경로, 실행 명령 포함
- placeholder ("TBD", "TODO", "적절히 처리") 금지

### 게이트 조건
- [ ] 파일 구조 맵 (생성/수정 대상 전체)
- [ ] 각 Task에 검증 명령과 기대 결과 명시
- [ ] self-review 통과 (spec 커버리지, placeholder, 타입 일관성)
- [ ] 사용자 승인

### 스킵 조건
단일 Task로 완료 가능한 작업은 계획 없이 바로 BUILD.

---

## 3. BUILD (구현)

**스킬 (택 1):**
- `superpowers:subagent-driven-development` — Task가 독립적이고 subagent 사용 가능할 때 (권장)
- `superpowers:executing-plans` — 순차 실행이 필요하거나 단순할 때

### TDD 강제
모든 구현은 `superpowers:test-driven-development` 사이클을 따른다:

```
RED   → 실패하는 테스트 작성
       → 실패 확인 (반드시 실행)
GREEN → 테스트를 통과시키는 최소 코드
       → 통과 확인 (반드시 실행)
REFACTOR → 테스트 녹색 유지하며 정리
```

### Subagent 워크플로우 (권장)
```
Task 시작
  → Implementer subagent 디스패치 (TDD로 구현 + 셀프리뷰)
  → Spec Reviewer subagent (spec 준수 확인)
     → FAIL → Implementer가 수정 → 재리뷰
  → Code Quality Reviewer subagent (코드 품질)
     → FAIL → Implementer가 수정 → 재리뷰
  → 양쪽 PASS → Task 완료
다음 Task로
```

### 게이트 조건
- [ ] 모든 새 함수/메서드에 테스트 존재
- [ ] 각 테스트의 RED→GREEN 사이클 확인됨
- [ ] 전체 테스트 스위트 통과
- [ ] lint/typecheck 통과
- [ ] mock/fake/placeholder/TODO/Math.random 없음 (테스트 제외)

### 금지 사항
- 테스트 없이 프로덕션 코드 작성
- 테스트를 나중에 추가하겠다는 약속
- "이 정도면 됐다"는 추정 기반 완료
- 기존 코드의 무관한 개선

---

## 4. VERIFY (검증)

**스킬:** `superpowers:verification-before-completion`

이 단계는 BUILD 완료 직후, 커밋/PR 전에 반드시 실행한다.

### 검증 프로토콜

```
1. IDENTIFY — 이 완료 주장을 증명할 명령은?
2. RUN      — 해당 명령을 지금 실행
3. READ     — 전체 출력 확인, exit code 확인
4. JUDGE    — 출력이 완료를 입증하는가?
   YES → 증거와 함께 완료 보고
   NO  → 실제 상태 보고, BUILD로 복귀
```

### 필수 검증 목록

| 주장 | 필요 증거 | 불충분 |
|------|-----------|--------|
| 테스트 통과 | 테스트 명령 출력: 0 failures | 이전 실행, "통과할 것" |
| 빌드 성공 | 빌드 명령: exit 0 | lint만 통과 |
| 버그 수정 | 원래 증상 재현 → 수정 후 통과 | 코드 변경만 |
| 기능 완료 | AC 항목별 증거 | 테스트만 통과 |

### 금지 표현
검증 없이 사용 불가:
- "완료", "수정됨", "통과", "성공"
- "~할 것", "~일 듯", "아마"
- "Great!", "Perfect!", "Done!"

---

## 5. SHIP (완료)

**스킬:** `superpowers:finishing-a-development-branch`

### 프로세스
1. 전체 테스트 스위트 실행 (frontend + backend)
2. lint + typecheck 통과 확인
3. git status 확인 (불필요한 파일 없는지)
4. 사용자에게 옵션 제시:
   - Merge to main
   - PR 생성
   - 추가 작업 계속

### 게이트 조건
- [ ] `cd frontend && pnpm build` — exit 0
- [ ] `cd frontend && pnpm lint` — 0 errors
- [ ] `cd backend && uv run pytest` — 0 failures
- [ ] `cd backend && uv run ruff check` — 0 errors
- [ ] `cd backend && uv run mypy .` — 0 errors
- [ ] git diff에 의도하지 않은 변경 없음

---

## 디버깅

**트리거:** 테스트 실패, 예상치 못한 동작, 에러
**스킬:** `superpowers:systematic-debugging`

### 프로토콜
1. 증상 정확히 기술 (에러 메시지, 재현 단계)
2. 가설 수립 (최소 2개)
3. 가설 검증 (가장 가능성 높은 것부터)
4. 근본 원인 확인
5. 수정은 TDD로 (실패 테스트 → 수정 → 통과)

### 금지
- 원인 파악 전 코드 수정
- "이게 문제인 것 같다"로 추정 수정
- 같은 수정을 3회 이상 반복 시도

---

## 워크트리 정책

**스킬:** `superpowers:using-git-worktrees`

### 사용 조건
- 기능 개발 시 main 보호를 위해 사용
- 실험적 변경이 기존 코드를 망칠 위험이 있을 때
- 병렬 작업이 필요할 때

### 브랜치 네이밍
```
feat/<feature-name>
fix/<bug-description>
refactor/<target>
```

---

## 코드 리뷰

### 요청 시
**스킬:** `superpowers:requesting-code-review`
- 주요 기능 완료 후, merge 전에 실행
- 리뷰어에게 변경 요약 + 주의 포인트 전달

### 수신 시
**스킬:** `superpowers:receiving-code-review`
- 피드백을 무조건 수용하지 않음
- 기술적으로 검증한 뒤 적용

---

## 실패 처리

### 3-Strike 규칙
- 같은 검증 항목이 3회 FAIL → 한 단계 위로 복귀
  - BUILD에서 3 FAIL → PLAN 재검토
  - PLAN에서 해결 불가 → DESIGN 재개
  - DESIGN에서 막힘 → 사용자에게 질문

### 피드백 기록
반복 실수 발견 시:
1. 실패 패턴을 `CLAUDE.md`에 규칙으로 추가
2. 해당 패턴을 잡는 테스트 추가
3. 가능하면 lint 규칙이나 pre-commit hook으로 자동화

---

## 트리거 문구

| 문구 | 동작 |
|------|------|
| `기획해` / `설계해` | DESIGN 단계부터 시작 |
| `계획 세워` / `플랜 짜줘` | PLAN 단계부터 시작 |
| `만들어` / `구현해` | BUILD 단계 (단순하면 직접, 복잡하면 PLAN부터) |
| `고쳐` / `버그 수정` | systematic-debugging → TDD fix |
| `리뷰해` | requesting-code-review |
| `검증해` / `확인해` | verification-before-completion |
| `마무리해` | finishing-a-development-branch |

---

## 모델 배정 가이드

| 역할 | 권장 모델 | 이유 |
|------|-----------|------|
| 설계/리뷰/아키텍처 판단 | Opus | 넓은 맥락 이해, 트레이드오프 판단 |
| 구현 (단순, 1~2 파일) | Sonnet/Haiku | 빠르고 비용 효율적 |
| 구현 (복합, 다수 파일) | Sonnet | 속도와 품질 균형 |
| 디버깅 | Opus | 근본 원인 추적에 강함 |
| Spec/Quality 리뷰 | Opus | 빈틈 없는 검증 |

---

## 이 정책이 작동하는 신호

- diff에 불필요한 변경이 없다
- 완료 주장에 항상 실행 증거가 붙는다
- 오버엔지니어링으로 인한 재작업이 줄었다
- 테스트가 실패한 뒤에야 코드가 작성된다
- 사용자가 "이거 왜 바꿨어?"라고 묻는 일이 없다

## 이 정책이 실패하는 신호

- "통과할 것"이라는 추정이 등장
- 테스트 없이 "간단한 수정"이 들어감
- 한 번에 5개 이상 파일이 변경되는데 계획이 없음
- mock/placeholder가 프로덕션에 남아있음
- 같은 버그가 두 번 이상 발생
