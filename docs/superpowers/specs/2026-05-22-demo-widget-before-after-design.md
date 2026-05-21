# /demo-widget-before, /demo-widget-after 시연 페이지 설계

작성일: 2026-05-22
대상: 프론트엔드 (React + Vite)
백엔드 변경: 없음

## 1. 목적

택배 기사(driver)가 배송 지연 상황을 보고하는 폼을 시연용으로 만든다. 두 페이지(`/demo-widget-before`, `/demo-widget-after`)는 위젯 → Jira SR → 매뉴얼 자동 수정 흐름의 시작(before)과 결과(after)를 보여준다.

- **before**: 기상악화/명절 사유 radio가 disabled (회색+취소선) → 기사가 답답해함 → 챗봇 위젯으로 문의
- **after**: 같은 화면이지만 모든 radio 활성, 저장 시 "기상악화 상태입니다. 조심히 운행하세요" 모달 노출
- 시연 시 추가될 위젯/SR/Playwright 매뉴얼 자동 수정 기능 자체는 **이 작업의 범위 밖** (다른 세션에서 진행 중)

## 2. 라우팅 & 파일 구조

```
frontend/src/pages/
  DemoWidget.tsx              # 공통 컴포넌트 (props로 차이 주입)
  DemoWidgetBefore.tsx        # 한 줄 wrapper
  DemoWidgetAfter.tsx         # 한 줄 wrapper
```

`App.tsx` 라우트 추가:

```tsx
<Route path="/demo-widget-before" element={<DemoWidgetBefore />} />
<Route path="/demo-widget-after" element={<DemoWidgetAfter />} />
```

네비게이션(`Layout.tsx`)에는 추가하지 않는다. URL로 직접 접속 (시연용).

### 공통 props

```ts
interface DemoWidgetProps {
  allowAllReasons: boolean              // false: 기상악화/명절 disabled
  onSaveBehavior: "none" | "weather-modal"
}
```

```tsx
// DemoWidgetBefore.tsx
export function DemoWidgetBefore() {
  return <DemoWidget allowAllReasons={false} onSaveBehavior="none" />
}

// DemoWidgetAfter.tsx
export function DemoWidgetAfter() {
  return <DemoWidget allowAllReasons={true} onSaveBehavior="weather-modal" />
}
```

## 3. UI 레이아웃 (모바일 first)

폭: `max-w-md` (~448px) 가운데 정렬, 데스크탑도 동일 폭.

```
┌─────────────────────────────┐
│ ← 배송 상세         ⓘ      │ ← 상단 헤더 (sticky)
├─────────────────────────────┤
│ ⚠️ [물류통제실 알림]    [✕] │ ← Toast (마운트 2초 후)
│ 기상악화로 배송 지연 안내문 │
│ 발송                        │
├─────────────────────────────┤
│ 📍 배송 정보 (고정값)       │
│   고객 주소 / 고객 번호 /   │
│   예상 배송 시간            │
│                             │
│ 📷 현장 사진 첨부           │
│   (빈 상태: 점선 박스)      │
│   (첨부 후: 썸네일 + ✕)     │
│                             │
│ 💬 고객 전달 메시지         │
│   (textarea, 기본문구)      │
│                             │
│ ↓↓ 사진 업로드 후 노출 ↓↓  │
│                             │
│ 📋 지연 사유 (radio 6개)    │
│   ⊘ 기상악화/명절 disabled  │
│   ○ 기타 선택 시 input 노출 │
│   ⚠️ 페널티 안내 (기타만)   │
│                             │
│ [저장 버튼] (하단 sticky)   │
└─────────────────────────────┘
                       💬 ← 챗봇 floating
```

### 스타일 가이드

- 배경: `bg-[#f7f9fb]`
- 주색: `#00288e`
- 카드: `bg-white rounded-lg border border-[#c4c5d5]`
- 폰트: Inter, 본문 14-16px
- 폼 input: `border border-[#c4c5d5] rounded focus:border-[#00288e] focus:ring-1`

### Toast

