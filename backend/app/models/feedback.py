import uuid

from sqlalchemy import Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class FeedbackReport(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "feedback_reports"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    chat_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_messages.id")
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id")
    )
    chunk_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_chunks.id")
    )
    feedback_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="pending")

    user: Mapped["User"] = relationship(back_populates="feedback_reports")  # noqa: F821
    proposed_change: Mapped["ProposedDocumentChange | None"] = relationship(
        back_populates="feedback_report"
    )


class ProposedDocumentChange(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "proposed_document_changes"

    feedback_report_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("feedback_reports.id"), unique=True
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id")
    )
    document_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_versions.id")
    )
    original_text: Mapped[str] = mapped_column(Text)
    proposed_text: Mapped[str] = mapped_column(Text)
    diff: Mapped[str] = mapped_column(Text)
    reasoning: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float)
    source_type: Mapped[str] = mapped_column(String(50), default="feedback")
    status: Mapped[str] = mapped_column(String(50), default="pending")

    feedback_report: Mapped["FeedbackReport"] = relationship(
        back_populates="proposed_change"
    )
    approval_request: Mapped["ApprovalRequest | None"] = relationship(
        back_populates="proposed_change"
    )


class ApprovalRequest(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "approval_requests"

    proposed_change_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("proposed_document_changes.id"), unique=True
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    status: Mapped[str] = mapped_column(String(50), default="pending")
    comment: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[str | None] = mapped_column(String(50))

    proposed_change: Mapped["ProposedDocumentChange"] = relationship(
        back_populates="approval_request"
    )
