import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    role: str = "user"
    department: str | None = None


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str
    department: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
