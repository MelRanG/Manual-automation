import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

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

    proposed_change: Mapped["ProposedDocumentChange | None"] = relationship(  # noqa: F821
        "ProposedDocumentChange",
        back_populates="manual_job",
        uselist=False,
        order_by="ProposedDocumentChange.created_at.desc()",
    )

    @property
    def approval(self):
        """`proposed_change.approval_request` 편의 노출 (Pydantic from_attributes에서 사용)."""
        pc = self.proposed_change
        if pc is None:
            return None
        return pc.approval_request
