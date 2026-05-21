# 문서 상세 페이지 — AI 태그 자동 추천 & 즉시 추가 UI

## 배경

현재 `/documents/:id` 상세 페이지는 읽기 전용이다. 태그가 없는 문서는 헤더에 태그 칩 영역이 비어 있고, 사용자가 태그를 추가하려면 `/documents/:id/edit` 편집 페이지로 이동해야 한다. AI 태그 추천(`POST /documents/{id}/suggest-tags`)도 편집 페이지의 `TagEditor` 안에서만 수동 버튼 클릭으로 호출 가능하다.

태그 없는 문서가 누적되고 있다. 읽기 흐름을 깨지 않으면서 태그 추가를 유도하기 위해, 상세 페이지에 들어왔을 때 태그가 없는 문서는 AI 추천 패널을 자동으로 띄우고, 사용자가 그 자리에서 수락·직접 추가할 수 있게 한다.

## 목표

- 태그가 없는 문서 진입 시 LLM 추천을 자동으로 호출하고 즉시 노출한다.
- 추천 수락·직접 입력·기존 태그 삭제가 상세 페이지에서 즉시 저장된다.
- 편집 페이지의 `TagEditor` 컴포넌트를 그대로 재활용한다(중복 구현 없음).
- 이미 태그가 있는 문서의 읽기 흐름은 변경하지 않는다.

## 비목표

- 편집 페이지 자체의 UX 변경.
- 추천 거부 상태의 영구 저장(서버/계정 단위). 동일 세션 동안만 숨김.
- 토스트/스낵바 시스템 신설. 에러는 인라인 메시지로 처리한다.
- 자동 테스트 인프라 구축. 검증은 수동 절차로 한다.

## 사용자 흐름

### 흐름 A — 태그 없는 문서 진입

1. 사용자가 `/documents/:id` 진입.
2. `doc.tags`가 비어 있음을 확인한 직후, 헤더 영역에 AI 추천 패널이 마운트되며 자동으로 `POST /documents/{id}/suggest-tags`를 호출한다.
3. 추천이 도착하면 점선 칩 형태로 노출된다(편집 페이지 `TagEditor`와 동일한 시각).
4. 사용자가 추천 칩 클릭 또는 직접 입력 Enter → 헤더 칩 영역이 즉시 채워지고, `PATCH /documents/{id}`가 백그라운드로 호출된다.
5. 추천 패널은 사라지지 않는다. 남은 추천을 계속 수락할 수 있다.
6. X 버튼 → 패널이 사라지고, 자리에 작은 "AI 추천 받기" 텍스트 링크만 남는다.
7. 동일 세션에서 이 문서로 재진입해도 패널은 자동 노출되지 않는다(링크 상태 유지). 새 세션·새 탭에서는 다시 자동 노출된다.

### 흐름 B — 태그가 1개 이상 있는 문서 진입

기존 동작 유지. 정적 칩 표시, 추천 패널 미노출, 추가/삭제 UI 없음. 태그를 수정하려면 편집 페이지로 이동한다.

## 아키텍처

### 변경 파일

| 파일 | 변경 |
| --- | --- |
| `frontend/src/pages/DocumentDetail.tsx` | 헤더 태그 영역 분기 + 내부 `DetailTagPanel` 추가 |
| `frontend/src/components/TagEditor.tsx` | `autoSuggestOnMount?: boolean`, `onSuggestError?: (e) => void` prop 추가 |

백엔드 변경 없음. 신규 컴포넌트 파일 없음.

### `TagEditor` 변경

추가되는 prop만 명세:

```tsx
interface TagEditorProps {
  tags: string[]
  onChange: (tags: string[]) => void
  onSuggest: () => Promise<string[]>
  autoSuggestOnMount?: boolean      // 신규: 마운트 시 1회 자동 호출
  onSuggestError?: (e: unknown) => void  // 신규: 추천 호출 실패 시 부모에 통지
}
```

내부 변경:

- `useEffect` 1회로 `autoSuggestOnMount`이면 `handleSuggest()` 호출. 의존성 없음, 마운트 시만.
- 기존 `handleSuggest`의 `catch{}` 빈 블록을 `onSuggestError?.(e)`로 교체.
- 기존 props/동작 비파괴 — 편집 페이지의 사용처는 변경 없이 그대로 작동한다.

### `DocumentDetail`의 헤더 분기

기존 L121–138의 정적 칩 분기를 다음 패턴으로 교체.

```tsx
const tagsArr = doc.tags ?? []

{tagsArr.length > 0 && (/* 기존 chip 렌더 */)}

{tagsArr.length === 0 && (
  dismissed
    ? <button onClick={reopen}>AI 추천 받기</button>
    : <DetailTagPanel docId={id!} onDismiss={dismiss} />
)}
```

### `DetailTagPanel` (DocumentDetail.tsx 내부 컴포넌트)

