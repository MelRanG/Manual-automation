from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"

    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(50), default="user")
    department: Mapped[str | None] = mapped_column(String(255))

    documents: Mapped[list["Document"]] = relationship(back_populates="owner")  # noqa: F821
    chat_sessions: Mapped[list["ChatSession"]] = relationship(back_populates="user")  # noqa: F821
    feedback_reports: Mapped[list["FeedbackReport"]] = relationship(back_populates="user")  # noqa: F821
