import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.user import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr


class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    department: str | None


@router.post("/login", response_model=UserResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user:
        name = data.email.split("@")[0]
        user = User(name=name, email=data.email, role="user")
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return UserResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        role=user.role,
        department=user.department,
    )


@router.get("/me", response_model=UserResponse)
async def me(
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="인증이 필요합니다")
    try:
        user_uuid = uuid.UUID(x_user_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="유효하지 않은 사용자 ID")
    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다")
    return UserResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        role=user.role,
        department=user.department,
    )
