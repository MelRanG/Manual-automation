# 멀티포맷 문서 업로드 및 Markdown 변환 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PDF, PPT, DOCX, Excel 파일 업로드 시 백그라운드에서 Markdown으로 변환하고, 포함된 이미지는 서버에 저장해 Markdown에서 URL로 참조한다.

**Architecture:** 업로드 엔드포인트는 원본 파일 저장 후 즉시 `status: converting`으로 응답하고, FastAPI `BackgroundTasks`가 포맷별 변환을 실행한다. 변환 완료 시 `DocumentVersion`을 생성하고 SSE 알림을 발송한다. 이미지는 `backend/static/images/{document_id}/`에 저장되고 FastAPI StaticFiles로 서빙한다.

**Tech Stack:** Python FastAPI BackgroundTasks, PyMuPDF(fitz), python-pptx, mammoth, openpyxl, Pillow, React + TypeScript

---

## 파일 구조

**신규 생성:**
- `backend/app/services/file_converter.py` — 포맷별 변환 로직 (PDF/PPT/DOCX/Excel → Markdown + 이미지 추출)
- `backend/alembic/versions/xxxx_add_original_file_path_and_converting_status.py` — DB 마이그레이션
- `backend/tests/test_file_converter.py` — 변환 서비스 단위 테스트

**수정:**
- `backend/pyproject.toml` — pymupdf, python-pptx 의존성 추가
- `backend/app/models/document.py` — `original_file_path` 필드 추가
- `backend/app/schemas/document.py` — `original_file_path` 응답에 노출
- `backend/app/services/document_service.py` — `convert_to_markdown` 제거, 비동기 변환 함수 추가
- `backend/app/routers/documents.py` — 업로드 엔드포인트를 BackgroundTasks 방식으로 변경
- `backend/app/main.py` — `/static` StaticFiles 마운트 추가
- `frontend/src/lib/api.ts` — `Document` 인터페이스에 `original_file_path` 추가
- `frontend/src/pages/Documents.tsx` — 파일 accept 확장자 추가, 변환 중 상태 뱃지 추가
- `frontend/src/pages/DocumentDetail.tsx` — 원본 파일 다운로드 버튼 추가

---

## Task 1: 의존성 추가

**Files:**
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: pymupdf, python-pptx 의존성 추가**

`backend/pyproject.toml`의 `dependencies` 목록에 추가:

```toml
"pymupdf>=1.24.0",
"python-pptx>=1.0.0",
```

- [ ] **Step 2: 의존성 설치**

```bash
cd backend && uv sync
```

Expected: 오류 없이 설치 완료

- [ ] **Step 3: 설치 확인**

```bash
cd backend && uv run python -c "import fitz; import pptx; print('ok')"
```

Expected: `ok`

- [ ] **Step 4: 커밋**

```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "chore: add pymupdf and python-pptx dependencies"
```

---

## Task 2: DB 모델 및 마이그레이션

**Files:**
- Modify: `backend/app/models/document.py`
- Modify: `backend/app/schemas/document.py`
- Create: `backend/alembic/versions/xxxx_add_original_file_path.py`

- [ ] **Step 1: Document 모델에 `original_file_path` 필드 추가**

`backend/app/models/document.py`의 `Document` 클래스에 추가 (기존 `source_file_url` 아래):

```python
original_file_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
```

- [ ] **Step 2: DocumentResponse 스키마에 `original_file_path` 노출**

`backend/app/schemas/document.py`의 `DocumentResponse`에 추가:

```python
original_file_path: str | None = None
```

- [ ] **Step 3: Alembic 마이그레이션 생성**

```bash
cd backend && uv run alembic revision --autogenerate -m "add_original_file_path_to_documents"
```

Expected: `backend/alembic/versions/xxxx_add_original_file_path_to_documents.py` 생성

- [ ] **Step 4: 마이그레이션 적용**

