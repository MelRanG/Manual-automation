import asyncio
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.manual import ManualGenerationJob
from app.services.document_service import UPLOAD_DIR
from app.services.llm_service import get_llm_provider

logger = logging.getLogger(__name__)

SCREENSHOTS_DIR = UPLOAD_DIR / "screenshots"
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)


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
    await db.refresh(job)
    return job


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

                    try:
                        # 링크 우선, 없으면 버튼, 그 다음 텍스트 요소
                        locator = page.locator(f'a:has-text("{click_target}")').first
                        if not await locator.is_visible(timeout=1500):
                            locator = page.locator(f'button:has-text("{click_target}")').first
                        if not await locator.is_visible(timeout=1000):
                            locator = page.get_by_text(click_target, exact=False).first

                        if await locator.is_visible(timeout=2000):
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
                    except Exception:
                        pass

                    try:
                        # 클릭 후 결과 화면
                        after_png = SCREENSHOTS_DIR / f"{job.id}_step{i}a.png"
                        await page.screenshot(path=str(after_png), full_page=False)
                        _resize_screenshot(after_png)
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
                            screenshots.append({
                                "step": i,
                                "filename": f"{job.id}_step{i}a.jpg",
                                "url": page.url,
                                "description": f"{step} (클릭 실패)",
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


def _extract_click_target(step: str) -> str:
    """'뉴스 클릭', '뉴스클릭', '뉴스 선택' 등에서 타겟 텍스트 추출."""
    for suffix in [" 클릭", "클릭", " 선택", "선택", " 이동", "이동"]:
        if step.endswith(suffix):
            return step[: -len(suffix)].strip()
    return step.strip()


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
    from sqlalchemy import select as sa_select
    stmt = sa_select(ManualGenerationJob).order_by(ManualGenerationJob.created_at.desc())
    if user_id:
        stmt = stmt.where(ManualGenerationJob.user_id == user_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_job(db: AsyncSession, job_id: uuid.UUID) -> ManualGenerationJob | None:
    result = await db.execute(select(ManualGenerationJob).where(ManualGenerationJob.id == job_id))
    return result.scalar_one_or_none()
