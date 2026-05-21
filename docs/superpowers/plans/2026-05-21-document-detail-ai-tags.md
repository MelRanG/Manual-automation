# 문서 상세 페이지 — AI 태그 자동 추천 & 즉시 추가 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/documents/:id` 상세 페이지에서 태그가 없는 문서에 한해 AI 추천 태그 패널을 자동 노출하고, 추천 수락·직접 입력·X 닫기를 즉시 PATCH로 저장한다.

**Architecture:**
- `TagEditor`(편집 페이지와 공유)에 `autoSuggestOnMount`·`onSuggestError` prop을 추가.
- `DocumentDetail` 내부에 `DetailTagPanel` 컴포넌트를 두고 헤더의 태그 영역에서 분기 렌더.
- dismissed 상태는 `sessionStorage[docops.tagSuggest.dismissed.${docId}]`로 동일 세션에서만 유지. 저장은 optimistic PATCH + rollback.

**Tech Stack:** React 18 + TypeScript, Vite, `react-router-dom`, `@/lib/api` (fetch wrapper), `sessionStorage`. 백엔드 변경 없음. 프론트엔드 자동 테스트 인프라 부재 → 수동 검증.

**Spec:** `docs/superpowers/specs/2026-05-21-document-detail-ai-tags-design.md`

---

## File Structure

| 파일 | 역할 | 변경 |
| --- | --- | --- |
| `frontend/src/components/TagEditor.tsx` | 태그 표시·삭제·추가·AI 추천 UI 컴포넌트 | 자동 호출/에러 통지 props 추가 |
| `frontend/src/pages/DocumentDetail.tsx` | 문서 상세 페이지 | 헤더 태그 분기 + 내부 `DetailTagPanel` 추가 |

신규 파일 없음. 백엔드 변경 없음.

---

## Task 1: TagEditor에 autoSuggestOnMount, onSuggestError props 추가

**Files:**
- Modify: `frontend/src/components/TagEditor.tsx:3-7` (props interface), `frontend/src/components/TagEditor.tsx:16` (signature), `frontend/src/components/TagEditor.tsx:43-53` (handleSuggest), `frontend/src/components/TagEditor.tsx` (마운트 useEffect 추가)

이 변경의 의도: 편집 페이지의 기존 사용처는 변경 없이 작동하고, 상세 페이지가 마운트 직후 자동 추천을 트리거하고 에러를 외부에서 받아갈 수 있도록 한다.

- [ ] **Step 1: Props 인터페이스 확장**

`frontend/src/components/TagEditor.tsx`의 `interface TagEditorProps` (현재 L3-7)를 다음으로 교체:

```tsx
interface TagEditorProps {
  tags: string[]
  onChange: (tags: string[]) => void
  onSuggest: () => Promise<string[]>
  autoSuggestOnMount?: boolean
  onSuggestError?: (e: unknown) => void
}
```

- [ ] **Step 2: 컴포넌트 시그니처 업데이트 + useEffect import**

파일 상단 import 라인을 다음으로 교체:

```tsx
import { useState, useEffect } from "react"
```

컴포넌트 시그니처(현재 L16)를 다음으로 교체:

```tsx
export function TagEditor({ tags, onChange, onSuggest, autoSuggestOnMount, onSuggestError }: TagEditorProps) {
```

- [ ] **Step 3: handleSuggest에서 에러 통지**

현재 `handleSuggest`의 `catch {}` 블록(L48-50)을 다음으로 교체:

```tsx
    } catch (e) {
      onSuggestError?.(e)
    } finally {
```

이때 `onSuggest` 호출이 빈 배열을 돌려주는 정상 케이스는 건드리지 않는다(에러만 통지).

- [ ] **Step 4: 마운트 시 자동 호출 useEffect 추가**

`useState` 선언 직후(현재 L17-19 다음 줄)에 다음을 추가:

