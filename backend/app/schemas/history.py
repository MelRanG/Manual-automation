import uuid
from pydantic import BaseModel


class ChangeHistoryResponse(BaseModel):
    id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    event_type: str
    actor_id: uuid.UUID | None
    actor_name: str | None
    detail: str | None
    created_at: str

    model_config = {"from_attributes": True}
