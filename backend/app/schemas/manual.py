import uuid
from datetime import datetime

from pydantic import BaseModel


class ManualJobCreate(BaseModel):
    user_id: uuid.UUID
    target_url: str
    login_id: str | None = None
    login_pw: str | None = None
    login_url: str | None = None
    scenario_steps: list[str] | None = None
    source_sr_id: uuid.UUID | None = None


class ManualJobResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    target_url: str
    login_url: str | None
    status: str
    output_document_id: uuid.UUID | None
    screenshots: list[dict] | None
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
