# Widget 모바일 Full Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WidgetDemo 페이지와 임베드 위젯 모두 모바일 (≤768px)에서 chat panel을 full screen으로 표시하고, 데스크톱에서는 기존 floating 크기를 그대로 유지한다.

**Architecture:** 순수 CSS 미디어 쿼리만 사용. WidgetDemo는 Tailwind `md:` prefix로 분기, 임베드 위젯은 Shadow DOM CSS에 `@media (max-width: 768px)` 블록 추가. JS 로직 변경 없음.

**Tech Stack:** React 19, TypeScript, Tailwind CSS (WidgetDemo), Shadow DOM + vanilla CSS (embed widget).

**Spec:** `docs/superpowers/specs/2026-05-21-widget-mobile-fullscreen-design.md`

---

## File Structure

변경 파일 (2개, 신규 생성 없음):

| Path | Role | 변경 위치 |
|---|---|---|
| `frontend/src/pages/WidgetDemo.tsx` | React 데모 페이지 우하단 floating chat | line 269–287 (`chatOpen` true 분기) |
| `frontend/src/widget/styles.ts` | Shadow DOM 임베드 위젯 CSS template | `.docops-panel` 규칙 (line 32–47) 뒤에 media query 추가 |

변경하지 않는 파일:
- `frontend/src/widget/main.ts` — JS 로직 그대로
- `frontend/src/components/chat/ChatPanel.tsx` — 내부 컴포넌트 그대로
- E2E 테스트 — selector 변경 없음

---

## Task 1: WidgetDemo.tsx 모바일 full screen 적용

**Files:**
- Modify: `frontend/src/pages/WidgetDemo.tsx:269-287`

- [ ] **Step 1: 현재 floating chat 블록 확인**

`frontend/src/pages/WidgetDemo.tsx` line 269–287에서 다음 구조 확인:

```tsx
<div className="fixed bottom-8 right-8 z-50 flex flex-col items-end">
  <div className="w-[400px] h-[550px] bg-white rounded-xl shadow-[0_10px_25px_rgba(0,0,0,0.15)] border border-[#c4c5d5] flex flex-col overflow-hidden">
    <div className="bg-[#00288e] text-white p-4 flex justify-between items-center">
      ...
    </div>
    <ChatPanel chat={chatWithLazySend} variant="compact" emptyState={emptyState} />
  </div>
</div>
```

- [ ] **Step 2: 외부 컨테이너 className 변경**

다음 Edit 적용:

old:
```tsx
<div className="fixed bottom-8 right-8 z-50 flex flex-col items-end">
```

new:
```tsx
<div className="fixed z-50 inset-0 md:inset-auto md:bottom-8 md:right-8 md:flex md:flex-col md:items-end">
```

설명:
- Mobile (<768px): `inset-0` → 화면 전체 차지 (top/right/bottom/left = 0)
- Desktop (`md:` ≥768px): `inset-auto`로 inset 해제 + 기존 `bottom-8 right-8` 위치 + flex 컨테이너로

- [ ] **Step 3: 패널 className 변경**

다음 Edit 적용:

old:
```tsx
<div className="w-[400px] h-[550px] bg-white rounded-xl shadow-[0_10px_25px_rgba(0,0,0,0.15)] border border-[#c4c5d5] flex flex-col overflow-hidden">
```

new:
```tsx
<div className="w-full h-full md:w-[400px] md:h-[550px] bg-white md:rounded-xl md:shadow-[0_10px_25px_rgba(0,0,0,0.15)] md:border md:border-[#c4c5d5] flex flex-col overflow-hidden">
```

설명:
- Mobile: `w-full h-full` → 부모 100%, radius/shadow/border 없음
- Desktop: 기존 400×550, rounded-xl, shadow, border 복원

- [ ] **Step 4: Header padding-top에 safe-area 가산**

다음 Edit 적용 (line 271 부근, `bg-[#00288e] text-white p-4` div):

old:
```tsx
<div className="bg-[#00288e] text-white p-4 flex justify-between items-center">
```

