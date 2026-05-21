import asyncio
import logging
import re
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.feedback import ProposedDocumentChange
from app.models.manual import ManualGenerationJob
from app.services.document_service import UPLOAD_DIR, _put_s3_object
from app.services.llm_service import get_llm_provider

logger = logging.getLogger(__name__)

SCREENSHOTS_DIR = UPLOAD_DIR / "screenshots"
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)


def _upload_screenshot_to_s3(local_jpg: Path) -> None:
    """JPG를 S3에 올리고 로컬 파일 제거. Fargate FS는 ephemeral이라 영구화 필요."""
    if not settings.uploads_s3_bucket:
        raise RuntimeError("UPLOADS_S3_BUCKET is required for screenshot uploads")
    prefix = settings.uploads_s3_prefix.strip("/")
    key = (
        f"{prefix}/screenshots/{local_jpg.name}"
        if prefix
        else f"screenshots/{local_jpg.name}"
    )
    content = local_jpg.read_bytes()
    _put_s3_object(key, content)
    local_jpg.unlink(missing_ok=True)


async def _upload_screenshot_to_s3_async(local_jpg: Path) -> None:
    await asyncio.to_thread(_upload_screenshot_to_s3, local_jpg)


async def create_job(
    db: AsyncSession,
    user_id: uuid.UUID,
    target_url: str,
    login_id: str | None = None,
    login_pw: str | None = None,
    login_url: str | None = None,
    scenario_steps: list[str] | None = None,
    source_sr_id: uuid.UUID | None = None,
) -> ManualGenerationJob:
    job = ManualGenerationJob(
        id=uuid.uuid4(),
        user_id=user_id,
        target_url=target_url,
        login_id=login_id,
        login_pw=login_pw,
        login_url=login_url,
        scenario_steps=scenario_steps,
        source_sr_id=source_sr_id,
        status="pending",
    )
    db.add(job)
    await db.commit()
    # Re-fetch through get_job so proposed_change/approval relationships are eager-loaded;
    # Pydantic from_attributes serialization would otherwise trigger a lazy load outside
    # the async greenlet context.
    refreshed = await get_job(db, job.id)
    return refreshed if refreshed is not None else job


