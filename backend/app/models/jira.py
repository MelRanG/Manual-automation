import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class JiraConfig(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "jira_configs"

    base_url: Mapped[str] = mapped_column(String(500))
    user_email: Mapped[str] = mapped_column(String(255))
    api_token: Mapped[str] = mapped_column(Text)
    project_key: Mapped[str] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    trigger_status_names: Mapped[list | None] = mapped_column(JSONB, nullable=True)


class JiraCallbackLog(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "jira_callback_logs"

    jira_issue_key: Mapped[str] = mapped_column(String(50), index=True)
    event_type: Mapped[str] = mapped_column(String(100))
    payload: Mapped[dict] = mapped_column(JSONB)
    sr_draft_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sr_drafts.id"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(50), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
