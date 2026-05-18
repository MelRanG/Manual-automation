# 문서 편집·삭제·내보내기 기능 설계

**날짜:** 2026-05-18

---

## 개요

`/documents/:id` 상세 페이지에서 문서를 편집·삭제·내보낼 수 있는 기능을 추가한다.
현재 UI에 버튼만 있고 실제 동작이 없는 상태를 완성한다.

---

## 백엔드 API

### 1. 문서 수정 — `PATCH /api/documents/{id}`

- 요청 바디: `{ title?, description?, content?, change_summary? }`
- content 변경 시 `create_new_version` 서비스를 호출해 새 버전 자동 생성
- 응답: 업데이트된 `DocumentResponse`

### 2. 문서 삭제 — `DELETE /api/documents/{id}`

- 소프트 삭제: `Document.status = "archived"` 로 변경, DB 레코드는 보존
- 목록 조회(`GET /api/documents`)에서 archived 문서 필터링 — 기존 쿼리에 `status != "archived"` 조건 추가
- 응답: `{ message: "archived" }`

### 3. 내보내기 — `GET /api/documents/{id}/export?format=txt|md`

- 현재 버전의 content를 해당 형식으로 반환
- `Content-Disposition: attachment; filename="{title}.{format}"` 헤더 포함
- `.txt`: `text/plain`, `.md`: `text/markdown`
- PDF는 클라이언트에서 `jsPDF`로 생성 (이 엔드포인트 불필요)

---

## 프론트엔드

### 편집 페이지 — `DocumentEdit` (`/documents/:id/edit`)

- `App.tsx`에 라우트 추가
- 기존 문서 데이터(제목, 설명, 최신 버전 content) 로드 후 폼에 채움
- 필드: 제목(필수), 설명(선택), 본문 텍스트에어리어, 변경 요약(선택)
- 저장: `PATCH /api/documents/{id}` 호출 → 성공 시 `/documents/:id`로 이동
- 취소: `/documents/:id`로 이동

### 삭제 — DocumentDetail 헤더

- 삭제 버튼 클릭 → 인라인 2단계 confirm 흐름:
  1. 버튼이 "정말 삭제하시겠습니까?" + "확인" / "취소" 버튼으로 전환 (빨간색 강조)
  2. "확인" 클릭 → `DELETE /api/documents/{id}` → 성공 시 `/documents`로 이동
- 실수 방지를 위해 confirm 상태에서 외부 클릭 또는 취소로 쉽게 되돌아올 수 있게 처리

### 내보내기 드롭다운 — DocumentDetail 헤더

- 기존 "내보내기" 버튼을 드롭다운으로 교체
- 옵션: `.txt`, `.md` → 백엔드 export API 호출 후 브라우저 다운로드
- `.pdf` → `jsPDF` 라이브러리로 클라이언트에서 직접 생성 후 다운로드
- 드롭다운은 외부 클릭 시 닫힘

---

## 라우팅 변경

`App.tsx`에 추가:

```tsx
<Route path="/documents/:id/edit" element={<DocumentEdit />} />
```

---

## 의존성 추가

- `jspdf` — 클라이언트 PDF 생성 (`pnpm add jspdf`)

---

## 범위 외

- DOCX/XLSX 내보내기
- 편집 이력 diff 뷰
- 협업 편집 (동시 편집 충돌 처리)
