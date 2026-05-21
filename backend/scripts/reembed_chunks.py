"""기존 document_chunks 임베딩을 현재 EMBEDDING_MODEL 설정으로 재계산.

Mock 임베딩으로 저장된 청크를 Bedrock Titan(또는 OpenAI)로 재임베딩한다.
배치 단위로 처리, 진행률 출력.

사용:
    cd backend && uv run python scripts/reembed_chunks.py [--batch-size 32] [--dry-run]
"""

import argparse
import asyncio
import sys
import time
from pathlib import Path

# backend/ 디렉토리를 sys.path에 추가
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select, update

from app.config import settings
from app.db import SessionLocal
from app.models.document import DocumentChunk
from app.services.embedding_service import get_embedding_provider


async def reembed_all(batch_size: int = 32, dry_run: bool = False) -> None:
    print(f"EMBEDDING_MODEL={settings.embedding_model}")
    if settings.embedding_model == "mock":
        print("ERROR: EMBEDDING_MODEL is still 'mock'. .env 먼저 변경하라.")
        sys.exit(1)

    provider = get_embedding_provider()

    async with SessionLocal() as session:
        total_result = await session.execute(select(DocumentChunk.id))
        all_ids = [row[0] for row in total_result.all()]
        total = len(all_ids)
        print(f"대상 청크: {total}개, 배치 {batch_size}")

        if dry_run:
            print("--dry-run: 실제 업데이트 안 함")
            return

        start = time.time()
        done = 0
        for offset in range(0, total, batch_size):
            batch_ids = all_ids[offset : offset + batch_size]
            rows = await session.execute(
                select(DocumentChunk.id, DocumentChunk.content).where(
                    DocumentChunk.id.in_(batch_ids)
                )
            )
            items = rows.all()
            texts = [r[1] for r in items]
            ids = [r[0] for r in items]

            embeddings = await provider.embed(texts)

            for cid, emb in zip(ids, embeddings):
                await session.execute(
                    update(DocumentChunk)
                    .where(DocumentChunk.id == cid)
                    .values(embedding=emb)
                )
            await session.commit()

            done += len(items)
            elapsed = time.time() - start
            rate = done / elapsed if elapsed > 0 else 0
            eta = (total - done) / rate if rate > 0 else 0
            print(f"  {done}/{total} ({100*done/total:.1f}%) | {rate:.1f}청크/s | ETA {eta:.0f}s")

        print(f"완료. 총 {time.time() - start:.1f}s")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(reembed_all(batch_size=args.batch_size, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
