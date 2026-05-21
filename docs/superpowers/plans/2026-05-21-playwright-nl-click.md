# Playwright 자연어 클릭 매칭 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `backend/app/services/manual_service.py`의 시나리오 step 자연어 처리 강화로 click target 매칭률을 높이고, 실패 사유를 사용자/로그 양쪽에 노출한다.

**Architecture:** `_extract_click_target`을 정규식 기반 다단 정규화로 교체하고, 새 helper `_find_click_locator`가 role/text/attr/partial-token cascade로 visible locator를 탐색한다. 호출부는 cascade 결과를 받아 logger 출력과 description 갱신을 일원화한다.

**Tech Stack:** Python 3.12 · Playwright (async) · pytest · pytest-asyncio

**Spec:** `docs/superpowers/specs/2026-05-21-playwright-nl-click-design.md`

---

## File Structure

**Backend (modify):**
- `backend/app/services/manual_service.py`
  - `_extract_click_target` 본문 교체 (line 260~)
  - `_find_click_locator` 신규 추가 (parent function 외부)
  - 시나리오 step 루프 (line 165~206) 클릭 분기 교체

**Backend (create):**
- `backend/tests/test_extract_click_target.py`

---

## Task 1: `_extract_click_target` TDD 교체

**Files:**
- Modify: `backend/app/services/manual_service.py:260-265`
- Test: `backend/tests/test_extract_click_target.py` (신규)

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_extract_click_target.py` 생성:

```python
import pytest

from app.services.manual_service import _extract_click_target


@pytest.mark.parametrize(
    "step, expected",
    [
        # 기존 동작 보존
        ("뉴스 클릭", "뉴스"),
        ("뉴스클릭", "뉴스"),
        ("뉴스 선택", "뉴스"),
        ("뉴스 이동", "뉴스"),
        # descriptor 절단
        ("Demo Admin 버튼 클릭", "Demo Admin"),
        ("로그인 링크 클릭", "로그인"),
        ("설정 메뉴 진입", "설정"),
        ("탭 항목 선택", "탭"),
        # 활용형 어미
        ("메뉴를 선택해", "메뉴"),
        ("프로필을 클릭하세요", "프로필"),
        ("홈으로 이동하기", "홈"),
        # trailing 구두점
        ("Demo Admin 버튼 클릭...", "Demo Admin"),
        ("뉴스 클릭…", "뉴스"),
        ("뉴스 클릭!", "뉴스"),
        # descriptor만 남는 경우 — descriptor 유지
        ("메뉴", "메뉴"),
        ("메뉴 클릭", "메뉴"),
        # 영문 동사
        ("Sign In click", "Sign In"),
        ("Logout tap", "Logout"),
        # 안전 fallback
        ("", ""),
        ("   ", ""),
        ("그냥 텍스트", "그냥 텍스트"),
        # 페이지 어절 보존
        ("뉴스 페이지 이동", "뉴스 페이지"),
    ],
)
def test_extract_click_target(step: str, expected: str):
    assert _extract_click_target(step) == expected
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && uv run pytest tests/test_extract_click_target.py -v`
Expected: 다수 FAIL (현재 구현은 좁은 suffix 리스트만 처리)

- [ ] **Step 3: `_extract_click_target` 본문 교체**

`backend/app/services/manual_service.py`의 import 영역에 `re`가 이미 있는지 확인하고 없으면 추가:

```python
import re
```

기존 `_extract_click_target` 함수 (line 260~265):

```python
def _extract_click_target(step: str) -> str:
    """'뉴스 클릭', '뉴스클릭', '뉴스 선택' 등에서 타겟 텍스트 추출."""
    for suffix in [" 클릭", "클릭", " 선택", "선택", " 이동", "이동"]:
        if step.endswith(suffix):
            return step[: -len(suffix)].strip()
    return step.strip()
```

을 다음으로 교체:

```python
_TRAILING_PUNCT = re.compile(r"[\s.…!?。·]+$")
_ACTION_SUFFIX = re.compile(
    r"(을|를|으로|로)?\s*(클릭|선택|이동|진입|들어가기|누르기|tap|click)(하기|하세요|해|해요|함)?$",
    re.IGNORECASE,
)
_DESCRIPTOR_SUFFIX = re.compile(r"\s*(버튼|링크|메뉴|탭|항목|아이콘|박스|카드)$")