- 위치: 페이지 상단 헤더 아래, `sticky top-16 z-30` (헤더 높이 16)
- 색: `bg-[#fff4d0]` + 좌측 보더 `border-l-4 border-[#f59e0b]`
- 텍스트: `text-[#7a4f00]`, 제목 굵게
- X 버튼: 우상단, 클릭 시 닫힘
- **자동 사라지지 않음** (시연 중 유지)
- 진입 2초 후 `setTimeout` → `setToastOpen(true)`. unmount 시 `clearTimeout`

## 4. 상태 & 상호작용

### 상태

```ts
const [photo, setPhoto] = useState<File | null>(null)
const [photoUrl, setPhotoUrl] = useState<string | null>(null)
const [message, setMessage] = useState(DEFAULT_MESSAGE)
const [reason, setReason] = useState<ReasonKey | null>(null)
const [reasonEtcText, setReasonEtcText] = useState("")
const [toastOpen, setToastOpen] = useState(false)
const [modalOpen, setModalOpen] = useState(false)
```

### 흐름

1. **마운트** → `setTimeout(() => setToastOpen(true), 2000)`. cleanup으로 unmount 시 `clearTimeout`.
2. **사진 첨부**:
   - `<input type="file" capture="environment" accept="image/*" />`
   - `URL.createObjectURL(file)` → 썸네일 src
   - `useEffect` cleanup으로 `URL.revokeObjectURL` 호출 (이전 url 교체 시도 동일)
   - 백엔드 업로드 없음
   - `photo !== null` 일 때만 지연사유 영역 렌더
3. **지연사유 선택**:
   - `allowAllReasons === false`면 `weather`, `holiday` 비활성
   - 비활성 스타일: `opacity-50 line-through text-[#757684] cursor-not-allowed`
   - `<input disabled>`로 차단 (클릭 핸들러 추가 없음)
   - `reason === "etc"` 일 때만 텍스트 input + 페널티 안내 노출
   - 다른 radio 선택 시 `etc` input/안내 자동 사라짐
4. **저장 클릭**:
   - `onSaveBehavior="none"` → 아무 동작 안 함
   - `onSaveBehavior="weather-modal"` → `setModalOpen(true)`

### 사진 첨부 UX

```
빈 상태:                       사진 첨부 후:
┌──────────────────────┐      ┌──────────────────────┐
│  📷  사진 첨부       │      │  [썸네일 80x80]   ✕  │
│  (탭하여 카메라/갤러리)│      │  delivery.jpg        │
└──────────────────────┘      └──────────────────────┘
```

- `<label>` 클릭 → 숨겨진 `<input type="file" capture="environment" accept="image/*">`
- `capture="environment"`: 모바일에서 후면 카메라 바로 열림
- ✕ 누르면 `setPhoto(null)`, `setPhotoUrl(null)`, `URL.revokeObjectURL` → radio 영역 다시 숨김

### "기타" input + 페널티 안내

```
○ 기타
  ┌────────────────────────┐
  │ [텍스트 1줄 입력]      │
  └────────────────────────┘
⚠️ 사유를 소명하지 않으면 정시 배송률 하락으로 페널티를 받을 수 있습니다
```

- 안내문 스타일: `bg-[#fff4d0] text-[#7a4f00] text-sm p-3 rounded`
- 다른 radio 선택 시 input + 안내 둘 다 사라짐

## 5. After 페이지 차이점

| 항목 | Before | After |
|------|--------|-------|
| 기상악화 radio | disabled, 회색+취소선, opacity 50% | 활성, 일반 |
| 명절 radio | disabled, 회색+취소선, opacity 50% | 활성, 일반 |
| 저장 클릭 | 효과만, action 없음 | 커스텀 모달 |

### 커스텀 모달

```
┌─────────────────────────────────────┐
│  배경: fixed inset-0 bg-black/50    │
│                                     │
│      ┌───────────────────────┐      │
│      │     🌧️                │      │
│      │                       │      │
│      │  현재 기상악화 상태   │      │
│      │  입니다.              │      │
│      │  조심히 운행하세요    │      │
│      │                       │      │
│      │  ┌─────────────────┐  │      │
│      │  │     확인        │  │      │
│      │  └─────────────────┘  │      │
│      └───────────────────────┘      │
└─────────────────────────────────────┘
```

