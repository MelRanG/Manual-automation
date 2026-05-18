# Feedback 문서 선택 드롭다운 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feedback 페이지의 문서 ID 텍스트 입력을 인라인 드롭다운 선택 UI로 교체한다.

**Architecture:** `Feedback.tsx` 단일 파일 내에 `DocumentPickerDropdown` 컴포넌트를 추가한다. 마운트 시 `api.listDocuments(0, 100)`으로 전체 목록을 로드하고, 검색은 프론트에서 title 기준 필터링으로 처리한다. 선택된 `doc.id`는 기존 `docId` state에 저장되므로 제출 로직 변경이 없다.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, 기존 `api.listDocuments`

---

## 파일 구조

- **수정:** `frontend/src/pages/Feedback.tsx`
  - `DocumentPickerDropdown` 컴포넌트 추가 (파일 상단, `Feedback` 컴포넌트 위)
  - `Feedback` 컴포넌트에서 `docId` 텍스트 input을 `DocumentPickerDropdown`으로 교체
  - `docTitle` state 추가 (태그 표시용)

---

### Task 1: DocumentPickerDropdown 컴포넌트 추가

**Files:**
- Modify: `frontend/src/pages/Feedback.tsx`

- [ ] **Step 1: `docTitle` state와 `DocumentPickerDropdown` 컴포넌트를 추가한다**

`Feedback.tsx` 파일 상단 import 바로 아래, `Feedback` 함수 선언 위에 다음 컴포넌트를 삽입한다.

```tsx
import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { api, type Document, type FeedbackReport, type ProposedChange } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"

interface DocumentPickerDropdownProps {
  value: string
  onChange: (id: string, title: string) => void
  onClear: () => void
}

function DocumentPickerDropdown({ value, onChange, onClear }: DocumentPickerDropdownProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [documents, setDocuments] = useState<Document[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.listDocuments(0, 100).then(res => setDocuments(res.documents))
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const filtered = documents.filter(d =>
    d.title.toLowerCase().includes(query.toLowerCase())
  )

  const selectedDoc = documents.find(d => d.id === value)

  return (
    <div ref={ref} className="relative">
      {selectedDoc ? (
        <div className="flex items-center gap-2 px-3 py-2 border border-[#c4c5d5] rounded-lg bg-[#eeeeff]">
          <span className="material-symbols-outlined text-sm text-[#4a4bdc]">description</span>
          <span className="flex-1 text-sm text-[#4a4bdc] font-medium truncate">{selectedDoc.title}</span>
          <button
            type="button"
            onClick={onClear}
            className="text-[#9a9bad] hover:text-[#1a1b25] transition-colors"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-left px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#9a9bad] hover:border-[#00288e] transition-colors"
        >
          관련 문서 선택 (선택사항)
        </button>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-[#4a4bdc] rounded-lg shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-[#e4e5f0]">
            <input
              autoFocus
              className="w-full text-sm outline-none placeholder-[#9a9bad]"
              placeholder="문서 검색..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-[#9a9bad]">검색 결과가 없습니다</li>
            ) : (
              filtered.map(doc => (
                <li
                  key={doc.id}
                  onClick={() => { onChange(doc.id, doc.title); setOpen(false); setQuery("") }}
                  className="px-4 py-3 cursor-pointer hover:bg-[#f0f0ff] border-b border-[#f0f0f5] last:border-0 transition-colors"
                >
                  <p className="text-sm font-semibold text-[#1a1b25]">{doc.title}</p>
                  <p className="text-xs text-[#5a5b6e] mt-0.5 truncate">{doc.description ?? "설명 없음"}</p>
                  <p className="text-[10px] text-[#9a9bad] mt-1">
                    최근 수정 · {new Date(doc.updated_at).toLocaleDateString("ko-KR")}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `Feedback` 컴포넌트에 `docTitle` state를 추가하고, 기존 `docId` input을 `DocumentPickerDropdown`으로 교체한다**

`Feedback` 컴포넌트 내 state 선언 부분에 `docTitle` 추가:

```tsx
const [docId, setDocId] = useState("")
const [docTitle, setDocTitle] = useState("")
```

`handleSubmit` 내 초기화에 `docTitle` 추가:

```tsx
setText("")
setDocId("")
setDocTitle("")
```

기존 `<input>` (문서 ID 입력 필드) 를 아래로 교체:

```tsx
<DocumentPickerDropdown
  value={docId}
  onChange={(id, title) => { setDocId(id); setDocTitle(title) }}
  onClear={() => { setDocId(""); setDocTitle("") }}
/>
```

- [ ] **Step 3: 타입 체크 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 4: 개발 서버에서 동작 확인**

```bash
cd frontend && pnpm dev
```

확인 항목:
1. 오류 제보 폼 열기 → "관련 문서 선택" 버튼 표시 확인
2. 버튼 클릭 → 드롭다운 열림 확인
3. 검색어 입력 → 문서 제목 필터링 확인
4. 아이템 클릭 → 선택 태그로 전환 확인
5. ✕ 클릭 → 태그 제거 후 버튼으로 복귀 확인
6. 드롭다운 바깥 클릭 → 드롭다운 닫힘 확인
7. 문서 선택 후 제보 제출 → 정상 제출 확인

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/pages/Feedback.tsx
git commit -m "feat: Feedback 페이지 — 문서 ID 입력을 드롭다운 선택 UI로 교체"
```
