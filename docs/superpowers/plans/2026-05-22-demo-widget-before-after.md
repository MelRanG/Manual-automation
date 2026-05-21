# /demo-widget-before, /demo-widget-after Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 택배 기사용 배송 지연 보고 시연 페이지 두 개(`/demo-widget-before`, `/demo-widget-after`)를 만들고, 기존 `/widget-demo` 챗봇 모달의 모바일 헤더 깨짐 이슈를 같이 수정한다.

**Architecture:** 공통 컴포넌트 `DemoWidget`가 `allowAllReasons` / `onSaveBehavior` props로 두 페이지의 차이를 흡수한다. 두 wrapper 컴포넌트가 라우트별로 props만 다르게 주입. 백엔드 변경 없음, DB 연결 없음, 사진은 `URL.createObjectURL` 로컬 미리보기. 챗봇 위젯은 기존 `WidgetDemo`의 통합 패턴 재사용.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind CSS, react-router-dom, lucide-react.

**Notes for the engineer:**
- 사용자가 **커밋 금지** 요청. 다음 기능과 묶어서 별도 세션에서 커밋한다. 모든 task에서 commit 단계 제외.
- 한국어 문구는 spec에 적힌 그대로 사용. 임의 수정 금지.
- 자동화 테스트는 작성하지 않는다 (데모 페이지). 수동 체크리스트로 검증.
- spec: `docs/superpowers/specs/2026-05-22-demo-widget-before-after-design.md`

---

## File Structure

| 경로 | 작업 | 책임 |
|------|------|------|
| `frontend/src/pages/DemoWidget.tsx` | CREATE | 공통 시연 컴포넌트 (UI + 상태 + 챗봇) |
| `frontend/src/pages/DemoWidgetBefore.tsx` | CREATE | `<DemoWidget allowAllReasons={false} onSaveBehavior="none" />` |
| `frontend/src/pages/DemoWidgetAfter.tsx` | CREATE | `<DemoWidget allowAllReasons={true} onSaveBehavior="weather-modal" />` |
| `frontend/src/App.tsx` | MODIFY | 두 라우트 등록 (protected 밖, `/widget-demo` 옆) |
| `frontend/src/pages/WidgetDemo.tsx` | MODIFY | 챗봇 모달 컨테이너 모바일 헤더 안정화 (`h-[100dvh]`, `flex-shrink-0`, `min-h-0`) |

`Layout.tsx` 네비게이션 추가 안 함 (URL 직접 접속).

---

## Task 1: 상수 + 컴포넌트 골격 + Wrapper + 라우트

**목표:** 두 라우트로 진입 시 빈 셸이 보이고 typecheck/lint 통과. 이후 task에서 내용 채움.

**Files:**
- Create: `frontend/src/pages/DemoWidget.tsx`
- Create: `frontend/src/pages/DemoWidgetBefore.tsx`
- Create: `frontend/src/pages/DemoWidgetAfter.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 공통 컴포넌트 골격 작성**

파일: `frontend/src/pages/DemoWidget.tsx`

```tsx
export interface DemoWidgetProps {
  allowAllReasons: boolean
  onSaveBehavior: "none" | "weather-modal"
}

export const CUSTOMER = {
  address: "서울 강서구 마곡중앙로 143(마곡동), 르웨스트시티 타워 B동 10층",
  phone: "02-2127-8300",
  eta: "26.05.22, 10:30",
} as const

export const DEFAULT_MESSAGE = "고객님, 기다리시던 택배 배송드립니다."

export const TOAST = {
  title: "[물류통제실 알림]",
  body: "기상악화로 배송 지연 안내문 발송",
} as const

export const REASONS = [
  { key: "traffic",  label: "교통사고",          alwaysEnabled: true },
  { key: "address",  label: "주소지/연락처 오류", alwaysEnabled: true },
  { key: "weather",  label: "기상악화",          alwaysEnabled: false },
  { key: "holiday",  label: "명절",              alwaysEnabled: false },
  { key: "damage",   label: "포장 파손",         alwaysEnabled: true },
  { key: "etc",      label: "기타",              alwaysEnabled: true },
] as const

export type ReasonKey = (typeof REASONS)[number]["key"]

export function DemoWidget({ allowAllReasons, onSaveBehavior }: DemoWidgetProps) {
  return (
    <div className="min-h-screen bg-[#f7f9fb] flex flex-col items-center font-['Inter',sans-serif] text-[#191c1e]">
      <div className="w-full max-w-md flex flex-col">
        <div className="p-8 text-center text-sm text-[#444653]">
          DemoWidget shell ready · allowAllReasons={String(allowAllReasons)} · onSaveBehavior={onSaveBehavior}
        </div>
      </div>
    </div>
  )
}
```

> 이 placeholder 텍스트는 Task 2 시작 시 헤더로 교체됨. lint가 unused prop을 잡지 않게 하려고 일시적으로 표시.

- [ ] **Step 2: Before wrapper**

파일: `frontend/src/pages/DemoWidgetBefore.tsx`

```tsx
import { DemoWidget } from "./DemoWidget"