- 컨테이너: `fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4` (챗봇 floating `z-50`보다 위)
- 박스: `bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl`
- 아이콘: `lucide-react`의 `CloudRain` (60px, `text-[#00288e]`, 가운데)
  - 프로젝트에 lucide-react 이미 사용 중인지 확인. 없으면 emoji 🌧️ fallback.
- 메시지: `text-lg font-semibold text-[#191c1e] text-center mt-4`
- 확인 버튼: `w-full bg-[#00288e] text-white rounded-lg py-3 mt-6`
- 닫기 방법: 확인 버튼 클릭 또는 배경 클릭 → `setModalOpen(false)`
- ESC 키 닫기는 데모 범위에서 생략

## 6. 챗봇 위젯 통합

`/widget-demo`의 챗봇 통합 코드 재사용. 변경점은 `site_id`만 다름:

```ts
const adapter = useMemo(() => buildWidgetAdapter(null), [])  // 익명만
const sessionPayload = {
  site_id: "demo_courier",   // 기존 demo_asiana와 분리
  anonymous_id: "demo_courier_user",
  user_id: null,
}
```

`useChatSession` / `ensureSession` / `pendingSendRef` / `sendWithSession` 패턴 동일.

### 위젯 위치/동작

- floating 버튼: `fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[#00288e]`
- 모바일에서 열면 풀스크린 (다음 섹션에서 안정화 처리)
- 빈 상태 메시지: "안녕하세요! 배송 도우미입니다.\n무엇을 도와드릴까요?" — `ChatPanel`의 `emptyState` prop으로 주입 (기존 WidgetDemo 패턴 동일)

### 저장 버튼 & 챗봇 floating 충돌

저장 버튼이 하단 sticky인데 챗봇이 우하단 floating → 겹침. 챗봇이 위에 올라오게 z-index 분리.

```
저장 버튼: sticky bottom-0 z-40
챗봇 floating: fixed bottom-6 right-6 z-50
```

저장 버튼 영역에 `pr-20` (챗봇 폭만큼 우측 패딩) 줘서 텍스트와 챗봇이 시각적으로 안 겹치게 한다.

## 7. 모바일 챗봇 헤더 안정화 (`/widget-demo` 포함)

기존 `/widget-demo`에서 모바일로 챗봇 열면 헤더가 깨지는 이슈 해결. 새 demo 페이지와 같은 코드 패턴이므로 `/widget-demo`도 함께 수정한다.

### 원인 추정

1. `h-full` (100%) vs 모바일 동적 viewport — 주소창 보였다 사라졌다 할 때 어긋남
2. flex 컨테이너 안 헤더가 `flex-shrink-0` 없어서 메시지 영역이 늘면 헤더가 줄어듦
3. ChatPanel 내부 스크롤 영역과 헤더 분리가 약함

### 수정안

```tsx
{chatOpen ? (
  <div className="fixed z-50 inset-0 md:inset-auto md:bottom-8 md:right-8 md:flex md:flex-col md:items-end">
    <div
      className="
        w-full bg-white flex flex-col overflow-hidden
        h-[100dvh]
        md:w-[400px] md:h-[550px]
        md:rounded-xl md:shadow-[0_10px_25px_rgba(0,0,0,0.15)]
        md:border md:border-[#c4c5d5]
      "
    >
      <div
        className="
          bg-[#00288e] text-white p-4
          pt-[calc(env(safe-area-inset-top)+1rem)]
          flex-shrink-0
          flex justify-between items-center
        "
      >
        {/* 헤더 내용 그대로 */}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatPanel ... />
      </div>
    </div>
  </div>
) : ... }
```

핵심 변경:

1. `h-full` → `h-[100dvh]` (모바일만, md 이상은 기존 `md:h-[550px]` 유지)
   - `dvh` = dynamic viewport height. 모바일 주소창 변화에 따라옴