def _extract_click_target(step: str) -> str:
    """자연어 step에서 click target text를 추출한다.

    1) trailing punctuation 제거
    2) 동작 어미(조사+동사+활용형) 절단
    3) descriptor(버튼/링크 등) 절단 — 단 결과가 빈 문자열이면 descriptor 유지
    """
    s = _TRAILING_PUNCT.sub("", step).strip()
    if not s:
        return ""

    after_action = _ACTION_SUFFIX.sub("", s).strip()
    if after_action:
        s = after_action

    after_descriptor = _DESCRIPTOR_SUFFIX.sub("", s).strip()
    if after_descriptor:
        return after_descriptor
    return s
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && uv run pytest tests/test_extract_click_target.py -v`
Expected: 22건 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/manual_service.py backend/tests/test_extract_click_target.py
git commit -m "feat(backend): expand _extract_click_target with regex normalization

조사/활용형 어미, descriptor (버튼/링크/메뉴 등), trailing 구두점을
순차 절단. 결과가 빈 경우 descriptor 유지. 영문 click/tap 동사도 지원.
파라미터라이즈 단위 테스트 22건 추가."
```

---

## Task 2: `_find_click_locator` cascade helper 추가

**Files:**
- Modify: `backend/app/services/manual_service.py`

- [ ] **Step 1: helper 함수 추가**

`backend/app/services/manual_service.py`의 `_extract_click_target` 정의 **아래에** 다음 신규 함수를 추가:

```python
async def _find_click_locator(page, target: str):
    """target text에 대해 다양한 locator 전략을 cascade로 시도한다.

    Returns:
        (locator, reason) — 매칭된 locator와 사유 문자열
        (None, reason)    — 모두 실패. reason은 사용자 친화 메시지.
    """
    if not target:
        return None, "extract 결과 빈 문자열"

    escaped = re.escape(target)
    name_re = re.compile(escaped, re.IGNORECASE)

    strategies = [
        ("role=link",       page.get_by_role("link",   name=name_re)),
        ("role=button",     page.get_by_role("button", name=name_re)),
        ("a:has-text",      page.locator(f'a:has-text("{target}")')),
        ("button:has-text", page.locator(f'button:has-text("{target}")')),
        ("text",            page.get_by_text(target, exact=False)),
        ("aria-label",      page.locator(f'[aria-label*="{target}" i]')),
        ("title",           page.locator(f'[title*="{target}" i]')),
    ]

    for name, loc in strategies:
        try:
            first = loc.first
            if await first.is_visible(timeout=1000):
                return first, f"matched: {name}"
        except Exception:
            continue

    # partial token fallback
    tokens = [t for t in target.split() if len(t) > 1]
    if len(tokens) >= 2:
        for tok in tokens:
            tok_re = re.compile(re.escape(tok), re.IGNORECASE)
            partial_strategies = [
                ("role=link",   page.get_by_role("link",   name=tok_re)),
                ("role=button", page.get_by_role("button", name=tok_re)),
                ("text",        page.get_by_text(tok, exact=False)),
            ]
            for name, loc in partial_strategies:
                try:
                    first = loc.first
                    if await first.is_visible(timeout=800):
                        return first, f"matched: partial '{tok}' via {name}"
                except Exception:
                    continue

    return None, f"'{target}' 일치 요소 없음"
```

- [ ] **Step 2: 임포트 점검**

파일 상단의 import 영역에 `re`가 있는지 확인. Task 1에서 추가했으면 OK.

- [ ] **Step 3: 통합 검증 — pytest 임포트만 확인**

Run: `cd backend && uv run pytest tests/test_extract_click_target.py -v`
Expected: 22건 여전히 PASS, 신규 함수 추가로 인한 import 에러 없음.

- [ ] **Step 4: ruff/mypy 확인 (있을 시)**

Run: `cd backend && uv run ruff check app/services/manual_service.py`
Expected: 새 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/manual_service.py
git commit -m "feat(backend): add _find_click_locator cascade helper