```tsx
function DetailTagPanel({ docId, onDismiss }: { docId: string; onDismiss: () => void }) {
  const [localTags, setLocalTags] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [suggestError, setSuggestError] = useState<unknown>(null)

  const handleChange = async (next: string[]) => {
    const prev = localTags
    setLocalTags(next)              // optimistic
    setError(null)
    try {
      await api.updateDocument(docId, { tags: next })
    } catch (e) {
      setLocalTags(prev)            // rollback
      setError(e instanceof Error ? e.message : "저장 실패")
    }
  }

  return (
    <div className="...panel...">
      <header>
        <span>태그 — AI가 추천해드릴게요</span>
        <button onClick={onDismiss}>×</button>
      </header>
      {suggestError && <RetryRow onRetry={() => setSuggestError(null)} />}
      <TagEditor
        tags={localTags}
        onChange={handleChange}
        onSuggest={() => api.suggestTags(docId).then(r => r.tags)}
        autoSuggestOnMount
        onSuggestError={setSuggestError}
      />
      {error && <p className="inline-error">{error}</p>}
    </div>
  )
}
```

### dismissed 상태

- 키: `docops.tagSuggest.dismissed.${docId}`
- 저장소: `sessionStorage` (접근 실패 시 try/catch로 무시, 기본값 false)
- 초기값: 마운트 시 1회 읽기
- 변경: X 클릭 → `setItem("1")` + `setDismissed(true)`. "AI 추천 받기" 클릭 → `removeItem` + `setDismissed(false)`.

## 데이터 플로우

```
DocumentDetail mount
  └─ useApi(getDocument) → doc 로드
       └─ doc.tags 비어있고 !dismissed
            └─ DetailTagPanel mount
                 └─ TagEditor mount + autoSuggestOnMount
                      └─ api.suggestTags(id) → suggested 채움

사용자 클릭(수락 or 직접 입력)
  └─ TagEditor.onChange(next)
       └─ setLocalTags(next)                  # optimistic UI
       └─ api.updateDocument(id, { tags: next })
            ├─ 성공: 유지
            └─ 실패: setLocalTags(prev) + inline error

사용자 X 클릭
  └─ sessionStorage.setItem(key, "1")
  └─ setDismissed(true) → 패널 unmount, 링크 표시
```

## 엣지 케이스

| 상황 | 처리 |
| --- | --- |
| `doc.tags === null` | `doc.tags ?? []`로 정규화 |
| 추천 호출 실패 | `onSuggestError`로 부모 통지 → "추천 불러오기 실패 · 재시도" 인라인 링크. 클릭 시 `TagEditor`의 추천 버튼을 다시 누른 효과(suggestError 클리어 + 자동 호출 재시도 — 이를 위해 `TagEditor`에 별도 메서드는 두지 않고, 패널이 `key`를 토글해 `TagEditor`를 재마운트하는 방식으로 단순화) |
| 추천 결과 0개 | 패널 유지, `TagEditor`의 수동 입력 필드만 활성. 기존 동작과 일치 |
| PATCH 실패 | optimistic 적용 후 롤백 + 인라인 에러 메시지 |
| 인플라이트 PATCH 중 추가 클릭 | last-wins. 매 클릭 새 PATCH 발사, 최종 응답 기준 |
| 페이지 이탈 중 PATCH | fire-and-forget. 백엔드 저장 완료, 클라이언트 에러 메시지는 사라짐 |
| sessionStorage 접근 실패 | try/catch로 감싸고 dismissed=false 기본 |
| 동시 추천+삭제 클릭 | 본 화면은 태그 0개 진입 한정 → 삭제 케이스 없음. 무관 |

## 성공 기준

- 태그 없는 문서 진입 시 1회 자동 추천, 추천 클릭만으로 태그가 즉시 저장된다.
- 태그 1개 이상 문서의 기존 읽기 흐름은 픽셀 단위로 변화 없음.
- 편집 페이지(`/documents/:id/edit`) 동작은 변화 없음(typecheck/lint 통과 포함).
- `TagEditor` 컴포넌트는 동일 인스턴스로 양쪽 페이지에서 작동한다.

## 수동 검증 절차

1. 태그가 없는 문서 진입 → 패널 자동 노출 + 추천 호출.
2. 추천 1개 수락 → 헤더 칩 즉시 반영 + 패널 유지 + 새로고침 후에도 태그가 서버에 저장됨.
3. 직접 입력 Enter → 동일 동작.
4. X 클릭 → 링크만 남음, 같은 세션 재진입 시 자동 호출 없음.
5. 새 탭/새 세션 → 다시 자동 호출.
6. 백엔드 `/suggest-tags`에서 500 강제 → 재시도 링크 노출, 클릭 시 재호출.
7. 백엔드 `PATCH /documents/{id}`에서 500 강제 → 인라인 에러 + 로컬 칩 롤백.
8. 태그 1개 이상 문서 진입 → 기존 정적 칩만 표시, 패널 없음.
9. `cd frontend && pnpm typecheck && pnpm lint` 통과.

## 변경 규모 예상

- `TagEditor.tsx`: +6~8줄
- `DocumentDetail.tsx`: +60~80줄 (DetailTagPanel 컴포넌트 + 헤더 분기 + dismissed 상태)
- 총 ≈ 80줄 추가. 백엔드/신규 파일 없음.