export function DemoWidgetBefore() {
  return <DemoWidget allowAllReasons={false} onSaveBehavior="none" />
}
```

- [ ] **Step 3: After wrapper**

파일: `frontend/src/pages/DemoWidgetAfter.tsx`

```tsx
import { DemoWidget } from "./DemoWidget"

export function DemoWidgetAfter() {
  return <DemoWidget allowAllReasons={true} onSaveBehavior="weather-modal" />
}
```

- [ ] **Step 4: 라우트 등록 (`App.tsx`)**

파일: `frontend/src/App.tsx`

import 추가 (`WidgetDemo` import 바로 아래):

```tsx
import { WidgetDemo } from "@/pages/WidgetDemo"
import { DemoWidgetBefore } from "@/pages/DemoWidgetBefore"
import { DemoWidgetAfter } from "@/pages/DemoWidgetAfter"
import { WidgetConversations } from "@/pages/WidgetConversations"
```

라우트 추가 (기존 `<Route path="/widget-demo" ... />` 바로 아래, ProtectedRoutes 블록 밖):

```tsx
<Route path="/widget-demo" element={<WidgetDemo />} />
<Route path="/demo-widget-before" element={<DemoWidgetBefore />} />
<Route path="/demo-widget-after" element={<DemoWidgetAfter />} />
<Route element={<ProtectedRoutes />}>
```

- [ ] **Step 5: typecheck + lint**

```bash
cd frontend && pnpm typecheck
cd frontend && pnpm lint
```

Expected: 둘 다 통과 (에러/경고 0개 또는 기존과 동일).

- [ ] **Step 6: dev 서버에서 두 라우트 진입 확인**

```bash
cd frontend && pnpm dev
```

브라우저 진입:
- `http://localhost:5173/demo-widget-before` → "DemoWidget shell ready · allowAllReasons=false · onSaveBehavior=none"
- `http://localhost:5173/demo-widget-after` → "DemoWidget shell ready · allowAllReasons=true · onSaveBehavior=weather-modal"

Expected: 둘 다 흰 배경에 텍스트 보임. 콘솔 에러 없음.

---

## Task 2: 상단 헤더 + 토스트

**목표:** 상단 sticky 헤더와 마운트 2초 후 노출되는 수동 닫기 토스트 추가.

**Files:**
- Modify: `frontend/src/pages/DemoWidget.tsx`

- [ ] **Step 1: import + state 추가**

`frontend/src/pages/DemoWidget.tsx` 맨 위 import 갱신:

```tsx
import { useEffect, useState } from "react"
import { ArrowLeft, Info, AlertTriangle, X } from "lucide-react"
```

- [ ] **Step 2: 토스트 상태 + setTimeout 추가**

`DemoWidget` 함수 본문 시작 (return 위):

```tsx
export function DemoWidget({ allowAllReasons, onSaveBehavior }: DemoWidgetProps) {
  const [toastOpen, setToastOpen] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setToastOpen(true), 2000)
    return () => window.clearTimeout(id)
  }, [])

  return (
    // ... 다음 step에서 교체
  )
}
```

- [ ] **Step 3: 컴포넌트 return 본문 교체 (헤더 + 토스트 + placeholder 영역)**

기존 placeholder return JSX를 다음으로 교체:

```tsx
  return (
    <div className="min-h-screen bg-[#f7f9fb] flex flex-col items-center font-['Inter',sans-serif] text-[#191c1e]">
      <div className="w-full max-w-md flex flex-col">
        {/* 상단 헤더 */}
        <header className="sticky top-0 z-30 bg-white border-b border-[#c4c5d5] h-14 px-4 flex items-center justify-between">
          <button
            type="button"
            className="text-[#191c1e] p-1 -ml-1"
            aria-label="뒤로"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-semibold">배송 상세</h1>
          <button
            type="button"
            className="text-[#191c1e] p-1 -mr-1"
            aria-label="도움말"
          >
            <Info size={20} />
          </button>
        </header>

        {/* 토스트 */}
        {toastOpen && (
          <div
            role="status"
            className="sticky top-14 z-20 bg-[#fff4d0] border-l-4 border-[#f59e0b] text-[#7a4f00] px-4 py-3 flex items-start gap-2"
          >
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm leading-snug">
              <div className="font-semibold">{TOAST.title}</div>
              <div>{TOAST.body}</div>
            </div>
            <button
              type="button"
              onClick={() => setToastOpen(false)}
              aria-label="알림 닫기"
              className="text-[#7a4f00] p-1 -mr-1 flex-shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* 폼 영역 (다음 task에서 채움) */}
        <div className="p-4 text-sm text-[#444653]">
          (form area placeholder) · allowAllReasons={String(allowAllReasons)} · onSaveBehavior={onSaveBehavior}
        </div>
      </div>
    </div>
  )
```

