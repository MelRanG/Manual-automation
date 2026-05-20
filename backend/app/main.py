from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routers import auth, documents, users, chat, feedback, approvals, trust, sr, change_impact, manual, widget, notifications, jira
from app.seed import seed
from app.services.document_service import UPLOAD_DIR
from app.services.file_converter import STATIC_IMAGES_DIR, _use_s3


@asynccontextmanager
async def lifespan(app: FastAPI):
    await seed()
    yield


app = FastAPI(title="Manual Automation API", version="1.0.0", lifespan=lifespan)

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
app.include_router(change_impact.router)
app.include_router(manual.router)
app.include_router(widget.router)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
if not _use_s3():
    app.mount("/static/images", StaticFiles(directory=str(STATIC_IMAGES_DIR)), name="static_images")


@app.get("/health")
async def health():
    return {"status": "ok"}
