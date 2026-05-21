from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import auth, documents, users, chat, feedback, approvals, trust, sr, change_impact, manual, widget, notifications, jira, history
from app.seed import seed
from app.services.file_converter import STATIC_IMAGES_DIR, _use_s3


@asynccontextmanager
async def lifespan(app: FastAPI):
    await seed()
    yield


app = FastAPI(title="DocOps AI API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(notifications.router)
app.include_router(documents.router)
app.include_router(users.router)
app.include_router(chat.router)
app.include_router(feedback.router)
app.include_router(approvals.router)
app.include_router(trust.router)
app.include_router(sr.router)
app.include_router(jira.router)
app.include_router(history.router)
app.include_router(change_impact.router)
app.include_router(manual.router)
app.include_router(widget.router)

if not _use_s3():
    app.mount("/static/images", StaticFiles(directory=str(STATIC_IMAGES_DIR)), name="static_images")


def _s3_client():
    import boto3

    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
    )


@app.get("/uploads/screenshots/{name}")
def get_screenshot(name: str):
    if ".." in name or "/" in name:
        raise HTTPException(status_code=400, detail="invalid name")
    if not settings.uploads_s3_bucket:
        raise HTTPException(status_code=500, detail="bucket not configured")

    prefix = settings.uploads_s3_prefix.strip("/")
    key = (
        f"{prefix}/screenshots/{name}"
        if prefix
        else f"screenshots/{name}"
    )

    try:
        obj = _s3_client().get_object(Bucket=settings.uploads_s3_bucket, Key=key)
    except Exception as e:
        code = (
            getattr(e, "response", {}).get("Error", {}).get("Code")
            if hasattr(e, "response")
            else None
        )
        if code in ("NoSuchKey", "NoSuchBucket", "404"):
            raise HTTPException(status_code=404) from None
        raise

    body = obj["Body"].read()
    return Response(
        content=body,
        media_type=obj.get("ContentType") or "image/jpeg",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
