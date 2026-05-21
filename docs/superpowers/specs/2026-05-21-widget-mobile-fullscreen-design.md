# Widget 모바일 Full Screen UI

## 배경

위젯 데모는 현재 두 surface 모두 floating panel 형태로 고정 크기를 사용한다.

- `frontend/src/pages/WidgetDemo.tsx` — React 데모 페이지의 우하단 floating chat (`400×550`, `bottom-8 right-8`)
- `frontend/src/widget/styles.ts` — Shadow DOM 임베드 위젯의 `.docops-panel` (`380×520`, `bottom: 96px; right: 24px`)

모바일 화면에서 floating 크기를 그대로 유지하면 화면 일부만 차지해 입력/스크롤이 불편하다. 모바일에서는 full screen으로 표시해 가독성과 입력 편의를 확보한다. 데스크톱에서는 기존 floating 크기를 그대로 유지한다.

## 목표

- 모바일 (`viewport ≤ 768px`)에서 위젯 chat panel을 100vw × 100dvh full screen으로 표시
- 데스크톱 (`> 768px`)에서는 기존 크기/위치/스타일 그대로 유지
- 두 surface (WidgetDemo, embed widget) 모두 동일한 breakpoint와 동작
- 추가 JS 로직 없이 순수 CSS 미디어 쿼리로 구현

## 비목표

- 위젯 내부 ChatPanel 컴포넌트, 메시지 레이아웃, API 변경
- Trigger FAB 버튼 동작 변경 (기존 chat open 시 숨김 로직 유지)
- 데스크톱 floating 스타일, 색상, 애니메이션 변경

## 가정

- Breakpoint는 Tailwind `md` (768px)로 통일. WidgetDemo 페이지가 이미 `md:` prefix를 광범위하게 사용 중이라 일관성 확보.
- Mobile full screen은 `100dvh` (dynamic viewport height) 사용 — iOS Safari의 주소창 표시/숨김 시 높이 변화에 대응.
- iOS notch / 홈 인디케이터 대응을 위해 `env(safe-area-inset-*)`를 header padding-top, input-area padding-bottom에 가산.
- Full screen 시 border-radius, shadow, border 제거 — 화면 가장자리에 라운드/그림자가 보이면 어색.

## 설계

### 1. WidgetDemo.tsx 수정

대상: `frontend/src/pages/WidgetDemo.tsx` line 268–287 floating chat block.

기존 구조:

```tsx
<div className="fixed bottom-8 right-8 z-50 flex flex-col items-end">
  <div className="w-[400px] h-[550px] bg-white rounded-xl shadow-[...] border border-[#c4c5d5] flex flex-col overflow-hidden">
    ...
  </div>
</div>
```

변경 후:

```tsx
<div className="fixed z-50 inset-0 md:inset-auto md:bottom-8 md:right-8 md:flex md:flex-col md:items-end">
  <div className="w-full h-full md:w-[400px] md:h-[550px] bg-white md:rounded-xl md:shadow-[0_10px_25px_rgba(0,0,0,0.15)] md:border md:border-[#c4c5d5] flex flex-col overflow-hidden">
    ...
  </div>
</div>
```

header 영역(`bg-[#00288e] text-white p-4` div, line 271)의 top padding을 safe-area로 확장한다. 기존 `p-4`는 좌/우/하 padding 1rem을 유지하고, top만 `pt-[calc(env(safe-area-inset-top)+1rem)]`으로 override한다. 노치 없는 단말에서는 `safe-area-inset-top = 0` → 기존 1rem과 동일하므로 데스크톱 동작에 영향 없음.

핵심 클래스 매핑:

| 속성 | Mobile (<768px) | Desktop (≥768px, `md:`) |
|---|---|---|
| 외부 컨테이너 위치 | `inset-0` | `inset-auto bottom-8 right-8` |
| 패널 크기 | `w-full h-full` | `w-[400px] h-[550px]` |
| 라운드/그림자/보더 | 없음 | `rounded-xl shadow-... border ...` |

### 2. widget/styles.ts 수정

대상: `frontend/src/widget/styles.ts` line 32–47 `.docops-panel` 규칙 뒤에 모바일 미디어 쿼리 추가.

추가 CSS:

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
}
```

`widget/main.ts` line 128을 보면 toggle은 `.docops-panel`에만 `.hidden`을 부여한다. `.docops-trigger`는 항상 표시되어 데스크톱에서는 panel 우측 아래에 trigger가 보이는 것이 자연스럽지만, 모바일 full screen 상태에서는 trigger가 input area 위에 떠 오버랩된다. 모바일에서 panel이 열려 있을 때 trigger를 숨긴다:

```css
@media (max-width: 768px) {
  .docops-trigger:has(~ .docops-panel:not(.hidden)) {
    display: none;
  }
}
```

`:has()`는 2026년 baseline에서 안정적으로 지원된다. JS 로직 변경 없이 CSS만으로 처리.

`@keyframes slideUp` 애니메이션 (16px translateY)은 full screen 상태에서도 자연스럽게 동작하므로 그대로 유지.

### 3. 공통 규칙

- Breakpoint: `768px` (Tailwind `md`)
- Mobile 시: `width/height = 100vw/100dvh`, border-radius/shadow/border = 0
- Safe area: header padding-top, input-area padding-bottom에 `env(safe-area-inset-*)` 가산
- 데스크톱 동작 변경 없음

## 영향 범위

- 변경 파일: `frontend/src/pages/WidgetDemo.tsx`, `frontend/src/widget/styles.ts` 2개
- 변경 없는 항목: ChatPanel 컴포넌트, useChatSession 훅, widget API, widget main.ts, 백엔드

## 검증

- `cd frontend && pnpm typecheck` 통과
- `cd frontend && pnpm lint` 통과
- 수동 확인
  - Desktop (≥768px): WidgetDemo의 floating chat 400×550 우하단 유지, 임베드 위젯 380×520 유지
  - Mobile (<768px, 예: 375px 폭): 두 surface 모두 화면 전체 차지, 라운드/그림자 없음
  - iOS Safari: 주소창 표시/숨김 시 panel이 화면을 벗어나지 않음 (100dvh)
  - iOS notch 단말: header가 노치에 가리지 않음
- 기존 e2e (`frontend/e2e/navigation.spec.ts`, `frontend/e2e/ux-walkthrough.spec.ts`) selector 변경 없음 → 추가 수정 불필요

## 미래 작업 (out of scope)

- Tablet 전용 중간 크기 (예: 50% width)
- 위젯 호스트 페이지가 자체적으로 모바일 동작을 override할 수 있는 옵션 API
- 가로 모드(landscape) 별도 처리