new:
```tsx
<div className="bg-[#00288e] text-white p-4 pt-[calc(env(safe-area-inset-top)+1rem)] flex justify-between items-center">
```

설명: `p-4`는 좌/우/하 1rem 유지. `pt-[calc(env(safe-area-inset-top)+1rem)]`은 top padding을 override해 iOS notch 단말의 상단 안전영역을 추가. 노치 없는 단말/데스크톱은 `env(safe-area-inset-top) = 0` → 기존 1rem과 동일.

- [ ] **Step 5: typecheck 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: PASS (에러 없음)

- [ ] **Step 6: lint 통과 확인**

```bash
cd frontend && pnpm lint
```

Expected: PASS (변경 파일 관련 에러 없음). Tailwind `pt-[...]` 임의값은 기존 코드에서도 사용 중이라 lint 통과.

- [ ] **Step 7: dev server에서 수동 확인**

```bash
cd frontend && pnpm dev
```

브라우저에서 `http://localhost:5173/widget-demo` 열고:

1. 데스크톱 폭(>768px): 우하단 chat trigger 클릭 → 400×550 floating, 라운드/그림자/보더 보임 (기존 동일)
2. DevTools 모바일 뷰(예: iPhone 12, 390px) 토글: chat trigger 클릭 → 화면 전체 차지, 라운드/그림자/보더 없음, header 상단이 안전영역까지 확장됨

스크린샷 또는 시각 확인 후 진행.

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/pages/WidgetDemo.tsx
git commit -m "feat(widget-demo): mobile full-screen chat panel

Mobile (<768px) viewport에서 floating chat을 100vw × 100vh full
screen으로 표시. 데스크톱은 기존 400×550 floating 그대로 유지.
iOS notch 단말 대응을 위해 header에 safe-area-inset-top 가산."
```

---

## Task 2: widget/styles.ts 모바일 media query 추가

**Files:**
- Modify: `frontend/src/widget/styles.ts` (`.docops-panel` 규칙 뒤)

- [ ] **Step 1: 기존 `.docops-panel` 규칙 위치 확인**

`frontend/src/widget/styles.ts` line 32–47에서 다음 확인:

```css
.docops-panel {
  position: fixed;
  bottom: 96px;
  right: 24px;
  width: 380px;
  height: 520px;
  border-radius: 16px;
  background: #1a1a2e;
  border: 1px solid #2a2a4a;
  box-shadow: 0 16px 64px rgba(0,0,0,0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 999998;
  animation: slideUp 0.3s ease;
}
```

- [ ] **Step 2: `@keyframes slideUp` 블록 뒤에 모바일 media query 삽입**

`@keyframes slideUp` 블록 (line 48–51) 끝(`}` 다음) 줄에 다음 CSS 삽입:

```css
@media (max-width: 768px) {
  .docops-panel {
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    height: 100dvh;
    border-radius: 0;
    border: none;
    box-shadow: none;
  }
  .docops-header {
    padding-top: calc(16px + env(safe-area-inset-top));
  }
  .docops-input-area {
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
  }
  .docops-trigger:has(~ .docops-panel:not(.hidden)) {
    display: none;
  }
}
```

설명:
- `.docops-panel`: `top/left/right/bottom = 0` + `width: 100vw; height: 100dvh` → full screen. `100dvh`는 iOS Safari 주소창 동작에 대응. radius/shadow/border 제거
- `.docops-header`: 기존 `padding: 16px 20px` 유지하면서 top만 safe-area 만큼 추가 → iOS notch 대응
- `.docops-input-area`: 기존 `padding: 12px 16px` 유지하면서 bottom만 safe-area 만큼 추가 → iOS 홈 인디케이터 대응
- `.docops-trigger:has(~ .docops-panel:not(.hidden))`: panel이 열려 있을 때 trigger 버튼을 숨김. `:has()`는 2026 baseline 안정 지원. DOM 순서상 trigger가 panel보다 먼저 나오므로 `~` 결합자 사용 가능

이 CSS는 `getWidgetStyles()` 함수가 반환하는 template literal 안에 들어가므로 template 문자열 내부에 그대로 삽입한다 (기존 코드와 동일 들여쓰기 유지).

- [ ] **Step 3: typecheck 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: PASS

- [ ] **Step 4: lint 통과 확인**

```bash
cd frontend && pnpm lint
```

Expected: PASS

- [ ] **Step 5: widget 빌드 통과 확인**

위젯은 별도 vite config로 빌드됨:

```bash
cd frontend && pnpm exec vite build --config vite.widget.config.ts
```

Expected: 빌드 성공, 에러 없음

- [ ] **Step 6: 임베드 위젯 수동 확인**

dev server 실행 중인 상태에서 `WidgetConversations` 또는 widget을 host하는 페이지에서 위젯 동작 확인. 또는 widget 빌드 산출물을 정적 페이지에 삽입해 확인:

1. 데스크톱 (>768px): trigger 클릭 → 380×520 우하단 floating panel, trigger 좌하단 보임 (기존 동일)
2. DevTools 모바일 뷰 (예: 390px): trigger 클릭 → panel이 화면 전체 차지, header가 노치 영역까지 확장, input area 하단이 home indicator 영역 확보, trigger 버튼은 사라짐
3. 모바일 뷰에서 panel 닫기(`x` 또는 header 닫기 버튼) → trigger 다시 표시

시각 확인 후 진행.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/widget/styles.ts
git commit -m "feat(widget): mobile full-screen panel via media query

Embed widget의 .docops-panel을 모바일 (<=768px)에서 100vw x 100dvh
full screen으로 전환. radius/shadow/border 제거. iOS safe-area-inset
top/bottom을 header/input padding에 가산. panel 열림 시 trigger
버튼은 :has() 셀렉터로 숨김."
```

