import uuid
from datetime import datetime

from pydantic import BaseModel


class ChatSessionCreate(BaseModel):
    user_id: uuid.UUID
    title: str | None = None


class ChatSessionResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AskQuestionRequest(BaseModel):
    question: str


class CitationResponse(BaseModel):
    document_id: str
    document_title: str
    quote: str
    chunk_id: str


class AskQuestionResponse(BaseModel):
    message_id: str
    content: str
    citations: list[CitationResponse]