```bash
cd backend && uv run alembic upgrade head
```

Expected: 오류 없이 완료

- [ ] **Step 5: 커밋**

```bash
git add backend/app/models/document.py backend/app/schemas/document.py backend/alembic/versions/
git commit -m "feat: add original_file_path field to Document model"
```

---

## Task 3: `file_converter.py` 서비스 작성

**Files:**
- Create: `backend/app/services/file_converter.py`
- Create: `backend/tests/test_file_converter.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_file_converter.py` 생성:

```python
import io
import uuid
from pathlib import Path

import pytest

from app.services.file_converter import convert_to_markdown


@pytest.mark.asyncio
async def test_txt_passthrough(tmp_path: Path):
    result = await convert_to_markdown(
        file_bytes=b"hello world",
        filename="test.txt",
        document_id=str(uuid.uuid4()),
        static_dir=tmp_path,
    )
    assert "hello world" in result


@pytest.mark.asyncio
async def test_md_passthrough(tmp_path: Path):
    result = await convert_to_markdown(
        file_bytes=b"# Hello",
        filename="test.md",
        document_id=str(uuid.uuid4()),
        static_dir=tmp_path,
    )
    assert "# Hello" in result


@pytest.mark.asyncio
async def test_xlsx_to_markdown_table(tmp_path: Path):
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.append(["이름", "나이"])
    ws.append(["홍길동", 30])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    result = await convert_to_markdown(
        file_bytes=buf.read(),
        filename="test.xlsx",
        document_id=str(uuid.uuid4()),
        static_dir=tmp_path,
    )
    assert "이름" in result
    assert "홍길동" in result
    assert "|" in result


@pytest.mark.asyncio
async def test_docx_to_markdown(tmp_path: Path):
    from docx import Document as DocxDocument
    doc = DocxDocument()
    doc.add_heading("제목", level=1)
    doc.add_paragraph("본문 내용입니다.")
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)

    result = await convert_to_markdown(
        file_bytes=buf.read(),
        filename="test.docx",
        document_id=str(uuid.uuid4()),
        static_dir=tmp_path,
    )
    assert "제목" in result
    assert "본문 내용" in result


@pytest.mark.asyncio
async def test_pdf_to_markdown(tmp_path: Path):
    import fitz
    pdf_doc = fitz.open()
    page = pdf_doc.new_page()
    page.insert_text((50, 100), "PDF 테스트 내용")
    buf = io.BytesIO(pdf_doc.tobytes())

    result = await convert_to_markdown(
        file_bytes=buf.read(),
        filename="test.pdf",
        document_id=str(uuid.uuid4()),
        static_dir=tmp_path,
    )
    assert "PDF 테스트 내용" in result


@pytest.mark.asyncio
async def test_pptx_to_markdown(tmp_path: Path):
    from pptx import Presentation
    from pptx.util import Inches
    prs = Presentation()
    slide_layout = prs.slide_layouts[0]
    slide = prs.slides.add_slide(slide_layout)
    slide.shapes.title.text = "슬라이드 제목"
    slide.placeholders[1].text = "슬라이드 내용"
    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)

    result = await convert_to_markdown(
        file_bytes=buf.read(),
        filename="test.pptx",
        document_id=str(uuid.uuid4()),
        static_dir=tmp_path,
    )
    assert "슬라이드 제목" in result


@pytest.mark.asyncio
async def test_image_extracted_to_static(tmp_path: Path):
    """PDF에서 이미지가 추출되면 static_dir에 저장되어야 한다."""
    import fitz
    from PIL import Image as PILImage

    # 1x1 PNG 이미지를 포함하는 PDF 생성
    img = PILImage.new("RGB", (10, 10), color=(255, 0, 0))
    img_buf = io.BytesIO()
    img.save(img_buf, format="PNG")
    img_buf.seek(0)

    pdf_doc = fitz.open()
    page = pdf_doc.new_page()
    page.insert_text((50, 100), "이미지 포함 PDF")
    rect = fitz.Rect(50, 150, 150, 250)
    page.insert_image(rect, stream=img_buf.read())
    buf = io.BytesIO(pdf_doc.tobytes())

    doc_id = str(uuid.uuid4())
    result = await convert_to_markdown(
        file_bytes=buf.read(),
        filename="test_with_image.pdf",
        document_id=doc_id,
        static_dir=tmp_path,
    )
    # 이미지 파일이 static_dir에 생성되어야 함
    image_dir = tmp_path / doc_id
    assert image_dir.exists()
    assert any(image_dir.iterdir())
    # Markdown에 이미지 참조가 포함되어야 함
    assert "![" in result
    assert f"/static/images/{doc_id}/" in result
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd backend && uv run pytest tests/test_file_converter.py -v 2>&1 | head -30
```

