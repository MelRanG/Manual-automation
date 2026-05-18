import uuid

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class SRDraft(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "sr_drafts"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(50), default="medium")
    related_document_ids: Mapped[list | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    created_by_ai: Mapped[bool] = mapped_column(default=True)
    jira_issue_key: Mapped[str | None] = mapped_column(String(50), nullable=True)
    jira_issue_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    webhook_logs: Mapped[list["WebhookDeliveryLog"]] = relationship(
        back_populates="sr_draft"
    )


class WebhookDeliveryLog(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "webhook_delivery_logs"

    sr_draft_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sr_drafts.id"), index=True
    )
    target_url: Mapped[str] = mapped_column(String(1000))
    payload: Mapped[dict] = mapped_column(JSONB)
    response_status: Mapped[int | None] = mapped_column(Integer)
    response_body: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="pending")

    sr_draft: Mapped["SRDraft"] = relationship(back_populates="webhook_logs")


class ChangeImpactAnalysis(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "change_impact_analyses"

    source_type: Mapped[str] = mapped_column(String(50))
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    related_document_ids: Mapped[list | None] = mapped_column(JSONB)
    recommended_strategy: Mapped[str] = mapped_column(String(50))
    reasoning: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(50), default="pending")

    proposals: Mapped[list["DocumentChangeProposal"]] = relationship(
        back_populates="impact_analysis"
    )


class DocumentChangeProposal(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "document_change_proposals"

    impact_analysis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("change_impact_analyses.id"), index=True
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id")
    )
    original_content: Mapped[str] = mapped_column(Text)
    proposed_content: Mapped[str] = mapped_column(Text)
    diff: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    reviewed_at: Mapped[str | None] = mapped_column(String(50))

    impact_analysis: Mapped["ChangeImpactAnalysis"] = relationship(
        back_populates="proposals"
    )
