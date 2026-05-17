import uuid
from datetime import datetime

from pydantic import BaseModel


class WidgetSessionCreate(BaseModel):
    site_id: str
    anonymous_id: str | None = None


class WidgetSessionResponse(BaseModel):
    id: uuid.UUID
    site_id: str
    anonymous_id: str
    created_at: datetime


class WidgetAskRequest(BaseModel):
    question: str


class WidgetSessionAdmin(BaseModel):
    id: uuid.UUID
    site_id: str
    anonymous_id: str
    last_message: str | None
    message_count: int
    created_at: datetime