Expected: `ImportError` 또는 `ModuleNotFoundError` (파일 미존재)

- [ ] **Step 3: `file_converter.py` 구현**

`backend/app/services/file_converter.py` 생성:

```python
import io
import uuid
from pathlib import Path


async def convert_to_markdown(
    file_bytes: bytes,
    filename: str,
    document_id: str,
    static_dir: Path,
) -> str:
    import asyncio
    return await asyncio.to_thread(
        _convert_sync, file_bytes, filename, document_id, static_dir
    )


def _convert_sync(
    file_bytes: bytes,
    filename: str,
    document_id: str,
    static_dir: Path,
) -> str:
    ext = Path(filename).suffix.lower()

    if ext == ".pdf":
        return _pdf_to_markdown(file_bytes, document_id, static_dir)
    if ext in (".pptx", ".ppt"):
        return _pptx_to_markdown(file_bytes, document_id, static_dir)
    if ext == ".docx":
        return _docx_to_markdown(file_bytes, document_id, static_dir)
    if ext in (".xlsx", ".xls"):
        return _xlsx_to_markdown(file_bytes)
    return file_bytes.decode("utf-8", errors="replace")


def _image_dir(static_dir: Path, document_id: str) -> Path:
    d = static_dir / document_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _pdf_to_markdown(file_bytes: bytes, document_id: str, static_dir: Path) -> str:
    import fitz

    img_dir = _image_dir(static_dir, document_id)
    parts: list[str] = []
    pdf = fitz.open(stream=file_bytes, filetype="pdf")

    for page_num, page in enumerate(pdf, start=1):
        text = page.get_text().strip()
        if text:
            parts.append(f"## 페이지 {page_num}\n\n{text}")

        for img_index, img in enumerate(page.get_images(full=True)):
            xref = img[0]
            base_image = pdf.extract_image(xref)
            img_bytes = base_image["image"]
            ext = base_image["ext"]
            img_filename = f"page{page_num}_img{img_index}.{ext}"
            (img_dir / img_filename).write_bytes(img_bytes)
            parts.append(f"![이미지](/static/images/{document_id}/{img_filename})")

    pdf.close()
    return "\n\n".join(parts)


def _pptx_to_markdown(file_bytes: bytes, document_id: str, static_dir: Path) -> str:
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    img_dir = _image_dir(static_dir, document_id)
    parts: list[str] = []
    prs = Presentation(io.BytesIO(file_bytes))

    for slide_num, slide in enumerate(prs.slides, start=1):
        slide_parts: list[str] = [f"## 슬라이드 {slide_num}"]
        img_idx = 0
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = para.text.strip()
                    if text:
                        slide_parts.append(text)
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                img_filename = f"slide{slide_num}_img{img_idx}.png"
                (img_dir / img_filename).write_bytes(shape.image.blob)
                slide_parts.append(f"![이미지](/static/images/{document_id}/{img_filename})")
                img_idx += 1
        parts.append("\n\n".join(slide_parts))

    return "\n\n---\n\n".join(parts)


def _docx_to_markdown(file_bytes: bytes, document_id: str, static_dir: Path) -> str:
    import mammoth
    import markdownify

    img_dir = _image_dir(static_dir, document_id)
    img_counter = [0]

    def handle_image(image):
        with image.open() as f:
            img_bytes = f.read()
        content_type = image.content_type or "image/png"
        ext = content_type.split("/")[-1]
        img_filename = f"img{img_counter[0]}.{ext}"
        img_counter[0] += 1
        (img_dir / img_filename).write_bytes(img_bytes)
        return {"src": f"/static/images/{document_id}/{img_filename}"}

    result = mammoth.convert_to_html(
        io.BytesIO(file_bytes),
        convert_image=mammoth.images.img_element(handle_image),
    )
    return markdownify.markdownify(result.value, heading_style="ATX")


def _xlsx_to_markdown(file_bytes: bytes) -> str:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    parts: list[str] = []
    for sheet in wb.worksheets:
        parts.append(f"## {sheet.title}\n")
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            continue
        header = [str(c) if c is not None else "" for c in rows[0]]
        parts.append("| " + " | ".join(header) + " |")
        parts.append("| " + " | ".join(["---"] * len(header)) + " |")
        for row in rows[1:]:
            cells = [str(c) if c is not None else "" for c in row]
            parts.append("| " + " | ".join(cells) + " |")
        parts.append("")
    wb.close()
    return "\n".join(parts)
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd backend && uv run pytest tests/test_file_converter.py -v
```