- [ ] **Step 4: typecheck + lint**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: 통과.

- [ ] **Step 5: 수동 검증**

브라우저 dev tools 모바일 모드 (375x812 iPhone 13) → `http://localhost:5173/demo-widget-before` 접속:

- [ ] 상단 헤더 "배송 상세" 가운데, 좌측 ←, 우측 ⓘ
- [ ] 페이지 진입 후 ~2초 뒤 노란 토스트 노출
- [ ] 토스트 내용: "[물류통제실 알림] / 기상악화로 배송 지연 안내문 발송"
- [ ] 토스트 X 클릭 시 닫힘
- [ ] 토스트 자동 닫힘 없음 (10초 이상 기다려 확인)

---

## Task 3: 고정값 카드 + 메시지 textarea

**목표:** 배송 정보 고정값 카드와 고객 전달 메시지 textarea 추가.

**Files:**
- Modify: `frontend/src/pages/DemoWidget.tsx`

- [ ] **Step 1: message state 추가**

`DemoWidget` 본문에 `toastOpen` state 아래 추가:

```tsx
const [message, setMessage] = useState(DEFAULT_MESSAGE)
```

- [ ] **Step 2: 폼 placeholder 영역을 카드 두 개로 교체**

`{/* 폼 영역 ... placeholder */}` 블록을 다음으로 교체:

```tsx
        {/* 폼 영역 */}
        <main className="flex flex-col gap-4 p-4 pb-32">
          {/* 배송 정보 카드 */}
          <section className="bg-white rounded-lg border border-[#c4c5d5] p-4">
            <h2 className="text-sm font-semibold text-[#191c1e] mb-3 flex items-center gap-1.5">
              <span aria-hidden>📍</span> 배송 정보
            </h2>
            <dl className="grid grid-cols-[88px_1fr] gap-y-2 text-sm">
              <dt className="text-[#757684]">고객 주소</dt>
              <dd className="text-[#191c1e] leading-snug">{CUSTOMER.address}</dd>
              <dt className="text-[#757684]">고객 번호</dt>
              <dd className="text-[#191c1e]">{CUSTOMER.phone}</dd>
              <dt className="text-[#757684]">예상 배송 시간</dt>
              <dd className="text-[#191c1e]">{CUSTOMER.eta}</dd>
            </dl>
          </section>

          {/* 메시지 카드 */}
          <section className="bg-white rounded-lg border border-[#c4c5d5] p-4">
            <h2 className="text-sm font-semibold text-[#191c1e] mb-2 flex items-center gap-1.5">
              <span aria-hidden>💬</span> 고객 전달 메시지
            </h2>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full border border-[#c4c5d5] rounded p-2 text-sm focus:outline-none focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] resize-none"
            />
          </section>
        </main>
```

- [ ] **Step 3: typecheck + lint**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: 통과.

- [ ] **Step 4: 수동 검증**

`http://localhost:5173/demo-widget-before` (모바일 viewport):

- [ ] 토스트 아래 흰 카드 두 개
- [ ] 배송 정보 카드: 주소/번호/예상 시간 정확히 표시 (spec 값 그대로)
- [ ] 메시지 textarea 기본문구 "고객님, 기다리시던 택배 배송드립니다." 입력됨
- [ ] textarea 수정 가능, focus 시 파란 보더

---

## Task 4: 사진 첨부 영역

**목표:** 빈 상태 → 사진 첨부 → 썸네일 + ✕로 제거 흐름.

**Files:**
- Modify: `frontend/src/pages/DemoWidget.tsx`

- [ ] **Step 1: 사진 state + cleanup**

`message` state 아래 추가:

```tsx
const [photoUrl, setPhotoUrl] = useState<string | null>(null)

useEffect(() => {
  return () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl)
  }
}, [photoUrl])
```

- [ ] **Step 2: 핸들러 추가**

`DemoWidget` 본문, return 직전:

```tsx
function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  if (!file) return
  if (photoUrl) URL.revokeObjectURL(photoUrl)
  setPhotoUrl(URL.createObjectURL(file))
  // input value 리셋해서 동일 파일 다시 선택해도 onChange 발화
  e.target.value = ""
}

function handlePhotoRemove() {
  if (photoUrl) URL.revokeObjectURL(photoUrl)
  setPhotoUrl(null)
}
```

import에 `Camera` 추가 (lucide):

```tsx
import { ArrowLeft, Info, AlertTriangle, X, Camera } from "lucide-react"
```

- [ ] **Step 3: 메시지 카드 위에 사진 카드 추가**

`{/* 메시지 카드 */}` 바로 위에 다음 섹션 삽입:

```tsx
          {/* 사진 카드 */}
          <section className="bg-white rounded-lg border border-[#c4c5d5] p-4">
            <h2 className="text-sm font-semibold text-[#191c1e] mb-2 flex items-center gap-1.5">
              <span aria-hidden>📷</span> 현장 사진
            </h2>
            {photoUrl ? (
              <div className="flex items-center gap-3">
                <img
                  src={photoUrl}
                  alt="현장 사진"
                  className="w-20 h-20 object-cover rounded border border-[#c4c5d5]"
                />
                <button
                  type="button"
                  onClick={handlePhotoRemove}
                  className="text-sm text-[#7a1d1d] underline"
                >
                  사진 제거
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[#c4c5d5] rounded p-6 cursor-pointer hover:bg-[#f7f9fb] transition-colors">
                <Camera size={28} className="text-[#757684]" />
                <span className="text-sm text-[#444653]">사진 첨부</span>
                <span className="text-xs text-[#757684]">탭하여 카메라/갤러리</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
              </label>
            )}
          </section>
```

- [ ] **Step 4: typecheck + lint**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: 통과.

- [ ] **Step 5: 수동 검증**

`http://localhost:5173/demo-widget-before` (모바일 viewport):

- [ ] 사진 카드 빈 상태: 점선 박스 + 카메라 아이콘 + "사진 첨부" 안내
- [ ] 파일 선택 후 썸네일 80x80 + "사진 제거" 링크 노출
- [ ] "사진 제거" 클릭 → 빈 상태로 복귀
- [ ] 같은 파일 다시 선택 시 onChange 다시 발화 (썸네일 갱신)

---

## Task 5: 지연사유 radio 영역

**목표:** 사진 첨부 후에만 radio 6개 노출. `allowAllReasons=false`면 `weather`/`holiday` disabled.

**Files:**
- Modify: `frontend/src/pages/DemoWidget.tsx`

- [ ] **Step 1: reason state 추가**

`photoUrl` state 아래 추가:

```tsx
const [reason, setReason] = useState<ReasonKey | null>(null)
```

- [ ] **Step 2: 사진 카드 아래에 지연사유 카드 추가**

`{/* 메시지 카드 */}` 위, `{/* 사진 카드 */}` 아래에 삽입:

```tsx
          {/* 지연사유 카드 (사진 있을 때만) */}
          {photoUrl && (
            <section className="bg-white rounded-lg border border-[#c4c5d5] p-4">
              <h2 className="text-sm font-semibold text-[#191c1e] mb-3 flex items-center gap-1.5">
                <span aria-hidden>📋</span> 지연 사유
              </h2>
              <div className="flex flex-col gap-2">
                {REASONS.map((r) => {
                  const disabled = !r.alwaysEnabled && !allowAllReasons
                  return (
                    <label
                      key={r.key}
                      className={`flex items-center gap-2 text-sm ${
                        disabled
                          ? "opacity-50 line-through text-[#757684] cursor-not-allowed"
                          : "text-[#191c1e] cursor-pointer"
                      }`}
                    >
                      <input
                        type="radio"
                        name="reason"
                        value={r.key}
                        checked={reason === r.key}
                        onChange={() => setReason(r.key)}
                        disabled={disabled}
                        className="text-[#00288e] focus:ring-[#00288e]"
                      />
                      <span>{r.label}</span>
                    </label>
                  )
                })}
              </div>
            </section>
          )}
```

- [ ] **Step 3: 사진 제거 시 reason 초기화**

`handlePhotoRemove` 함수에 reason 초기화 추가:

```tsx
function handlePhotoRemove() {
  if (photoUrl) URL.revokeObjectURL(photoUrl)
  setPhotoUrl(null)
  setReason(null)
}
```

- [ ] **Step 4: typecheck + lint**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: 통과.

- [ ] **Step 5: 수동 검증 (before + after 모두)**

`http://localhost:5173/demo-widget-before`:

- [ ] 사진 첨부 전: 지연사유 카드 안 보임
- [ ] 사진 첨부 후: radio 6개 노출
- [ ] 기상악화, 명절: 회색 + 취소선 + opacity 50%, 클릭 안 됨
- [ ] 교통사고, 주소지/연락처 오류, 포장 파손, 기타: 정상 선택 가능
- [ ] 사진 제거 시 지연사유 카드 다시 숨김

`http://localhost:5173/demo-widget-after`:

- [ ] 사진 첨부 후: 모든 6개 radio 활성 (취소선 없음)
- [ ] 기상악화 선택 가능

---

## Task 6: "기타" input + 페널티 안내

**목표:** 기타 radio 선택 시 input + 페널티 안내 노출. 다른 radio 선택 시 둘 다 사라짐.

**Files:**
- Modify: `frontend/src/pages/DemoWidget.tsx`

- [ ] **Step 1: etc text state 추가**

`reason` state 아래 추가:

```tsx
const [reasonEtcText, setReasonEtcText] = useState("")
```

- [ ] **Step 2: REASONS.map 안에 기타 input 노출 로직 추가**

기존 `<label>...</label>` 만 반환하던 부분을 React Fragment로 감싸고, etc 선택 시 input + 안내 추가:

```tsx
                {REASONS.map((r) => {
                  const disabled = !r.alwaysEnabled && !allowAllReasons
                  return (
                    <div key={r.key} className="flex flex-col gap-2">
                      <label
                        className={`flex items-center gap-2 text-sm ${
                          disabled
                            ? "opacity-50 line-through text-[#757684] cursor-not-allowed"
                            : "text-[#191c1e] cursor-pointer"
                        }`}
                      >
                        <input
                          type="radio"
                          name="reason"
                          value={r.key}
                          checked={reason === r.key}
                          onChange={() => setReason(r.key)}
                          disabled={disabled}
                          className="text-[#00288e] focus:ring-[#00288e]"
                        />
                        <span>{r.label}</span>
                      </label>
                      {r.key === "etc" && reason === "etc" && (
                        <input
                          type="text"
                          value={reasonEtcText}
                          onChange={(e) => setReasonEtcText(e.target.value)}
                          placeholder="사유를 입력하세요"
                          className="ml-6 w-[calc(100%-1.5rem)] border border-[#c4c5d5] rounded px-2 py-1 text-sm focus:outline-none focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e]"
                        />
                      )}
                    </div>
                  )
                })}
```

- [ ] **Step 3: 페널티 안내 (radio 리스트 아래)**

지연사유 카드 안, `</div>` (radio map div 닫힘) 직후에 추가:

```tsx
              </div>
              {reason === "etc" && (
                <div className="mt-3 bg-[#fff4d0] border-l-4 border-[#f59e0b] text-[#7a4f00] text-xs p-3 rounded flex items-start gap-2">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>사유를 소명하지 않으면 정시 배송률 하락으로 페널티를 받을 수 있습니다</span>
                </div>
              )}
            </section>
```

- [ ] **Step 4: typecheck + lint**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: 통과.

- [ ] **Step 5: 수동 검증**

`http://localhost:5173/demo-widget-before`:

- [ ] 사진 첨부 후 "기타" 선택 → radio 바로 아래 input 노출 + 카드 아래 노란 페널티 안내
- [ ] "교통사고" 선택 → input 사라짐 + 페널티 안내 사라짐
- [ ] 다시 "기타" 선택 → input 노출 (이전 입력값 유지됨)
- [ ] input에 글자 입력 가능

---

## Task 7: 저장 버튼 + 커스텀 모달 (after)

**목표:** 하단 sticky 저장 버튼. before는 클릭 효과만, after는 weather 모달 노출.

**Files:**
- Modify: `frontend/src/pages/DemoWidget.tsx`

- [ ] **Step 1: modal state + import**

`reasonEtcText` state 아래 추가:

```tsx
const [modalOpen, setModalOpen] = useState(false)
```

import에 `CloudRain` 추가:

```tsx
import { ArrowLeft, Info, AlertTriangle, X, Camera, CloudRain } from "lucide-react"
```

- [ ] **Step 2: handleSave 함수**

`handlePhotoRemove` 아래 추가:

```tsx
function handleSave() {
  if (onSaveBehavior === "weather-modal") {
    setModalOpen(true)
  }
  // "none": 의도적으로 아무 동작 없음
}
```

- [ ] **Step 3: 저장 버튼 (하단 sticky)**

`<main>` 닫힘 직전에 버튼 추가하면 sticky 작동 안 함. `<main>` 밖, max-w-md div 안 마지막에 추가:

`</main>` 바로 아래:

```tsx
        </main>

        {/* 하단 sticky 저장 버튼 */}
        <div className="sticky bottom-0 z-40 bg-white border-t border-[#c4c5d5] p-4 pr-20">
          <button
            type="button"
            onClick={handleSave}
            className="w-full bg-[#00288e] hover:bg-[#1e40af] text-white font-semibold py-3 rounded-lg transition-colors"
          >
            저장
          </button>
        </div>
```

`pr-20` (우측 5rem padding) — 챗봇 floating 버튼(우하단 14px+24px*2=~62px)과 시각적으로 안 겹치게.

- [ ] **Step 4: weather 모달**

max-w-md div 닫힘 직전에 모달 추가:

```tsx
        </div>

        {/* Weather Modal (after only) */}
        {modalOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setModalOpen(false)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center mb-4">
                <CloudRain size={60} className="text-[#00288e]" />
              </div>
              <p className="text-lg font-semibold text-[#191c1e] text-center leading-snug">
                현재 기상악화 상태입니다.<br />
                조심히 운행하세요
              </p>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="mt-6 w-full bg-[#00288e] hover:bg-[#1e40af] text-white font-semibold py-3 rounded-lg transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        )}
```

> 주의: max-w-md `<div>` **밖**이 아니라 안 마지막에 배치. fixed 요소라 위치는 상관없지만 컴포넌트 트리 안에 둠.

- [ ] **Step 5: typecheck + lint**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: 통과.

- [ ] **Step 6: 수동 검증 (before + after)**

`http://localhost:5173/demo-widget-before`:

- [ ] 스크롤 내려도 저장 버튼 하단 고정
- [ ] 저장 클릭 → 아무 일도 안 일어남 (모달 없음, 콘솔 에러 없음)

`http://localhost:5173/demo-widget-after`:

- [ ] 저장 클릭 → 가운데 모달 노출
- [ ] 모달 내용: 🌧️ 아이콘 + "현재 기상악화 상태입니다.\n조심히 운행하세요" + "확인" 버튼
- [ ] 확인 클릭 → 모달 닫힘
- [ ] 배경(어두운 영역) 클릭 → 모달 닫힘
- [ ] 모달 내부 클릭 시 닫히지 않음

---

## Task 8: 챗봇 위젯 통합 + 모바일 헤더 안정화

**목표:** 두 demo 페이지에 챗봇 floating 위젯 추가. 같은 코드 패턴이 깨져 있는 기존 `/widget-demo` 챗봇 헤더 이슈도 같이 수정.

**Files:**
- Modify: `frontend/src/pages/DemoWidget.tsx`
- Modify: `frontend/src/pages/WidgetDemo.tsx`

- [ ] **Step 1: DemoWidget에 챗봇 통합 (WidgetDemo 패턴 재사용)**

`frontend/src/pages/DemoWidget.tsx` import 상단 확장:

```tsx
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Info, AlertTriangle, X, Camera, CloudRain } from "lucide-react"
import { useChatSession } from "@/hooks/useChatSession"
import { buildWidgetAdapter } from "@/lib/chatAdapters"
import { ChatPanel } from "@/components/chat/ChatPanel"
```

`modalOpen` state 아래에 챗봇 관련 state/hook 추가:

```tsx
const [chatOpen, setChatOpen] = useState(false)
const [sessionId, setSessionId] = useState<string | null>(null)
const adapter = useMemo(() => buildWidgetAdapter(null), [])
const chat = useChatSession({ sessionId, userId: null, api: adapter })

const pendingSendRef = useRef(false)

async function ensureSession(): Promise<string> {
  if (sessionId) return sessionId
  const res = await fetch("/api/widget/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site_id: "demo_courier",
      anonymous_id: "demo_courier_user",
      user_id: null,
    }),
  })
  const data = await res.json()
  const id = data.id as string
  setSessionId(id)
  return id
}

const sendWithSession = async () => {
  if (!sessionId) {
    pendingSendRef.current = true
    await ensureSession()
    return
  }
  chat.send()
}

useEffect(() => {
  if (sessionId && pendingSendRef.current) {
    pendingSendRef.current = false
    chat.send()
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [sessionId, chat.send])

const chatWithLazySend = { ...chat, send: sendWithSession }

const emptyState = (
  <div className="text-center text-sm text-[#444653] mt-8">
    <span
      className="material-symbols-outlined text-4xl text-[#00288e] mb-2 block"
      style={{ fontVariationSettings: "'FILL' 1" }}
    >
      smart_toy
    </span>
    안녕하세요! 배송 도우미입니다.<br />무엇을 도와드릴까요?
  </div>
)
```

- [ ] **Step 2: body 스크롤 잠금 (챗봇 풀스크린 안정화)**