2. 헤더 div에 `flex-shrink-0` 추가 — 메시지가 늘어도 헤더 안 줄어듦
3. ChatPanel 감싼 div에 `flex-1 min-h-0 overflow-hidden` — 헤더 빼고 나머지만 스크롤

### 추가 안전망

- 모달 open 시 `body` 스크롤 잠금 (`useEffect`로 `document.body.style.overflow = "hidden"`, cleanup 시 복원)
- 키보드 대응은 기본 동작 유지 (별도 `scrollIntoView` 추가 안 함). 만약 시연 시 입력 시 문제 발견되면 그 때 추가.

## 8. 데이터/상태 요약 — 백엔드 변경 없음

- 고정값 (CUSTOMER, DEFAULT_MESSAGE, TOAST, REASONS): 컴포넌트 상단 상수
- 사진: `URL.createObjectURL` 로컬 미리보기. 업로드 X
- 저장: action 없음 (before) / 모달 (after). API 호출 없음
- 챗봇 위젯 API (`/api/widget/sessions` 등)는 기존 그대로

→ 백엔드 코드 변경 0줄.

### 상수 모듈

```ts
const CUSTOMER = {
  address: "서울 강서구 마곡중앙로 143(마곡동), 르웨스트시티 타워 B동 10층",
  phone: "02-2127-8300",
  eta: "26.05.22, 10:30",
}

const DEFAULT_MESSAGE = "고객님, 기다리시던 택배 배송드립니다."

const TOAST = {
  title: "[물류통제실 알림]",
  body: "기상악화로 배송 지연 안내문 발송",
}

const REASONS = [
  { key: "traffic",  label: "교통사고",          alwaysEnabled: true },
  { key: "address",  label: "주소지/연락처 오류", alwaysEnabled: true },
  { key: "weather",  label: "기상악화",          alwaysEnabled: false },
  { key: "holiday",  label: "명절",              alwaysEnabled: false },
  { key: "damage",   label: "포장 파손",         alwaysEnabled: true },
  { key: "etc",      label: "기타",              alwaysEnabled: true },
] as const

type ReasonKey = (typeof REASONS)[number]["key"]
```

## 9. 검증

자동화 테스트 미작성 (데모 페이지). 다음으로 검증:

1. `cd frontend && pnpm typecheck` — 타입 통과
2. `cd frontend && pnpm lint` — eslint 통과
3. 수동 시연 체크리스트 (브라우저 모바일 viewport 375px):
   - [ ] `/demo-widget-before` 진입 → 2초 후 토스트 노출 → X 클릭 닫힘
   - [ ] 사진 첨부 전 radio 영역 안 보임
   - [ ] 사진 첨부 후 radio 영역 노출, 썸네일 표시
   - [ ] 썸네일 ✕ 클릭 시 사진 제거 + radio 영역 다시 숨김
   - [ ] 기상악화/명절 radio 회색+취소선+opacity 50%, 클릭 차단
   - [ ] "기타" 선택 시 input + 페널티 안내 노출
   - [ ] 다른 radio 선택 시 "기타" input/안내 둘 다 사라짐
   - [ ] 저장 클릭 → 아무 동작 안 함
   - [ ] `/demo-widget-after` 진입 → 모든 radio 활성
   - [ ] 사진 첨부 + 기상악화 선택 → 저장 → 커스텀 모달 노출
   - [ ] 모달 확인 클릭 시 닫힘
   - [ ] 우하단 챗봇 floating 동작
   - [ ] 챗봇 열기 → 모바일 풀스크린, 헤더 안 깨짐
   - [ ] `/widget-demo`도 챗봇 헤더 안 깨짐 (regression 체크)

## 10. 향후 작업 (범위 밖)

- 위젯 자체 기능: 현재 라우터(`useLocation().pathname`) 자동 캡쳐 → Jira SR 본문 포함 (다른 세션 진행 중)
- Jira SR 완료 시 댓글에서 URL 변경 지시 (`/demo-widget-after`로 옮김) 수신
- Playwright로 댓글 내용 따라 매뉴얼 자동 수정 트리거 (브레인스토밍 단계)