Expected: 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/file_converter.py backend/tests/test_file_converter.py
git commit -m "feat: add file_converter service for PDF/PPT/DOCX/Excel to Markdown"
```

---

## Task 4: StaticFiles 마운트

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: static 디렉토리 경로 및 StaticFiles 마운트 추가**

`backend/app/main.py`에서 `UPLOAD_DIR` import 아래에 추가:

```python
from app.services.file_converter import STATIC_IMAGES_DIR
```

`app.mount("/uploads", ...)` 아래에 추가:

```bash
app.mount("/static/images", StaticFiles(directory=str(STATIC_IMAGES_DIR)), name="static_images")
```

`backend/app/services/file_converter.py` 상단에 경로 상수 추가 (파일 최상단, import 아래):

```python
STATIC_IMAGES_DIR = Path(__file__).resolve().parent.parent.parent / "static" / "images"
STATIC_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
```

그리고 `_image_dir` 함수에서 `static_dir` 인자 대신 `STATIC_IMAGES_DIR`를 기본값으로 사용하도록 `convert_to_markdown` 시그니처 수정:

```python
async def convert_to_markdown(
    file_bytes: bytes,
    filename: str,
    document_id: str,
    static_dir: Path | None = None,
) -> str:
    import asyncio
    return await asyncio.to_thread(
        _convert_sync, file_bytes, filename, document_id, static_dir or STATIC_IMAGES_DIR
    )
