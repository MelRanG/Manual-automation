import uuid

from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey, Integer, String, Text, Float
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class Document(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "documents"

    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_versions.id", use_alter=True)
    )
    status: Mapped[str] = mapped_column(String(50), default="active")
    priority: Mapped[str] = mapped_column(String(20), default="medium")
    trust_score: Mapped[float] = mapped_column(Float, default=1.0)
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    last_reviewed_at: Mapped[str | None] = mapped_column(String(50))

    # Phase 1: 문서 메타데이터
    document_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(100), nullable=True)
    audience: Mapped[str | None] = mapped_column(String(50), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    source_file_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    original_file_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    related_sr_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sr_drafts.id"), nullable=True
    )
    jira_issue_key: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tags: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    owner: Mapped["User | None"] = relationship(back_populates="documents")  # noqa: F821
    versions: Mapped[list["DocumentVersion"]] = relationship(
        back_populates="document", foreign_keys="DocumentVersion.document_id"
    )


class DocumentVersion(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "document_versions"

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id"), index=True
    )
    version_number: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    source_file_url: Mapped[str | None] = mapped_column(String(1000))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    change_summary: Mapped[str | None] = mapped_column(Text)

    document: Mapped["Document"] = relationship(
        back_populates="versions", foreign_keys=[document_id]
    )
    chunks: Mapped[list["DocumentChunk"]] = relationship(back_populates="document_version")


class DocumentChunk(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "document_chunks"

    document_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_versions.id"), index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536))
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)

    document_version: Mapped["DocumentVersion"] = relationship(back_populates="chunks")