```tsx
  useEffect(() => {
    if (autoSuggestOnMount) {
      void handleSuggest()
    }
    // 의도적으로 마운트 시 1회만 실행 — autoSuggestOnMount 토글로 재호출하지 않음
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

주의: `handleSuggest`는 컴포넌트 내부 클로저이므로 함수 정의가 useEffect보다 위에 있어야 한다면 useEffect를 `handleSuggest` 선언 뒤로 옮긴다. 현재 코드에서는 `handleSuggest`가 return 직전에 있으므로, useEffect는 `handleSuggest` 정의 다음 줄로 배치할 것.

- [ ] **Step 5: 편집 페이지 회귀 없음 확인**

`frontend/src/pages/DocumentEdit.tsx:122-126`의 `TagEditor` 사용처는 `autoSuggestOnMount`·`onSuggestError`를 넘기지 않으므로 기존 동작과 동일하다. 별도 수정 불필요.

수동 점검 명령:

```bash
cd frontend && pnpm typecheck
```

기대: 통과(0 error).

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/TagEditor.tsx
git commit -m "feat(tag-editor): add autoSuggestOnMount and onSuggestError props"
```

---

## Task 2: DocumentDetail에 태그 분기 + dismissed 상태 + DetailTagPanel 추가

**Files:**
- Modify: `frontend/src/pages/DocumentDetail.tsx` (import, dismissed 상태, 헤더 분기, 내부 `DetailTagPanel` 컴포넌트)

큰 변경이지만 한 파일에 응집된 변경이라 한 번에 처리한다. 단계별로 코드를 명시한다.

- [ ] **Step 1: import 추가**

`frontend/src/pages/DocumentDetail.tsx` 상단 import 묶음에 다음 라인을 추가:

```tsx
import { TagEditor } from "@/components/TagEditor"
```

(`useState`, `useRef`, `useEffect`는 이미 import되어 있다 — L1.)

- [ ] **Step 2: dismissed 상태와 헬퍼 정의**

`DocumentDetail` 함수 안, 기존 `useApi(() => api.getVersions(id!), [id])` 호출(L13) 바로 다음 줄에 다음 블록을 추가:

```tsx
  const dismissKey = `docops.tagSuggest.dismissed.${id}`
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(dismissKey) === "1"
    } catch {
      return false
    }
  })
  const dismissPanel = () => {
    try { sessionStorage.setItem(dismissKey, "1") } catch { /* noop */ }
    setDismissed(true)
  }
  const reopenPanel = () => {
    try { sessionStorage.removeItem(dismissKey) } catch { /* noop */ }
    setDismissed(false)
  }
```

- [ ] **Step 3: 헤더의 태그 칩 분기 교체**

현재 `frontend/src/pages/DocumentDetail.tsx:121-138`의 블록:

```tsx
          {doc.tags && doc.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {doc.tags.map(tag => {
                const depth = tag.split("/").length
                const colorClass = depth === 1 ? "bg-[#dde1ff] text-[#00288e]" : depth === 2 ? "bg-[#d5e3fc] text-[#1a56db]" : "bg-[#e8f0fe] text-[#444653]"
                return (
                  <span key={tag} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${colorClass}`}>
                    {tag.split("/").map((part, i) => (
                      <span key={i} className="flex items-center gap-0.5">
                        {i > 0 && <span className="opacity-40 text-[10px]">/</span>}
                        {part}
                      </span>
                    ))}
                  </span>
                )
              })}
            </div>
          )}