```

- [ ] **Step 2: 테스트 — 기존 테스트가 여전히 통과하는지 확인**

```bash
cd backend && uv run pytest tests/test_file_converter.py -v
```

Expected: 모두 PASS (테스트는 `tmp_path`를 명시적으로 전달하므로 영향 없음)

- [ ] **Step 3: 커밋**

```bash
git add backend/app/main.py backend/app/services/file_converter.py
git commit -m "feat: mount /static/images StaticFiles and add STATIC_IMAGES_DIR constant"
```

---

## Task 5: 업로드 엔드포인트 비동기 변환으로 변경

**Files:**
- Modify: `backend/app/services/document_service.py`
- Modify: `backend/app/routers/documents.py`

- [ ] **Step 1: `document_service.py`에서 `convert_to_markdown` 제거 및 비동기 변환 함수 추가**

`backend/app/services/document_service.py`에서:

1. 기존 `convert_to_markdown` 함수 전체 삭제
2. 파일 상단 import에 추가:

```python
from app.services.file_converter import convert_to_markdown as _file_convert
from app.routers.notifications import create_notification
```

3. `create_document` 함수에 `status` 파라미터 추가:

```python
async def create_document(
    db: AsyncSession,
    data: DocumentCreate,
    content: str,
    source_file_url: str | None = None,
    original_file_path: str | None = None,
    status: str = "active",
) -> Document:
    doc = Document(
        id=uuid.uuid4(),
        title=data.title,
        description=data.description,
        owner_id=data.owner_id,
        status=status,
        trust_score=1.0,
        document_type=data.document_type,
        domain=data.domain,
        audience=data.audience,
        source_type=data.source_type,
        source_file_url=source_file_url,
        original_file_path=original_file_path,
        related_sr_id=data.related_sr_id,
        jira_issue_key=data.jira_issue_key,
        tags=data.tags,
    )
    db.add(doc)
    await db.flush()

    if status == "active":
        version = DocumentVersion(
            id=uuid.uuid4(),
            document_id=doc.id,
            version_number=1,
            content=content,
            source_file_url=source_file_url,
            created_by=data.owner_id,
        )
        db.add(version)
        await db.flush()
        doc.current_version_id = version.id
        await db.commit()
        await db.refresh(doc)
        await db.refresh(version)
        asyncio.create_task(_embed_in_background(version.id))
    else:
        await db.commit()
        await db.refresh(doc)

    return doc
```

4. 파일 끝에 비동기 변환 완료 처리 함수 추가:

```python
async def convert_and_finalize(
    document_id: uuid.UUID,
    file_bytes: bytes,
    filename: str,
    owner_id: uuid.UUID | None,
) -> None:
    """BackgroundTasks에서 실행: 파일 변환 후 DocumentVersion 생성 및 status 갱신."""
    from app.services.file_converter import convert_to_markdown as _file_convert

    try:
        content = await _file_convert(
            file_bytes=file_bytes,
            filename=filename,
            document_id=str(document_id),
        )
        async with SessionLocal() as db:
            doc = await get_document(db, document_id)
            if not doc:
                return

            version = DocumentVersion(
                id=uuid.uuid4(),
                document_id=document_id,
                version_number=1,
                content=content,
                source_file_url=doc.source_file_url,
                created_by=owner_id,
            )
            db.add(version)
            await db.flush()

            doc.current_version_id = version.id
            doc.status = "active"
            await db.commit()
            await db.refresh(version)

            asyncio.create_task(_embed_in_background(version.id))

            if owner_id:
                await create_notification(
                    db,
                    user_id=owner_id,
                    type="document_converted",
                    title="문서 변환 완료",
                    message=f"'{doc.title}' 파일 변환이 완료되었습니다.",
                    document_id=document_id,
                )
    except Exception:
        async with SessionLocal() as db:
            doc = await get_document(db, document_id)
            if doc:
                doc.status = "conversion_failed"
                await db.commit()

            if owner_id:
                await create_notification(
                    db,
                    user_id=owner_id,
                    type="conversion_failed",
                    title="문서 변환 실패",
                    message=f"파일 변환 중 오류가 발생했습니다: {filename}",
                )