위 코드 블록 아래 추가:

```tsx
useEffect(() => {
  if (!chatOpen) return
  const prev = document.body.style.overflow
  document.body.style.overflow = "hidden"
  return () => {
    document.body.style.overflow = prev
  }
}, [chatOpen])
```

- [ ] **Step 3: 챗봇 floating 버튼/모달 JSX**

weather modal 닫힘 `</div>` (가장 바깥 `min-h-screen` div) 직전에 챗봇 블록 추가:

```tsx
      {/* Floating Chatbot */}
      {chatOpen ? (
        <div className="fixed z-50 inset-0 md:inset-auto md:bottom-8 md:right-8 md:flex md:flex-col md:items-end">
          <div className="w-full bg-white flex flex-col overflow-hidden h-[100dvh] md:w-[400px] md:h-[550px] md:rounded-xl md:shadow-[0_10px_25px_rgba(0,0,0,0.15)] md:border md:border-[#c4c5d5]">
            <div className="bg-[#00288e] text-white p-4 pt-[calc(env(safe-area-inset-top)+1rem)] flex-shrink-0 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span
                  className="material-symbols-outlined"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  smart_toy
                </span>
                <span className="text-xl font-semibold">DocOps AI 어시스턴트</span>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setChatOpen(false)}
                  className="text-white/80 hover:text-white transition-colors p-1"
                  aria-label="닫기"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ChatPanel chat={chatWithLazySend} variant="compact" emptyState={emptyState} />
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="fixed bottom-8 right-8 z-50 w-14 h-14 rounded-full bg-[#00288e] text-white shadow-lg hover:bg-[#1e40af] transition-all hover:scale-105 flex items-center justify-center"
          aria-label="챗봇 열기"
        >
          <span
            className="material-symbols-outlined text-2xl"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            smart_toy
          </span>
        </button>
      )}
```

- [ ] **Step 4: WidgetDemo.tsx 챗봇 모달 헤더 안정화**

파일: `frontend/src/pages/WidgetDemo.tsx`

기존 챗봇 풀스크린 블록 (~line 268-287) 찾기:

```tsx
{chatOpen ? (
  <div className="fixed z-50 inset-0 md:inset-auto md:bottom-8 md:right-8 md:flex md:flex-col md:items-end">
    <div className="w-full h-full md:w-[400px] md:h-[550px] bg-white md:rounded-xl md:shadow-[0_10px_25px_rgba(0,0,0,0.15)] md:border md:border-[#c4c5d5] flex flex-col overflow-hidden">
      <div className="bg-[#00288e] text-white p-4 pt-[calc(env(safe-area-inset-top)+1rem)] flex justify-between items-center">
```

다음으로 교체:

```tsx
{chatOpen ? (
  <div className="fixed z-50 inset-0 md:inset-auto md:bottom-8 md:right-8 md:flex md:flex-col md:items-end">
    <div className="w-full bg-white flex flex-col overflow-hidden h-[100dvh] md:w-[400px] md:h-[550px] md:rounded-xl md:shadow-[0_10px_25px_rgba(0,0,0,0.15)] md:border md:border-[#c4c5d5]">
      <div className="bg-[#00288e] text-white p-4 pt-[calc(env(safe-area-inset-top)+1rem)] flex-shrink-0 flex justify-between items-center">
```

(변경점: 외부 div의 `h-full` 제거 + `h-[100dvh]` 추가, 헤더 div에 `flex-shrink-0` 추가)

다음 그 `<ChatPanel ... />` 호출을 감싸는 부분 — 현재는 헤더 div 닫힘 직후 `<ChatPanel chat={chatWithLazySend} variant="compact" emptyState={emptyState} />` 가 바로 있음. 이를 다음과 같이 div로 감쌈:

```tsx
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ChatPanel chat={chatWithLazySend} variant="compact" emptyState={emptyState} />
            </div>
          </div>
        </div>
```

(헤더 div 닫는 `</div>` 다음에 `<div className="flex-1 min-h-0 overflow-hidden">` 추가, ChatPanel 감싼 후 `</div>` 닫음)

- [ ] **Step 5: WidgetDemo에도 body scroll lock 추가**

`WidgetDemo` 함수 내부 다른 `useEffect` 아래 (기존 isFirstRender 패턴 다음) 추가:

```tsx
useEffect(() => {
  if (!chatOpen) return
  const prev = document.body.style.overflow
  document.body.style.overflow = "hidden"
  return () => {
    document.body.style.overflow = prev
  }
}, [chatOpen])
```

- [ ] **Step 6: typecheck + lint**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: 통과.

- [ ] **Step 7: 수동 검증 (모바일 viewport 375px)**

