import json
import uuid
from collections.abc import AsyncGenerator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatSession, ChatMessage, AnswerCitation
from app.models.document import Document
from app.services.llm_service import get_llm_provider
from app.services.search_service import search_similar_chunks

RAG_SYSTEM_PROMPT = """You are a helpful documentation assistant for Manual Automation.
Answer questions based on the provided documentation context.
Be accurate and cite sources when possible. If the context doesn't contain relevant information, say so clearly.
Keep answers concise and actionable."""


async def create_session(db: AsyncSession, user_id: uuid.UUID, title: str | None = None) -> ChatSession:
    session = ChatSession(
        id=uuid.uuid4(),
        user_id=user_id,
        title=title,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def get_session(db: AsyncSession, session_id: uuid.UUID) -> ChatSession | None:
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    return result.scalar_one_or_none()


async def list_sessions(db: AsyncSession, user_id: uuid.UUID) -> list[ChatSession]:
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == user_id)
        .order_by(ChatSession.created_at.desc())
    )
    return list(result.scalars().all())


async def get_messages(db: AsyncSession, session_id: uuid.UUID) -> list[ChatMessage]:
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    return list(result.scalars().all())


async def ask_question(
    db: AsyncSession, session_id: uuid.UUID, question: str
) -> dict:
    session = await get_session(db, session_id)
    if not session:
        raise ValueError("Session not found")

    user_msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_id,
        role="user",
        content=question,
    )
    db.add(user_msg)
    await db.flush()

    relevant_chunks = await search_similar_chunks(db, question, top_k=5)

    context = "\n\n---\n\n".join(
        f"[{c['document_title']}] {c['content']}" for c in relevant_chunks
    )

    llm = get_llm_provider()
    answer = await llm.generate(RAG_SYSTEM_PROMPT, question, context)

    assistant_msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_id,
        role="assistant",
        content=answer,
    )
    db.add(assistant_msg)
    await db.flush()

    citations = []
    for chunk in relevant_chunks:
        citation = AnswerCitation(
            id=uuid.uuid4(),
            chat_message_id=assistant_msg.id,
            document_id=chunk["document_id"],
            document_version_id=chunk["document_version_id"],
            chunk_id=chunk["chunk_id"],
            quote=chunk["content"][:200],
        )
        db.add(citation)
        citations.append({
            "document_id": str(chunk["document_id"]),
            "document_title": chunk["document_title"],
            "quote": chunk["content"][:200],
            "chunk_id": str(chunk["chunk_id"]),
        })

    await db.commit()

    if not session.title and len(question) > 0:
        session.title = question[:100]
        await db.commit()

    # Check for low-trust or stale document warnings
    warnings = []
    seen_doc_ids = set()
    for chunk in relevant_chunks:
        doc_id = chunk["document_id"]
        if doc_id in seen_doc_ids:
            continue
        seen_doc_ids.add(doc_id)
        doc_result = await db.execute(select(Document).where(Document.id == doc_id))
        doc = doc_result.scalar_one_or_none()
        if doc:
            if doc.trust_score < 0.6:
                warnings.append({"document_id": str(doc_id), "title": doc.title, "reason": "trust_score_low"})
            elif doc.status == "stale":
                warnings.append({"document_id": str(doc_id), "title": doc.title, "reason": "stale"})

    return {
        "message_id": str(assistant_msg.id),
        "content": answer,
        "citations": citations,
        "warnings": warnings,
    }


async def ask_question_stream(
    db: AsyncSession, session_id: uuid.UUID, question: str
) -> AsyncGenerator[str, None]:
    session = await get_session(db, session_id)
    if not session:
        raise ValueError("Session not found")

    user_msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_id,
        role="user",
        content=question,
    )
    db.add(user_msg)
    await db.flush()

    relevant_chunks = await search_similar_chunks(db, question, top_k=5)

    context = "\n\n---\n\n".join(
        f"[{c['document_title']}] {c['content']}" for c in relevant_chunks
    )

    llm = get_llm_provider()
    full_content = ""

    async for token in llm.generate_stream(RAG_SYSTEM_PROMPT, question, context):
        full_content += token
        yield f"event: token\ndata: {json.dumps({'token': token})}\n\n"

    assistant_msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_id,
        role="assistant",
        content=full_content,
    )
    db.add(assistant_msg)
    await db.flush()

    citations = []
    for chunk in relevant_chunks:
        citation = AnswerCitation(
            id=uuid.uuid4(),
            chat_message_id=assistant_msg.id,
            document_id=chunk["document_id"],
            document_version_id=chunk["document_version_id"],
            chunk_id=chunk["chunk_id"],
            quote=chunk["content"][:200],
        )
        db.add(citation)
        citations.append({
            "document_id": str(chunk["document_id"]),
            "document_title": chunk["document_title"],
            "quote": chunk["content"][:200],
            "chunk_id": str(chunk["chunk_id"]),
        })

    await db.commit()

    if not session.title and len(question) > 0:
        session.title = question[:100]
        await db.commit()

    warnings = []
    seen_doc_ids = set()
    for chunk in relevant_chunks:
        doc_id = chunk["document_id"]
        if doc_id in seen_doc_ids:
            continue
        seen_doc_ids.add(doc_id)
        doc_result = await db.execute(select(Document).where(Document.id == doc_id))
        doc = doc_result.scalar_one_or_none()
        if doc:
            if doc.trust_score < 0.6:
                warnings.append({"document_id": str(doc_id), "title": doc.title, "reason": "trust_score_low"})
            elif doc.status == "stale":
                warnings.append({"document_id": str(doc_id), "title": doc.title, "reason": "stale"})

    yield f"event: citations\ndata: {json.dumps({'citations': citations, 'warnings': warnings})}\n\n"
    yield f"event: done\ndata: {json.dumps({'message_id': str(assistant_msg.id)})}\n\n"