```

- [ ] **Step 2: `documents.py` 라우터 — 업로드 엔드포인트 변경**

`backend/app/routers/documents.py` import에 `BackgroundTasks` 추가:

```python
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form, Response
```

`document_service` import에 `convert_and_finalize` 추가:

```python
from app.services.document_service import (
    convert_and_finalize,
    create_document as _create_document_svc,
)
```

`bulk_upload_documents` 엔드포인트를 다음으로 교체:

```python
@router.post("/bulk-upload", status_code=201)
async def bulk_upload_documents(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    owner_id: str = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """여러 파일을 업로드. 변환은 백그라운드에서 실행된다."""
    results = []
    for file in files:
        file_bytes = await file.read()
        filename = file.filename or "untitled"
        title = filename.rsplit(".", 1)[0] if "." in filename else filename
        file_url = await document_service.save_uploaded_file(filename, file_bytes)
        parsed_owner = uuid.UUID(owner_id) if owner_id else None

        ext = Path(filename).suffix.lower()
        needs_conversion = ext in (".pdf", ".pptx", ".ppt", ".docx", ".xlsx", ".xls")
        initial_status = "converting" if needs_conversion else "active"
        initial_content = "" if needs_conversion else file_bytes.decode("utf-8", errors="replace")

        data = DocumentCreate(
            title=title,
            description=filename,
            owner_id=parsed_owner,
            source_type="upload",
        )
        doc = await document_service.create_document(
            db, data, initial_content,
            source_file_url=file_url,
            original_file_path=str(document_service.UPLOAD_DIR / Path(file_url).name),
            status=initial_status,
        )

        if needs_conversion:
            background_tasks.add_task(
                document_service.convert_and_finalize,
                doc.id, file_bytes, filename, parsed_owner,
            )

        results.append({"id": str(doc.id), "title": doc.title, "filename": filename, "status": initial_status})
    return {"uploaded": len(results), "documents": results}
```

`upload_document` 엔드포인트도 동일하게 변경:

```python
@router.post("/upload", response_model=DocumentResponse, status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    title: str = Form(...),
    description: str = Form(None),
    owner_id: str = Form(None),
    tags: str = Form(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    import json as _json
    file_bytes = await file.read()
    filename = file.filename or "upload.txt"
    file_url = await document_service.save_uploaded_file(filename, file_bytes)
    parsed_owner = uuid.UUID(owner_id) if owner_id else None

    parsed_tags: list[str] | None = None
    if tags:
        try:
            parsed_tags = _json.loads(tags)
        except Exception:
            pass

    ext = Path(filename).suffix.lower()
    needs_conversion = ext in (".pdf", ".pptx", ".ppt", ".docx", ".xlsx", ".xls")
    initial_status = "converting" if needs_conversion else "active"
    initial_content = "" if needs_conversion else file_bytes.decode("utf-8", errors="replace")

    data = DocumentCreate(
        title=title,
        description=description,
        owner_id=parsed_owner,
        source_type="upload",
        tags=parsed_tags,
    )
    doc = await document_service.create_document(
        db, data, initial_content,
        source_file_url=file_url,
        original_file_path=str(document_service.UPLOAD_DIR / Path(file_url).name),
        status=initial_status,
    )

    if needs_conversion:
        background_tasks.add_task(
            document_service.convert_and_finalize,
            doc.id, file_bytes, filename, parsed_owner,
        )

    return doc
```

`Path` import 추가 (파일 상단):

```python
from pathlib import Path
```

- [ ] **Step 3: 기존 문서 테스트 실행 — 통과 확인**

```bash
cd backend && uv run pytest tests/test_documents.py -v
```

Expected: 모두 PASS (`.txt` 업로드는 즉시 active, 변환 불필요)

- [ ] **Step 4: 커밋**

```bash
git add backend/app/services/document_service.py backend/app/routers/documents.py
git commit -m "feat: async background conversion for PDF/PPT/DOCX/Excel uploads"
```

---

## Task 6: 프론트엔드 — 파일 accept 및 상태 뱃지

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/Documents.tsx`

- [ ] **Step 1: `api.ts`의 `Document` 인터페이스에 `original_file_path` 추가**

`frontend/src/lib/api.ts`에서:

```typescript
export interface Document { id: string; title: string; description: string | null; owner_id: string | null; status: string; priority: string; trust_score: number; view_count: number; created_at: string; updated_at: string; current_version_id: string | null; document_type: string | null; domain: string | null; audience: string | null; source_type: string | null; source_file_url: string | null; original_file_path: string | null; related_sr_id: string | null; jira_issue_key: string | null; tags: string[] | null }
```

(`original_file_path: string | null;`을 `source_file_url: string | null;` 뒤에 추가)

- [ ] **Step 2: `Documents.tsx` — 파일 accept 확장자 추가 및 변환 중 뱃지 추가**

`frontend/src/pages/Documents.tsx`에서:

1. accept 속성 변경 (line 169 근처):

```tsx
<input type="file" className="hidden" multiple onChange={handleFileSelect} accept=".txt,.md,.html,.json,.csv,.docx,.xlsx,.xls,.pdf,.pptx,.ppt" />
```

2. 문서 목록 status 뱃지 부분 (line 364 근처) 변경:

기존:
```tsx
<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${doc.status === "active" ? "bg-[#d5e3fc] text-[#00288e]" : "bg-[#e6e8ea] text-[#444653]"}`}>
  {doc.status === "active" ? "활성" : doc.status}
</span>
```

변경:
```tsx
<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
  doc.status === "active" ? "bg-[#d5e3fc] text-[#00288e]"
  : doc.status === "converting" ? "bg-[#fff3cd] text-[#856404]"
  : doc.status === "conversion_failed" ? "bg-[#ffdad6] text-[#93000a]"
  : "bg-[#e6e8ea] text-[#444653]"
}`}>
  {doc.status === "active" ? "활성"
    : doc.status === "converting" ? "⏳ 변환 중"
    : doc.status === "conversion_failed" ? "⚠ 변환 실패"
    : doc.status}
</span>
```

- [ ] **Step 3: 타입 체크**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/Documents.tsx
git commit -m "feat: add PDF/PPT/DOCX file upload support and converting status badge"
```

---

## Task 7: 프론트엔드 — 원본 파일 다운로드 버튼

**Files:**
- Modify: `frontend/src/pages/DocumentDetail.tsx`

- [ ] **Step 1: DocumentDetail에서 `original_file_path` 기반 다운로드 버튼 추가**

`frontend/src/pages/DocumentDetail.tsx`에서 `source_file_url` 또는 문서 메타 정보가 표시되는 영역을 찾아, `original_file_path`가 있을 때 원본 파일 다운로드 버튼 추가:

기존 코드에서 문서 메타 표시 영역 (source_file_url 표시 부분 또는 적절한 위치)에:

```tsx
{doc.source_file_url && (
  <a
    href={doc.source_file_url}
    download
    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-[#c4c7c5] text-[#444653] hover:bg-[#f3f4f6] transition-colors"
  >
    ↓ 원본 파일 다운로드
  </a>
)}
```

- [ ] **Step 2: 타입 체크**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/pages/DocumentDetail.tsx
git commit -m "feat: add original file download button in document detail"
```

---

## Task 8: 전체 테스트 및 검증

- [ ] **Step 1: 백엔드 전체 테스트**

```bash
cd backend && uv run pytest tests/ -v --tb=short 2>&1 | tail -30
```

Expected: 모두 PASS

- [ ] **Step 2: 프론트엔드 타입 체크 및 린트**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: 오류 없음

- [ ] **Step 3: 개발 서버 구동 및 수동 검증**

```bash
# 터미널 1
cd backend && uv run fastapi dev

# 터미널 2
cd frontend && pnpm dev
```

브라우저에서 `http://localhost:5173/documents` 접속:
1. PDF 파일 업로드 → "⏳ 변환 중" 뱃지 확인
2. 변환 완료 후 "활성" 뱃지로 자동 전환 확인 (SSE 알림 Toast)
3. 문서 상세 페이지에서 "원본 파일 다운로드" 버튼 확인
4. XLSX 파일 업로드 → Markdown 테이블 변환 확인
5. PPTX 파일 업로드 → 슬라이드별 섹션 변환 확인

- [ ] **Step 4: 최종 커밋**

```bash
git add .
git commit -m "feat: complete multi-format document upload with background conversion"
```
