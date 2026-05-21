# Playwright 자연어 클릭 매칭 개선 Design

**Date:** 2026-05-21
**Author:** Phase 2 후속 작업
**Status:** Approved (brainstorming)

---

## 1. Problem

`backend/app/services/manual_service.py`의 매뉴얼 자동 생성 시, 사용자가 입력한 시나리오 step 자연어가 좁은 suffix 룰과 단순 a→button→text 직렬 분기로 매칭되어 다음 같은 입력에서 실패한다:

- `"Demo Admin 버튼 클릭..."` — trailing `"..."`와 `"버튼"` descriptor가 그대로 남아 어떤 locator에도 안 잡힘
- `"메뉴를 선택해"` — `"를"` 조사 + `"선택해"` 활용형 미처리
- `"뉴스 페이지 이동"` — `"이동"` suffix가 list에 있지만 동사 활용형은 미지원

실패 시 screenshot description에 `"(클릭 실패)"`만 표기되어 원인 추적이 어려움.

## 2. Goal

- 일반적인 한국어 자연어 step에서 click target text를 안정적으로 추출
- 추출된 target에 대해 다양한 locator 전략을 cascade로 시도
- 실패 사유를 구조적으로 로그/UI 양쪽에 노출
- pure function 단위 테스트로 추출 로직 회귀 방지

## 3. Non-Goals

- LLM 호출 도입 (외부 의존/비용/지연 회피 — 룰만으로 충분한 케이스 수준)
- 일반 액션(입력/검색/스크롤)으로의 확장 — click만
- 영문 자연어 광범위 지원 — `click`, `tap` 정도만 인식

## 4. Design

### 4.1 추출 — `_extract_click_target(step: str) -> str`

순차 정규화 단계:

1. **우측 trim**: 공백, 마침표, 말줄임표(`...`, `…`), 이모지/특수문자 제거
2. **동작 어미 절단** (정규식 한 번):
   ```
   (을|를|으로|로)?\s*(클릭|선택|이동|진입|들어가기|누르기|tap|click)(하기|하세요|해|해요|함)?$
   ```
   `re.IGNORECASE`. 일치 부분 제거.
3. **Descriptor 절단** (정규식):
   ```
   \s*(버튼|링크|메뉴|탭|항목|아이콘|박스|카드)$
   ```
   단, 절단 결과가 빈 문자열이면 **descriptor 유지** (e.g. `"메뉴"` 단독 입력).
4. **trim** 후 반환. 빈 문자열이면 원본 step의 trim 결과 반환 (안전 fallback).

#### 예시 입출력

| 입력 | 출력 |
|---|---|
| `"Demo Admin 버튼 클릭..."` | `"Demo Admin"` |
| `"Demo Admin 버튼 클릭"` | `"Demo Admin"` |
| `"메뉴를 선택해"` | `"메뉴"` |
| `"뉴스 페이지 이동"` | `"뉴스 페이지"` |
| `"장바구니 항목"` | `"장바구니"` |
| `"메뉴"` | `"메뉴"` |
| `"뉴스 클릭"` | `"뉴스"` |
| `"Sign In click"` | `"Sign In"` |

### 4.2 Locator cascade — `_find_click_locator(page, target) -> tuple[locator|None, str]`

새 helper. 순차 시도하고 최초 visible 후보 반환. 반환은 `(locator, reason)` 또는 `(None, reason)`.

```
strategies = [
    ("role=link",    page.get_by_role("link",   name=re.compile(re.escape(target), re.I))),
    ("role=button",  page.get_by_role("button", name=re.compile(re.escape(target), re.I))),
    ("a:has-text",   page.locator(f'a:has-text("{target}")')),
    ("button:has-text", page.locator(f'button:has-text("{target}")')),
    ("text",         page.get_by_text(target, exact=False)),
    ("aria-label",   page.locator(f'[aria-label*="{target}" i]')),
    ("title",        page.locator(f'[title*="{target}" i]')),
]
```

각 strategy에 대해 `.first.is_visible(timeout=1000)` 검사. 매칭되면 `(locator, f"matched: {strategy_name}")` 반환.

