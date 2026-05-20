# 멀티포맷 문서 업로드 및 Markdown 변환 설계

**날짜:** 2026-05-20  
**상태:** 승인 대기

---

## 1. 목표

`/documents` 페이지에서 PDF, Excel, PPT, DOCX 파일을 업로드하면 Markdown으로 변환해 기존 문서 관리 파이프라인(DocumentVersion → DocumentChunk → RAG)에서 동일하게 처리되도록 한다. 포함된 이미지도 Markdown 내에서 URL로 참조해 표시한다. 여러 파일을 한 번에 업로드할 수 있다.

---

## 2. 전체 흐름

```
사용자 파일 선택 (복수 가능)
→ POST /api/documents/bulk-upload (원본 파일 저장 → 즉시 201 응답, status: converting)
→ BackgroundTasks: 파일별 독립 변환 작업 실행
    → 이미지 추출 → static/images/{document_id}/ 저장
    → 텍스트 + 이미지 URL → Markdown 생성
    → DocumentVersion 생성 + 청크 임베딩
    → SSE 알림 (변환 완료 or 실패)
사용자: 목록에서 "변환 중..." → 완료 후 자동 갱신
```

변환 실패 시 `status: conversion_failed`로 업데이트, SSE로 알림.  
한 파일 실패해도 나머지 파일 변환은 계속 진행.

---

## 3. 백엔드

### 3-1. 새 의존성

```
pymupdf (fitz) — PDF 텍스트 및 이미지 추출 (pypdf2보다 이미지 추출 지원 우수)
python-pptx — PPT 슬라이드 텍스트/이미지 추출
```

DOCX(`mammoth`), Excel(`openpyxl`), `pillow`는 이미 설치돼 있음.

### 3-2. Document 모델 변경

`status` 컬럼에 두 값 추가:
- `converting` — 변환 작업 진행 중
- `conversion_failed` — 변환 실패

`original_file_path: str | None` 필드 추가 — 원본 파일 로컬 경로 보존.

Alembic 마이그레이션 필요.

### 3-3. 이미지 저장 경로

```
backend/static/images/{document_id}/{image_filename}
```

FastAPI `StaticFiles`로 `/static` 경로 마운트.  
Markdown 내 이미지 참조: `![alt](/static/images/{document_id}/image_001.png)`

### 3-4. `file_converter.py` (신규)

`backend/app/services/file_converter.py`에 포맷별 변환 로직 분리.

```python
async def convert_to_markdown(
    file_bytes: bytes,
    filename: str,
    document_id: str,
    static_dir: Path,
) -> str
```

포맷별 처리:

| 포맷 | 텍스트 추출 | 이미지 추출 |
|------|------------|------------|
| `.pdf` | fitz(PyMuPDF) 페이지별 텍스트 | fitz 이미지 추출 → PNG 저장 |
| `.pptx` / `.ppt` | python-pptx 슬라이드별 텍스트 | Placeholder 이미지 → PNG 저장 |
| `.docx` | mammoth HTML → markdownify | mammoth image handler → PNG 저장 |
| `.xlsx` / `.xls` | openpyxl 시트 → Markdown 테이블 | 이미지 없음 (시트 데이터만) |
| `.md` / `.txt` | 그대로 사용 | 해당 없음 |

### 3-5. `bulk-upload` 엔드포인트 변경

현재: 업로드 → `asyncio.to_thread(convert_to_markdown)` → 즉시 Document 생성  
변경:
1. 원본 파일 저장
2. `status: converting`으로 Document 생성 (content 빈 문자열)
3. `BackgroundTasks.add_task(convert_and_finalize, ...)` 등록 → 즉시 응답
4. 백그라운드에서 변환 완료 시 DocumentVersion 생성 + status → `active` + SSE 알림

단일 업로드 엔드포인트(`POST /api/documents/upload`)도 동일하게 변경.

---

## 4. 프론트엔드

### 4-1. 파일 input 변경

```
accept=".md,.txt,.pdf,.xlsx,.xls,.pptx,.ppt,.docx"
multiple
```

### 4-2. 문서 목록 상태 표시

| status | 표시 |
|--------|------|
| `converting` | 스피너 + "변환 중" 뱃지 |
| `conversion_failed` | 오류 아이콘 + "변환 실패" 뱃지 |
| `active` | 기존 표시 |

SSE 알림 수신 시 (`type: document_converted` or `type: conversion_failed`) 문서 목록 자동 갱신.

### 4-3. 문서 상세 페이지

- 원본 파일 다운로드 버튼 추가 (`original_file_path`가 있을 때만 표시)
- 나머지 Markdown 뷰어 동일

---

## 5. 변경 파일 목록

**백엔드**
- `backend/app/services/file_converter.py` — 신규
- `backend/app/services/document_service.py` — `convert_to_markdown` 제거 or 위임, `bulk-upload` 로직 변경
- `backend/app/routers/documents.py` — 엔드포인트 비동기 변환으로 변경
- `backend/app/models/document.py` — `original_file_path` 필드 추가
- `backend/alembic/versions/` — 마이그레이션 추가
- `backend/main.py` — StaticFiles 마운트
- `backend/pyproject.toml` — `pymupdf`, `python-pptx` 추가

**프론트엔드**
- `frontend/src/pages/Documents.tsx` — 파일 input 변경, 상태 뱃지 추가
- `frontend/src/pages/DocumentDetail.tsx` — 원본 파일 다운로드 버튼 추가

---

## 6. 미처리 범위 (Out of Scope)

- PDF 내 복잡한 표 레이아웃 정밀 변환 (텍스트 순서 기반 변환)
- PPT 애니메이션, 차트 데이터 (텍스트+이미지만 추출)
- 암호화된 PDF/DOCX