`http://localhost:5173/demo-widget-before`:

- [ ] 우하단 둥근 챗봇 버튼 floating, 스크롤 따라가지 않음
- [ ] 챗봇 열기 → 풀스크린 모달
- [ ] 상단 헤더 (DocOps AI 어시스턴트) **고정**, 메시지 영역 스크롤해도 안 사라짐
- [ ] 헤더 우측 X 버튼으로 닫힘
- [ ] 챗봇 열린 동안 뒤 페이지 스크롤 잠김
- [ ] 챗봇 안에서 입력 가능 (실제 메시지 전송은 백엔드 작동 시)

`http://localhost:5173/widget-demo` (regression):

- [ ] 위와 동일하게 챗봇 헤더 안 깨짐
- [ ] 기존 동작 (Asiana 페이지) 변경 없음 — nav, hero, bento grid 정상

---

## Task 9: 최종 검증

**목표:** 전체 동작 체크리스트 통과.

- [ ] **Step 1: typecheck + lint 최종**

```bash
cd frontend && pnpm typecheck
cd frontend && pnpm lint
```

Expected: 둘 다 통과, 경고 0개 (또는 기존과 동일).

- [ ] **Step 2: 빌드 확인**

```bash
cd frontend && pnpm build
```

Expected: 성공, 새 라우트 chunk 생성.

- [ ] **Step 3: 수동 시연 체크리스트 (모바일 viewport 375x812)**

`http://localhost:5173/demo-widget-before`:

- [ ] 진입 직후: 헤더 + (placeholder 없음) 폼 카드들 노출
- [ ] 2초 후 토스트 노출, X로 수동 닫힘만 가능
- [ ] 사진 첨부 전: 지연사유 카드 보이지 않음
- [ ] 사진 첨부 후: 지연사유 카드 노출
- [ ] 썸네일 표시, "사진 제거" 클릭 시 사진 제거 + 지연사유 카드 숨김
- [ ] 기상악화/명절 radio: 회색 + 취소선 + opacity 50%, 클릭 차단
- [ ] "기타" radio: input + 페널티 안내 노출. 다른 radio 선택 시 사라짐
- [ ] 저장 클릭: 아무 동작 없음
- [ ] 챗봇 floating 동작, 풀스크린 헤더 안 깨짐

`http://localhost:5173/demo-widget-after`:

- [ ] 모든 radio 활성
- [ ] 사진 첨부 + 기상악화 선택 + 저장 → 모달 노출
- [ ] 모달 🌧️ 아이콘 + "현재 기상악화 상태입니다.\n조심히 운행하세요" + 확인 버튼
- [ ] 확인 또는 배경 클릭 시 닫힘

`http://localhost:5173/widget-demo` (regression):

- [ ] 챗봇 헤더 모바일에서 안 깨짐
- [ ] Asiana 페이지 본 컨텐츠 정상

- [ ] **Step 4: 커밋 — 진행하지 않음**

> 사용자가 명시적으로 커밋 금지 요청. 변경 사항은 다음 기능과 묶어 별도 세션에서 커밋한다.

작업 완료 보고 시 다음 사실만 전달:
- 새 파일 3개: `DemoWidget.tsx`, `DemoWidgetBefore.tsx`, `DemoWidgetAfter.tsx`
- 수정 파일 2개: `App.tsx`, `WidgetDemo.tsx`
- 백엔드 변경 없음
- 두 새 URL 진입 가능: `/demo-widget-before`, `/demo-widget-after`
- 기존 `/widget-demo` 챗봇 헤더 이슈도 같이 수정됨

---

## Self-Review

**Spec coverage:**
- §2 라우팅/파일구조 → Task 1
- §3 UI 레이아웃 → Task 2-7
- §4 상태/상호작용 → Task 2-7 (각 영역 분산)
- §5 After 차이 → Task 5 (radio disabled), Task 7 (모달)
- §6 챗봇 통합 → Task 8
- §7 챗봇 헤더 안정화 → Task 8 (`WidgetDemo` 포함)
- §8 데이터/상수 → Task 1
- §9 검증 → Task 9

모든 spec 항목 커버됨.

**Placeholder scan:** TBD/TODO/"implement later" 없음. 각 step에 실제 코드 포함.

**Type consistency:**
- `ReasonKey` Task 1 정의, Task 5에서 `useState<ReasonKey | null>(null)` 사용. 일치.
- `DemoWidgetProps` Task 1 정의, Task 2~7 같은 props 이름 (`allowAllReasons`, `onSaveBehavior`) 사용. 일치.
- `onSaveBehavior` 값 `"none" | "weather-modal"` Task 1 / Task 7 일치.