모두 실패 시 **partial token fallback**:
- `target.split()`에서 길이 > 1인 토큰들을 추출
- 토큰이 2개 이상이면, 각 토큰에 대해 `role=link/button/text` 3종만 재시도 (timeout=800)
- 매칭 시 `(locator, f"matched: partial '{token}' via {strategy_name}")` 반환

모두 실패 시 `(None, f"'{target}' 일치 요소 없음")`.

### 4.3 호출부 변경 (`manual_service.py` 165~206)

기존:
```python
locator = page.locator(f'a:has-text("{click_target}")').first
if not await locator.is_visible(timeout=1500):
    locator = page.locator(f'button:has-text("{click_target}")').first
if not await locator.is_visible(timeout=1000):
    locator = page.get_by_text(click_target, exact=False).first

if await locator.is_visible(timeout=2000):
    ...
```

신규:
```python
locator, match_reason = await _find_click_locator(page, click_target)
if locator is not None:
    logger.info(f"manual click {match_reason} for step '{step}' → '{click_target}'")
    box = await locator.bounding_box()
    ...
    clicked = True
else:
    logger.warning(f"manual click failed for step '{step}': {match_reason}")
    fail_reason = match_reason
```

`clicked=False` branch에서 description을 `f"{step} (클릭 실패: {fail_reason})"`로 갱신 (`fail_reason` 없으면 기존 `"(클릭 실패)"` 유지).

### 4.4 옵저버빌리티

- `logger.info`: 성공 시 어떤 strategy로 매칭됐는지 (디버깅용)
- `logger.warning`: 실패 시 target + reason
- description: 사용자 친화 원인 텍스트 (`"… (클릭 실패: 'Demo Admin' 일치 요소 없음)"`)

### 4.5 단위 테스트

`backend/tests/test_extract_click_target.py` (신규):

- pure function 호출, Playwright 불필요
- 케이스 ~10건 (위 4.1 예시 + edge: 빈 문자열, 공백만, 다중 공백, 영문)
- `parametrize`로 입출력 매핑

`_find_click_locator`는 실제 `page` 객체 의존 → 자동 테스트 어려움. **수동 회귀**로 검증:
1. 데모 페이지에 "Demo Admin 버튼 클릭" 시나리오 실행
2. 성공 + description에 "(클릭 위치)" 노출 확인

## 5. 데이터 흐름

```
scenario_steps: list[str]
  │
  ▼
for each step:
  step → _extract_click_target → click_target
              │
              ▼
        _find_click_locator(page, click_target)
              │
       ┌──────┴──────┐
       ▼             ▼
   locator       (None, reason)
       │             │
       ▼             ▼
   click + screenshot   description = "(클릭 실패: reason)"
```

## 6. 에러 처리

- `_find_click_locator` 내부의 각 strategy 검사는 try/except로 감싸서 다음 후보로 이동
- click 자체 실패(navigation timeout 등)는 기존 try/except 패턴 유지
- 모든 후보 실패는 정상 흐름 (예외 아님), description으로 표면화

## 7. 영향 범위

- `backend/app/services/manual_service.py`:
  - `_extract_click_target` 본문 교체
  - `_find_click_locator` 신규 추가
  - 시나리오 step 루프 (165~206) 교체
- `backend/tests/test_extract_click_target.py`: 신규
- 다른 파일/엔드포인트/모델 변경 없음

## 8. 검증

- `uv run pytest tests/test_extract_click_target.py -v` → 모든 케이스 PASS
- `uv run pytest` → 신규 회귀 없음 (기존 baseline 유지)
- 수동: 실제 데모 페이지 1건에 "Demo Admin 버튼 클릭" 시나리오로 실패 → 성공 전환 확인

## 9. Out of Scope

- 시나리오 step "X에 Y 입력" (입력 액션)
- "스크롤", "대기" 등 비클릭 액션
- 클릭한 요소가 새 창 열림 외 다른 부수효과 핸들링 (이미 기존 코드 일부 처리 중)
- 다국어(영문/일문) 광범위 지원 — 영문은 `click`/`tap` 동사만 인식