---

## Task 3: 통합 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 typecheck**

```bash
cd frontend && pnpm typecheck
```

Expected: PASS

- [ ] **Step 2: 전체 lint**

```bash
cd frontend && pnpm lint
```

Expected: PASS

- [ ] **Step 3: 기존 e2e 영향 확인**

```bash
cd frontend && pnpm exec playwright test e2e/navigation.spec.ts e2e/ux-walkthrough.spec.ts
```

Expected: PASS (selector 변경 없으므로 영향 없어야 함). 만약 viewport 관련 실패가 있으면 e2e가 기본 데스크톱 viewport를 사용하는지 확인 후 패스.

- [ ] **Step 4: 데스크톱 회귀 확인**

dev server에서 데스크톱 폭 (예: 1280px)으로 두 surface 다시 확인:

- WidgetDemo: 우하단 400×550 floating, 라운드/그림자/보더 정상
- 임베드 위젯: 우하단 380×520 floating, 다크 테마 정상, trigger 보임

데스크톱 회귀 없음 확인.

- [ ] **Step 5: 최종 시각 확인 체크리스트**

| 확인 항목 | Desktop ≥768px | Mobile <768px |
|---|---|---|
| WidgetDemo panel 크기 | 400×550 | 100vw × 100vh |
| WidgetDemo radius/shadow/border | 있음 | 없음 |
| WidgetDemo header notch 대응 | 무관 | safe-area top 적용 |
| 임베드 panel 크기 | 380×520 | 100vw × 100dvh |
| 임베드 radius/shadow/border | 있음 | 없음 |
| 임베드 header notch 대응 | 무관 | safe-area top 적용 |
| 임베드 input area home indicator | 무관 | safe-area bottom 적용 |
| 임베드 trigger 표시 | 항상 보임 | panel 열림 시 숨김 |

전 항목 통과 시 plan 완료.

---

## Self-Review Notes

스펙 커버리지:
- §1 WidgetDemo.tsx → Task 1
- §2 widget/styles.ts (panel + safe-area + trigger hide) → Task 2
- §3 검증 (typecheck/lint/manual) → Task 1 Step 5–7, Task 2 Step 3–6, Task 3

Placeholder/타입 일관성:
- `inset-0` / `inset-auto`, `md:` prefix, `100dvh`, `env(safe-area-inset-*)`, `:has(...)`, `~` 결합자 — 모두 표준
- 클래스명/CSS 선택자 모든 step에서 일치
