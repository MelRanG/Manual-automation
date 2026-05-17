import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class ManualGenerationJob(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "manual_generation_jobs"

    source_sr_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sr_drafts.id")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    target_url: Mapped[str] = mapped_column(String(2000))
    login_id: Mapped[str | None] = mapped_column(String(500))
    login_pw: Mapped[str | None] = mapped_column(String(500))
    login_url: Mapped[str | None] = mapped_column(String(2000))
    scenario_steps: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    output_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id")
    )
    screenshots: Mapped[dict | None] = mapped_column(JSONB)
    error_message: Mapped[str | None] = mapped_column(Text)