role-based → has-text → get_by_text → aria-label/title → partial token
순으로 visible locator 탐색. 성공/실패 사유 문자열 반환."
```

---

## Task 3: 시나리오 step 루프 호출부 교체

**Files:**
- Modify: `backend/app/services/manual_service.py:165-206`

- [ ] **Step 1: 시나리오 step 루프 갱신**

`backend/app/services/manual_service.py`의 다음 블록 (line 165 부근, `if job.scenario_steps:` 내부):

```python
            if job.scenario_steps:
                for i, step in enumerate(job.scenario_steps, start=2):
                    click_pos = None
                    clicked = False
                    click_target = _extract_click_target(step)

                    try:
                        # 링크 우선, 없으면 버튼, 그 다음 텍스트 요소
                        locator = page.locator(f'a:has-text("{click_target}")').first
                        if not await locator.is_visible(timeout=1500):
                            locator = page.locator(f'button:has-text("{click_target}")').first
                        if not await locator.is_visible(timeout=1000):
                            locator = page.get_by_text(click_target, exact=False).first

                        if await locator.is_visible(timeout=2000):
                            box = await locator.bounding_box()
                            if box:
                                click_pos = {
                                    "x": box["x"] + box["width"] / 2,
                                    "y": box["y"] + box["height"] / 2,
                                    "label": click_target,
                                }
                            # 클릭 전 화면에 마커 표시
                            before_png = SCREENSHOTS_DIR / f"{job.id}_step{i}.png"
                            await page.screenshot(path=str(before_png), full_page=False)
                            _resize_screenshot(before_png)
                            _annotate_click(before_png.with_suffix(".jpg"), click_pos)

                            # target=_blank 링크는 href로 직접 이동
                            href = await locator.get_attribute("href")
                            target_attr = await locator.get_attribute("target")
                            if href and target_attr == "_blank":
                                await page.goto(href, wait_until="domcontentloaded", timeout=15000)
                            else:
                                await locator.click()
                                try:
                                    await page.wait_for_load_state("domcontentloaded", timeout=8000)
                                except Exception:
                                    pass
                            clicked = True
                            await asyncio.sleep(1.5)
                    except Exception:
                        pass
```

전체를 다음으로 교체:

```python
            if job.scenario_steps:
                for i, step in enumerate(job.scenario_steps, start=2):
                    click_pos = None
                    clicked = False
                    click_target = _extract_click_target(step)
                    fail_reason: str | None = None

                    locator, match_reason = await _find_click_locator(page, click_target)

                    if locator is None:
                        fail_reason = match_reason
                        logger.warning(
                            f"manual click failed for step '{step}': {match_reason}"
                        )
                    else:
                        logger.info(
                            f"manual click {match_reason} for step '{step}' → '{click_target}'"
                        )
                        try:
                            box = await locator.bounding_box()
                            if box:
                                click_pos = {
                                    "x": box["x"] + box["width"] / 2,
                                    "y": box["y"] + box["height"] / 2,
                                    "label": click_target,
                                }
                            # 클릭 전 화면에 마커 표시
                            before_png = SCREENSHOTS_DIR / f"{job.id}_step{i}.png"
                            await page.screenshot(path=str(before_png), full_page=False)
                            _resize_screenshot(before_png)
                            _annotate_click(before_png.with_suffix(".jpg"), click_pos)

                            # target=_blank 링크는 href로 직접 이동
                            href = await locator.get_attribute("href")
                            target_attr = await locator.get_attribute("target")
                            if href and target_attr == "_blank":
                                await page.goto(href, wait_until="domcontentloaded", timeout=15000)
                            else:
                                await locator.click()
                                try:
                                    await page.wait_for_load_state("domcontentloaded", timeout=8000)
                                except Exception:
                                    pass
                            clicked = True
                            await asyncio.sleep(1.5)
                        except Exception as click_err:
                            fail_reason = f"click 실행 실패: {click_err}"
                            logger.warning(
                                f"manual click execution failed for step '{step}': {click_err}"
                            )