async def run_generation(db: AsyncSession, job_id: uuid.UUID) -> ManualGenerationJob:
    result = await db.execute(select(ManualGenerationJob).where(ManualGenerationJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise ValueError("Job not found")

    job.status = "running"
    await db.commit()

    try:
        screenshots = await capture_screenshots(job)
        markdown = await generate_markdown(job, screenshots)

        # ProposedDocumentChange 생성 → ApprovalRequest 생성 (승인 후 문서화)
        from app.models.feedback import ProposedDocumentChange, ApprovalRequest
        from urllib.parse import urlparse
        domain = urlparse(job.target_url).netloc or job.target_url

        change = ProposedDocumentChange(
            id=uuid.uuid4(),
            document_id=None,
            manual_job_id=job.id,
            original_text="",
            proposed_text=markdown,
            diff=markdown,
            reasoning=f"Playwright auto-generated manual for {job.target_url}",
            confidence=1.0,
            source_type="playwright",
            status="pending",
        )
        db.add(change)
        await db.flush()

        approval = ApprovalRequest(
            id=uuid.uuid4(),
            proposed_change_id=change.id,
            status="pending",
        )
        db.add(approval)

        job.status = "completed"
        job.screenshots = screenshots
        await db.commit()

        try:
            from app.routers.notifications import create_notification
            await create_notification(
                db,
                user_id=job.user_id,
                type="manual_completed",
                title="매뉴얼 작성 완료",
                message=job.target_url,
                link_path=f"/manuals?job={job.id}&tab=draft",
            )
        except Exception as notif_err:
            logger.warning(
                f"매뉴얼 완료 알림 발행 실패 (job={job_id}): {notif_err}"
            )

    except Exception as e:
        logger.error(f"Manual generation failed for job {job_id}: {e}", exc_info=True)
        job.status = "failed"
        job.error_message = str(e)[:1000]
        await db.commit()

    await db.refresh(job)
    return job


async def capture_screenshots(job: ManualGenerationJob) -> list[dict]:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        logger.warning("playwright not installed, using mock capture")
        return await mock_capture(job)

    screenshots = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
            page = await browser.new_page(viewport={"width": 1280, "height": 800})

            if job.login_id and job.login_pw:
                login_target = job.login_url or job.target_url
                await page.goto(login_target, wait_until="domcontentloaded", timeout=30000)
                username_input = page.locator(
                    'input[type="text"], input[type="email"], input[name*="user"], input[name*="login"]'
                ).first
                password_input = page.locator('input[type="password"]').first
                if await username_input.is_visible(timeout=3000):
                    await username_input.fill(job.login_id)
                    await password_input.fill(job.login_pw)
                    submit = page.locator('button[type="submit"], input[type="submit"]').first
                    if await submit.is_visible(timeout=2000):
                        await submit.click()
                    await page.wait_for_load_state("domcontentloaded", timeout=10000)

            await page.goto(job.target_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)

            png_path = SCREENSHOTS_DIR / f"{job.id}_step1.png"
            await page.screenshot(path=str(png_path), full_page=False)
            _resize_screenshot(png_path)
            filename = f"{job.id}_step1.jpg"
            await _upload_screenshot_to_s3_async(png_path.with_suffix(".jpg"))
            page_text = await page.evaluate("() => document.body.innerText")
            screenshots.append({
                "step": 1,
                "filename": filename,
                "url": job.target_url,
                "description": "메인 페이지",
                "page_text": page_text[:3000] if page_text else "",
                "click_pos": None,
            })

            if job.scenario_steps:
                for i, step in enumerate(job.scenario_steps, start=2):
                    click_pos = None
                    clicked = False
                    click_target = _extract_click_target(step)
                    fail_reason: str | None = None

                    locator, match_reason = await _find_click_locator(page, click_target)

                    if locator is None:
                        fail_reason = match_reason
                        logger.warning(
                            f"manual click failed for step '{step}': {match_reason}"
                        )
                    else:
                        logger.info(
                            f"manual click {match_reason} for step '{step}' → '{click_target}'"
                        )
                        try:
                            box = await locator.bounding_box()
                            if box:
                                click_pos = {
                                    "x": box["x"] + box["width"] / 2,
                                    "y": box["y"] + box["height"] / 2,
                                    "label": click_target,
                                }
                            # 클릭 전 화면에 마커 표시
                            before_png = SCREENSHOTS_DIR / f"{job.id}_step{i}.png"
                            await page.screenshot(path=str(before_png), full_page=False)
                            _resize_screenshot(before_png)
                            _annotate_click(before_png.with_suffix(".jpg"), click_pos)
                            await _upload_screenshot_to_s3_async(before_png.with_suffix(".jpg"))

                            # target=_blank 링크는 href로 직접 이동
                            href = await locator.get_attribute("href")
                            target_attr = await locator.get_attribute("target")
                            if href and target_attr == "_blank":
                                await page.goto(href, wait_until="domcontentloaded", timeout=15000)
                            else:
                                await locator.click()
                                try:
                                    await page.wait_for_load_state("domcontentloaded", timeout=8000)
                                except Exception:
                                    pass
                            clicked = True
                            await asyncio.sleep(1.5)
                        except Exception as click_err:
                            fail_reason = f"click 실행 실패: {click_err}"
                            logger.warning(
                                f"manual click execution failed for step '{step}': {click_err}"
                            )

                    try:
                        # 클릭 후 결과 화면
                        after_png = SCREENSHOTS_DIR / f"{job.id}_step{i}a.png"
                        await page.screenshot(path=str(after_png), full_page=False)
                        _resize_screenshot(after_png)
                        await _upload_screenshot_to_s3_async(after_png.with_suffix(".jpg"))
                        step_text = await page.evaluate("() => document.body.innerText")

                        if clicked and click_pos:
                            screenshots.append({
                                "step": f"{i}a",
                                "filename": f"{job.id}_step{i}.jpg",
                                "url": page.url,
                                "description": f"{step} - 클릭 위치",
                                "page_text": "",
                                "click_pos": click_pos,
                            })
                            screenshots.append({
                                "step": f"{i}b",
                                "filename": f"{job.id}_step{i}a.jpg",
                                "url": page.url,
                                "description": f"{step} - 클릭 후 화면",
                                "page_text": step_text[:2000] if step_text else "",
                                "click_pos": None,
                            })
                        else:
                            desc_suffix = (
                                f" (클릭 실패: {fail_reason})" if fail_reason else " (클릭 실패)"
                            )
                            screenshots.append({
                                "step": i,
                                "filename": f"{job.id}_step{i}a.jpg",
                                "url": page.url,
                                "description": f"{step}{desc_suffix}",
                                "page_text": step_text[:2000] if step_text else "",
                                "click_pos": None,
                            })

                    except Exception as capture_err:
                        screenshots.append({
                            "step": i,
                            "filename": None,
                            "url": page.url,
                            "description": f"{step} (캡처 실패: {capture_err})",
                            "page_text": "",
                            "click_pos": None,
                        })

            await browser.close()
    except Exception as e:
        logger.error(f"Playwright capture failed, using mock: {e}", exc_info=True)
        return await mock_capture(job)

    return screenshots


_TRAILING_PUNCT = re.compile(r"[\s.…!?。·]+$")
_ACTION_SUFFIX = re.compile(
    r"(을|를|으로|로)?\s*(클릭|선택|이동|진입|들어가기|누르기|tap|click)(하기|하세요|해|해요|함)?$",
    re.IGNORECASE,
)
_DESCRIPTOR_SUFFIX = re.compile(r"\s*(버튼|링크|메뉴|탭|항목|아이콘|박스|카드)$")


def _extract_click_target(step: str) -> str:
    """자연어 step에서 click target text를 추출한다.

    1) trailing punctuation 제거
    2) 동작 어미(조사+동사+활용형) 절단
    3) descriptor(버튼/링크 등) 절단 — 단 결과가 빈 문자열이면 descriptor 유지
    """
    s = _TRAILING_PUNCT.sub("", step).strip()
    if not s:
        return ""

    after_action = _ACTION_SUFFIX.sub("", s).strip()
    if after_action:
        s = after_action

    after_descriptor = _DESCRIPTOR_SUFFIX.sub("", s).strip()
    if after_descriptor:
        return after_descriptor
    return s


async def _find_click_locator(page, target: str):
    """target text에 대해 다양한 locator 전략을 cascade로 시도한다.

    Returns:
        (locator, reason) — 매칭된 locator와 사유 문자열
        (None, reason)    — 모두 실패. reason은 사용자 친화 메시지.
    """
    if not target:
        return None, "extract 결과 빈 문자열"

    escaped = re.escape(target)
    name_re = re.compile(escaped, re.IGNORECASE)

    strategies = [
        ("role=link",       page.get_by_role("link",   name=name_re)),
        ("role=button",     page.get_by_role("button", name=name_re)),
        ("a:has-text",      page.locator(f'a:has-text("{target}")')),
        ("button:has-text", page.locator(f'button:has-text("{target}")')),
        ("text",            page.get_by_text(target, exact=False)),
        ("aria-label",      page.locator(f'[aria-label*="{target}" i]')),
        ("title",           page.locator(f'[title*="{target}" i]')),
    ]

    for name, loc in strategies:
        try:
            first = loc.first
            if await first.is_visible(timeout=1000):
                return first, f"matched: {name}"
        except Exception:
            continue

    tokens = [t for t in target.split() if len(t) > 1]
    if len(tokens) >= 2:
        for tok in tokens:
            tok_re = re.compile(re.escape(tok), re.IGNORECASE)
            partial_strategies = [
                ("role=link",   page.get_by_role("link",   name=tok_re)),
                ("role=button", page.get_by_role("button", name=tok_re)),
                ("text",        page.get_by_text(tok, exact=False)),
            ]
            for name, loc in partial_strategies:
                try:
                    first = loc.first
                    if await first.is_visible(timeout=800):
                        return first, f"matched: partial '{tok}' via {name}"
                except Exception:
                    continue

    return None, f"'{target}' 일치 요소 없음"


def _resize_screenshot(filepath: "Path", max_width: int = 1280, quality: int = 75) -> None:
    """PNG 스크린샷을 JPEG로 변환해 용량을 줄입니다. 원본 PNG는 삭제합니다."""
    try:
        from PIL import Image
        img = Image.open(filepath).convert("RGB")
        if img.width > max_width:
            ratio = max_width / img.width
            img = img.resize((max_width, int(img.height * ratio)), Image.LANCZOS)
        jpg_path = filepath.with_suffix(".jpg")
        img.save(jpg_path, "JPEG", quality=quality, optimize=True)
        filepath.unlink()  # PNG 삭제
    except Exception as e:
        logger.warning(f"resize failed: {e}")


def _annotate_click(filepath: "Path", click_pos: dict) -> None:
    """스크린샷에 클릭 위치 빨간 원을 그립니다."""
    try:
        from PIL import Image, ImageDraw
        actual = filepath.with_suffix(".jpg") if not filepath.exists() else filepath
        img = Image.open(actual)
        draw = ImageDraw.Draw(img)
        x, y = int(click_pos["x"]), int(click_pos["y"])
        r = 24
        draw.ellipse([x - r - 3, y - r - 3, x + r + 3, y + r + 3], outline="white", width=4)
        draw.ellipse([x - r, y - r, x + r, y + r], outline="#FF3B30", width=4)
        img.save(actual, quality=85)
    except Exception as e:
        logger.warning(f"annotate failed: {e}")


async def mock_capture(job: ManualGenerationJob) -> list[dict]:
    steps = job.scenario_steps or ["메인 페이지 접속"]
    return [
        {"step": i + 1, "filename": None, "url": job.target_url,
         "description": step if isinstance(step, str) else str(step), "click_pos": None}
        for i, step in enumerate(steps)
    ]


async def generate_markdown(job: ManualGenerationJob, screenshots: list[dict]) -> str:
    llm = get_llm_provider()

    steps_text = "\n".join(
        f"- Step {s['step']}: {s['description']} (URL: {s['url']})"
        + (f"\n  페이지 텍스트: {s.get('page_text','')[:500]}" if s.get("page_text") else "")
        for s in screenshots
    )

    content = await llm.generate(
        "You are a technical writer creating user manuals in Korean.",
        f"""Generate a user manual in Korean markdown format.
Target URL: {job.target_url}
Steps:
{steps_text}

Write a clear step-by-step guide. Format as clean markdown with numbered steps.""",
    )

    md_lines = [
        "# 사용자 매뉴얼",
        "",
        f"**대상 URL:** {job.target_url}",
        "",
        "---",
        "",
        content,
        "",
        "---",
        "",
        "## 스크린샷",
        "",
    ]

    for s in screenshots:
        fname = s.get("filename")
        md_lines.append(f"### Step {s['step']}: {s['description']}")
        if fname:
            md_lines.append(f"![Step {s['step']}](/uploads/screenshots/{fname})")
        else:
            md_lines.append("*(캡처 없음)*")
        md_lines.append("")

    return "\n".join(md_lines)


async def list_jobs(db: AsyncSession, user_id: uuid.UUID | None = None) -> list[ManualGenerationJob]:
    stmt = (
        select(ManualGenerationJob)
        .options(
            selectinload(ManualGenerationJob.proposed_change)
            .selectinload(ProposedDocumentChange.approval_request)
        )
        .order_by(ManualGenerationJob.created_at.desc())
    )
    if user_id:
        stmt = stmt.where(ManualGenerationJob.user_id == user_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_job(db: AsyncSession, job_id: uuid.UUID) -> ManualGenerationJob | None:
    stmt = (
        select(ManualGenerationJob)
        .options(
            selectinload(ManualGenerationJob.proposed_change)
            .selectinload(ProposedDocumentChange.approval_request)
        )
        .where(ManualGenerationJob.id == job_id)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