```

을 다음으로 교체:

```tsx
          {(doc.tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {doc.tags!.map(tag => {
                const depth = tag.split("/").length
                const colorClass = depth === 1 ? "bg-[#dde1ff] text-[#00288e]" : depth === 2 ? "bg-[#d5e3fc] text-[#1a56db]" : "bg-[#e8f0fe] text-[#444653]"
                return (
                  <span key={tag} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${colorClass}`}>
                    {tag.split("/").map((part, i) => (
                      <span key={i} className="flex items-center gap-0.5">
                        {i > 0 && <span className="opacity-40 text-[10px]">/</span>}
                        {part}
                      </span>
                    ))}
                  </span>
                )
              })}
            </div>
          )}
          {(doc.tags ?? []).length === 0 && (
            dismissed ? (
              <button
                type="button"
                onClick={reopenPanel}
                className="mt-3 inline-flex items-center gap-1 text-xs text-[#00288e] hover:underline"
              >
                <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                AI 추천 받기
              </button>
            ) : (
              <div className="mt-3">
                <DetailTagPanel docId={id!} onDismiss={dismissPanel} />
              </div>
            )
          )}
```

- [ ] **Step 4: DetailTagPanel 컴포넌트 정의 추가**

`DocumentDetail` export 함수의 닫는 `}` 바로 아래(파일 맨 끝)에 다음 함수를 추가:

```tsx
function DetailTagPanel({ docId, onDismiss }: { docId: string; onDismiss: () => void }) {
  const [localTags, setLocalTags] = useState<string[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [suggestError, setSuggestError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)

  const handleChange = async (next: string[]) => {
    const prev = localTags
    setLocalTags(next)
    setSaveError(null)
    try {
      await api.updateDocument(docId, { tags: next })
    } catch (e) {
      setLocalTags(prev)
      setSaveError(e instanceof Error ? e.message : "저장 실패")
    }
  }

  const retry = () => {
    setSuggestError(null)
    setAttempt(a => a + 1)
  }

  return (
    <div className="rounded-lg border border-[#dde1ff] bg-[#f7f9ff] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#444653] flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px] text-[#00288e]">auto_awesome</span>
          태그 — AI가 추천해드릴게요
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-[#444653] hover:text-[#191c1e] flex items-center gap-0.5"
          aria-label="추천 패널 닫기"
        >
          <span className="material-symbols-outlined text-[14px]">close</span>
          나중에
        </button>
      </div>
      {suggestError !== null && (
        <div className="flex items-center gap-2 text-xs text-[#ba1a1a]">
          <span>추천 불러오기 실패</span>
          <button type="button" onClick={retry} className="underline hover:no-underline">
            재시도
          </button>
        </div>
      )}
      {suggestError === null && (
        <TagEditor
          key={attempt}
          tags={localTags}
          onChange={handleChange}
          onSuggest={() => api.suggestTags(docId).then(r => r.tags)}
          autoSuggestOnMount
          onSuggestError={setSuggestError}
        />
      )}
      {saveError && (
        <p className="text-xs text-[#ba1a1a] bg-[#ffdad6] px-3 py-1.5 rounded-md">
          {saveError}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: 타입체크 + 린트 통과 확인**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

기대: 0 error.

흔한 문제와 처치:
- "`'useEffect' is not exported from 'react'`" → Task 1 Step 2의 import 라인이 적용되지 않은 것. `frontend/src/components/TagEditor.tsx` L1을 다시 확인한다.
- "`Cannot find name 'DetailTagPanel'`" → Task 2 Step 4의 함수 정의가 빠진 것. `DocumentDetail` export 닫는 `}` 다음에 추가했는지 확인한다.
- "`Object is possibly 'null'`" — `doc.tags!.map`의 non-null assertion이 거부될 수 있다. 그 경우 `doc.tags!` 대신 `(doc.tags ?? [])`로 풀어쓴다.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/pages/DocumentDetail.tsx
git commit -m "feat(documents): auto-suggest AI tags on detail page when empty"
```

---

## Task 3: 수동 검증

**Files:** 변경 없음.

프론트엔드 자동 테스트 인프라가 없으므로 다음 시나리오를 수동으로 한 번씩 돌린다. 백엔드는 `cd backend && uv run fastapi dev`, 프론트엔드는 `cd frontend && pnpm dev`로 띄운다.

- [ ] **Step 1: 사전 준비**

태그가 없는 문서 ID 하나, 태그가 1개 이상인 문서 ID 하나를 확보한다. 없으면 `/documents`에서 새 문서를 만들거나 `PATCH /documents/{id}`로 임의 문서의 `tags`를 빈 배열로 만든다.

DB에서 빠르게 확인:

```bash
# psql 또는 backend의 sqlite/postgres에 따라 다름. 예시:
# SELECT id, title, tags FROM documents ORDER BY created_at DESC LIMIT 5;
```

- [ ] **Step 2: 태그 없는 문서 — 자동 호출**

브라우저에서 `/documents/<태그없는-id>` 진입.

기대:
- 헤더 아래에 푸른 톤 추천 패널 표시
- 패널 안 `TagEditor`가 "분석 중..." 스피너 → 응답 후 점선 추천 칩 노출
- 네트워크 탭에 `POST /documents/<id>/suggest-tags` 1회만 발생

- [ ] **Step 3: 추천 수락 + 즉시 저장**

추천 칩 한 개를 클릭한다.

기대:
- 헤더 칩 자리에 채워진 chip 즉시 표시
- 네트워크 탭에 `PATCH /documents/<id>` 호출 → 200
- 추천 패널은 계속 떠 있음 (남은 추천 칩 보임)
- 페이지 새로고침 시 서버에서 가져온 `doc.tags`가 그 칩을 포함

- [ ] **Step 4: 직접 입력 + 즉시 저장**

패널 안 입력란에 "테스트/수동" 입력 → Enter.

기대:
- 헤더 chip에 즉시 반영
- `PATCH /documents/<id>` 호출 → 200
- 새로고침 후에도 보존

- [ ] **Step 5: "나중에" 닫기 + 세션 유지**

"나중에" 버튼 클릭. 헤더 태그를 다시 비우려면 편집 페이지에서 모두 지운 뒤(또는 별도 문서로) 다시 같은 문서에 진입.

같은 세션에서 동일 docId 재진입 시 기대:
- 자동 호출 없음
- "AI 추천 받기" 텍스트 링크만 표시
- 링크 클릭 → 패널 재마운트 + 자동 호출 1회

브라우저 새 탭(새 sessionStorage 컨텍스트)에서 같은 docId 진입 시 기대:
- 자동 호출 다시 발생

- [ ] **Step 6: 추천 실패 → 재시도**

DevTools에서 `POST /documents/<id>/suggest-tags`만 500으로 차단(또는 임시로 백엔드 라우터에서 강제 raise).

기대:
- 패널에 "추천 불러오기 실패 · 재시도" 표시
- 차단 해제 후 "재시도" 클릭 → `TagEditor`가 key 변경으로 재마운트되며 자동 호출 재발화 → 추천 chip 노출

- [ ] **Step 7: PATCH 실패 → 롤백**

DevTools에서 `PATCH /documents/<id>`만 500 차단. 추천 chip 한 개 클릭.

기대:
- 헤더 chip이 잠깐 채워졌다가 사라짐 (롤백)
- 패널 하단에 빨간 인라인 에러 메시지

- [ ] **Step 8: 태그 1개 이상 문서 — 기존 UX**

태그가 있는 문서로 진입.

기대:
- 추천 패널 미노출
- 기존 정적 chip 그대로
- `POST /documents/<id>/suggest-tags` 호출 없음

- [ ] **Step 9: 편집 페이지 회귀 확인**

`/documents/<id>/edit` 진입.

기대:
- 자동 추천 호출 없음(`autoSuggestOnMount` 미전달)
- "AI 추천" 버튼 클릭 시 1회 호출되는 기존 동작
- 저장 버튼은 명시적 클릭에만 PATCH

- [ ] **Step 10: 검증 결과 커밋(코드 변경이 있었던 경우만)**

검증 중 잡힌 버그가 있다면 그에 한해 추가 커밋. 없으면 별도 커밋 없이 통과.

---

## Self-Review Notes

- 스펙 §2의 옵션 (a) "TagEditor에 `autoSuggestOnMount` prop 추가" → Task 1에서 구현.
- 스펙 §3의 PATCH 실패 시 last-wins + 인라인 롤백 → Task 2 Step 4의 `handleChange`가 이전 값으로 복원.
- 스펙 §3의 sessionStorage 가용성 → Task 2 Step 2의 try/catch.
- 스펙의 "재시도 시 `<TagEditor key={attempt} ...>`로 재마운트" → Task 2 Step 4에 명시.
- 스펙의 "doc.tags null vs []" → Task 2 Step 3에서 `(doc.tags ?? []).length === 0`로 정규화.
- 자동 테스트 미포함 — 스펙의 "검증은 수동 절차" 방침과 일치.