```

요점:
- 기존 try/except의 외부 보호는 제거. cascade가 모든 실패 케이스를 swallow하기 때문.
- click 실행 단계(box/screenshot/click 자체)는 별도 try로 묶어서 실패 시 `fail_reason` 채움.

- [ ] **Step 2: description 실패 텍스트 갱신**

같은 함수에서 좀 더 아래 (line 232 부근, `else:` 블록 — "클릭 실패" 노출 부분):

```python
                        else:
                            screenshots.append({
                                "step": i,
                                "filename": f"{job.id}_step{i}a.jpg",
                                "url": page.url,
                                "description": f"{step} (클릭 실패)",
                                "page_text": step_text[:2000] if step_text else "",
                                "click_pos": None,
                            })
```

을 다음으로 교체:

```python
                        else:
                            desc_suffix = (
                                f" (클릭 실패: {fail_reason})" if fail_reason else " (클릭 실패)"
                            )
                            screenshots.append({
                                "step": i,
                                "filename": f"{job.id}_step{i}a.jpg",
                                "url": page.url,
                                "description": f"{step}{desc_suffix}",
                                "page_text": step_text[:2000] if step_text else "",
                                "click_pos": None,
                            })
```

- [ ] **Step 3: 단위 테스트 회귀**

Run: `cd backend && uv run pytest tests/test_extract_click_target.py -v`
Expected: 22건 PASS.

- [ ] **Step 4: 전체 회귀 확인**

Run: `cd backend && uv run pytest`
Expected: fail 카운트가 master baseline(10건)보다 늘지 않음.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/manual_service.py
git commit -m "feat(backend): wire _find_click_locator into scenario step loop

cascade 매칭 결과로 logger.info/warning + description fail_reason 표시.
실패 시 사용자 친화 사유 (e.g. \"(클릭 실패: 'Demo Admin' 일치 요소 없음)\")."
```

---

## Task 4: 통합 검증 + 수동 회귀 + PR

- [ ] **Step 1: 단위 테스트 재확인**

Run: `cd backend && uv run pytest tests/test_extract_click_target.py -v`
Expected: 22건 PASS.

- [ ] **Step 2: 전체 백엔드 회귀**

Run: `cd backend && uv run pytest`
Expected: fail 카운트가 master baseline (현재 10건) 이하.

- [ ] **Step 3: lint/type 확인**

Run: `cd backend && uv run ruff check app/services/manual_service.py && uv run mypy app/services/manual_service.py 2>&1 | tail`
Expected: 신규 에러 없음.

- [ ] **Step 4: 수동 회귀 (옵션, dev 환경 있을 시)**

1. `cd backend && uv run fastapi dev` + `cd frontend && pnpm dev`
2. 로그인 후 `/manuals`에서 신규 매뉴얼 생성:
   - 대상 URL: 데모 페이지 (예: docops 자체 페이지)
   - 시나리오 step에 "Demo Admin 버튼 클릭..." 입력
3. job 완료 후 상세에서 step 2 description 확인:
   - 매칭 성공 시 "Demo Admin 버튼 클릭... - 클릭 위치" 노출
   - 실패 시 "(클릭 실패: '…' 일치 요소 없음)" 노출
4. backend 로그에 `manual click matched: role=button …` 또는 `manual click failed …` 라인 확인.

- [ ] **Step 5: PR 생성**

```bash
git push -u origin feat/playwright-nl-click
gh pr create --title "feat: Playwright NL click 매칭 강화" --body "$(cat <<'EOF'
## Summary
- 시나리오 step 자연어에서 click target 추출 규칙 강화 (조사/활용형/descriptor/punct)
- locator cascade helper 신규: role → has-text → text → aria-label/title → partial token
- 실패 사유를 logger + description 양쪽에 노출

## Spec
docs/superpowers/specs/2026-05-21-playwright-nl-click-design.md

## Test plan
- [x] `tests/test_extract_click_target.py` 22건 PASS
- [x] backend pytest 회귀: master baseline(10건) 이하 유지
- [ ] 수동: "Demo Admin 버튼 클릭..." 시나리오로 실패 → 성공 전환 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done 정의

- Task 1~3 모두 커밋됨
- `tests/test_extract_click_target.py` 22건 PASS
- backend 전체 회귀에서 신규 fail 없음
- PR 생성 및 description에 spec 링크 포함
