import asyncio
import logging
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
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

        # 승인 흐름: ProposedChange + ApprovalRequest 생성 (Document는 승인 후 생성)
        from app.models.feedback import ProposedDocumentChange, ApprovalRequest as ApprovalReq

        proposed = ProposedDocumentChange(
            id=uuid.uuid4(),
            feedback_report_id=None,
            document_id=None,
            document_version_id=None,
            manual_job_id=job.id,
            original_text="",
            proposed_text=markdown,
            diff="",
            reasoning=f"Playwright auto-generated manual for {job.target_url}",
            confidence=1.0,
            source_type="playwright",
            status="pending",
        )
        db.add(proposed)
        await db.flush()

        approval = ApprovalReq(
            id=uuid.uuid4(),
            proposed_change_id=proposed.id,
            status="pending",
        )
        db.add(approval)

        job.status = "completed"
        job.screenshots = [s for s in screenshots]
        # output_document_id는 승인 후 설정
        await db.commit()

    except Exception as e:
        logger.error(f"Manual generation failed for job {job_id}: {e}")
        job.status = "failed"
        job.error_message = str(e)[:1000]
        await db.commit()

    await db.refresh(job)
    return job


async def capture_screenshots(job: ManualGenerationJob) -> list[dict]:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return await mock_capture(job)

    screenshots = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(viewport={"width": 1280, "height": 800})

            # Login if credentials provided
            if job.login_id and job.login_pw:
                login_target = job.login_url or job.target_url
                await page.goto(login_target, wait_until="networkidle", timeout=15000)
                # Try common login patterns
                username_input = page.locator('input[type="text"], input[type="email"], input[name*="user"], input[name*="login"], input[id*="user"], input[id*="login"]').first
                password_input = page.locator('input[type="password"]').first
                if await username_input.is_visible(timeout=3000):
                    await username_input.fill(job.login_id)
                    await password_input.fill(job.login_pw)
                    submit = page.locator('button[type="submit"], input[type="submit"]').first
                    if await submit.is_visible(timeout=2000):
                        await submit.click()
                    await page.wait_for_load_state("networkidle", timeout=10000)

            # Navigate to target
            await page.goto(job.target_url, wait_until="networkidle", timeout=15000)
            await asyncio.sleep(1)

            # Take main screenshot + extract text
            filename = f"{job.id}_main.png"
            filepath = SCREENSHOTS_DIR / filename
            await page.screenshot(path=str(filepath), full_page=True)
            page_text = await page.evaluate("() => document.body.innerText")
            screenshots.append({
                "step": 1,
                "filename": filename,
                "url": job.target_url,
                "description": "Main page view",
                "page_text": page_text[:3000] if page_text else "",
            })

            # If scenario steps provided, try to follow them
            if job.scenario_steps:
                for i, step in enumerate(job.scenario_steps, start=2):
                    try:
                        # Try clicking text matching the step
                        link = page.get_by_text(step, exact=False).first
                        if await link.is_visible(timeout=3000):
                            await link.click()
                            await page.wait_for_load_state("networkidle", timeout=8000)
                            await asyncio.sleep(0.5)

                        filename = f"{job.id}_step{i}.png"
                        filepath = SCREENSHOTS_DIR / filename
                        await page.screenshot(path=str(filepath), full_page=True)
                        step_text = await page.evaluate("() => document.body.innerText")
                        screenshots.append({
                            "step": i,
                            "filename": filename,
                            "url": page.url,
                            "description": step,
                            "page_text": step_text[:2000] if step_text else "",
                        })
                    except Exception:
                        screenshots.append({
                            "step": i,
                            "filename": None,
                            "url": page.url,
                            "description": f"{step} (capture failed)",
                            "page_text": "",
                        })

            await browser.close()
    except Exception as e:
        logger.warning(f"Playwright capture failed, using mock: {e}")
        return await mock_capture(job)

    return screenshots


async def mock_capture(job: ManualGenerationJob) -> list[dict]:
    steps = job.scenario_steps or ["메인 페이지 접속"]
    screenshots = []
    for i, step in enumerate(steps, start=1):
        screenshots.append({
            "step": i,
            "filename": None,
            "url": job.target_url,
            "description": step if isinstance(step, str) else str(step),
        })
    return screenshots


async def generate_markdown(job: ManualGenerationJob, screenshots: list[dict]) -> str:
    llm = get_llm_provider()

    steps_text_parts = []
    for s in screenshots:
        part = f"- Step {s['step']}: {s['description']} (URL: {s['url']})"
        page_text = s.get("page_text", "")
        if page_text:
            part += f"\n  페이지 텍스트 (일부):\n  {page_text[:500]}"
        steps_text_parts.append(part)
    steps_text = "\n".join(steps_text_parts)

    prompt = f"""Generate a user manual in Korean markdown format for the following website interaction.
Target URL: {job.target_url}
Steps captured (with extracted page text):
{steps_text}

Write a clear, step-by-step user guide that a non-technical person can follow.
Include numbered steps with descriptions based on the actual page content.
Format as clean markdown."""

    content = await llm.generate(
        "You are a technical writer creating user manuals in Korean.",
        prompt,
    )

    # Build final markdown
    md_lines = [
        "# 사용자 매뉴얼",
        "",
        f"**대상 URL:** {job.target_url}",
        "**생성일:** Auto-generated by Manual Automation",
        "",
        "---",
        "",
        content,
        "",
        "---",
        "",
        "## 스크린샷 참조",
        "",
    ]

    for s in screenshots:
        if s["filename"]:
            md_lines.append(f"### Step {s['step']}: {s['description']}")
            md_lines.append(f"![Step {s['step']}](/uploads/screenshots/{s['filename']})")
            md_lines.append("")
        else:
            md_lines.append(f"### Step {s['step']}: {s['description']}")
            md_lines.append("*(스크린샷 없음)*")
            md_lines.append("")

    return "\n".join(md_lines)


async def list_jobs(db: AsyncSession, user_id: uuid.UUID | None = None) -> list[ManualGenerationJob]:
    stmt = select(ManualGenerationJob).order_by(ManualGenerationJob.created_at.desc())
    if user_id:
        stmt = stmt.where(ManualGenerationJob.user_id == user_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_job(db: AsyncSession, job_id: uuid.UUID) -> ManualGenerationJob | None:
    result = await db.execute(select(ManualGenerationJob).where(ManualGenerationJob.id == job_id))
    return result.scalar_one_or_none()
