# Feedback 페이지 — 문서 선택 드롭다운 설계

## 배경

Feedback 페이지에서 `document_id`를 자유 텍스트로 입력받고 있어 UUID를 직접 입력해야 하는 UX 문제가 있었다. 문서를 검색·선택할 수 있는 인라인 드롭다운으로 교체한다.

## 결정 사항

- **레이아웃**: 인라인 드롭다운 (입력 필드 아래 바로 펼침)
- **아이템 레이아웃**: 제목 / 설명 / 최근 수정일 3줄 세로 배치

## 동작 흐름

1. "관련 문서" 영역 클릭 → 드롭다운 열림
2. 검색 입력 → 문서 제목 기준 프론트 필터링 (별도 API 호출 없음)
3. 목록 항목 클릭 → 즉시 선택 확정, 드롭다운 닫힘
4. 선택 후 태그(제목 + ✕) 표시, ✕ 클릭 시 선택 해제
5. 드롭다운 바깥 클릭 시 닫힘

## 각 아이템 표시 필드

- **문서 제목** — 굵게
- **설명** — 한 줄, 말줄임(`text-overflow: ellipsis`)
- **최근 수정일** — `updated_at` 포맷팅

## 데이터

- 컴포넌트 마운트 시 `api.listDocuments(0, 100)` 한 번 호출
- 검색은 프론트에서 `title` 기준 `includes` 필터 (대소문자 무관)
- 선택값은 `doc.id` (UUID)를 `docId` state에 저장 — 기존 제출 로직과 호환

## 변경 범위

- `frontend/src/pages/Feedback.tsx` — `DocumentPickerDropdown` 컴포넌트를 동일 파일 내 정의
- 신규 API 엔드포인트 불필요
- 기존 `api.listDocuments` 재사용

## 컴포넌트 인터페이스

```tsx
interface DocumentPickerDropdownProps {
  value: string           // 선택된 doc.id
  onChange: (id: string, title: string) => void
  onClear: () => void
}
```

## 상태 구조

```
Feedback 컴포넌트
  docId: string          // 선택된 문서 UUID (제출 payload에 사용)
  docTitle: string       // 표시용 제목 (태그에 표시)

DocumentPickerDropdown
  open: boolean          // 드롭다운 열림 여부
  query: string          // 검색 입력값
  documents: Document[]  // 전체 목록 (마운트 시 1회 로드)
```
