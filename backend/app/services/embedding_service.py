import hashlib
from abc import ABC, abstractmethod

from app.config import settings


class EmbeddingProvider(ABC):
    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        ...


class MockEmbeddingProvider(EmbeddingProvider):
    async def embed(self, texts: list[str]) -> list[list[float]]:
        results = []
        for text in texts:
            digest = hashlib.sha256(text.encode()).digest()
            vec = [b / 255.0 for b in digest]
            vec = (vec * 48)[:1536]
            results.append(vec)
        return results


class OpenAIEmbeddingProvider(EmbeddingProvider):
    def __init__(self):
        import openai
        self.client = openai.AsyncOpenAI(api_key=settings.openai_api_key)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        response = await self.client.embeddings.create(
            model="text-embedding-3-small",
            input=texts,
        )
        return [item.embedding for item in response.data]


def get_embedding_provider() -> EmbeddingProvider:
    if settings.embedding_model == "openai":
        return OpenAIEmbeddingProvider()
    return MockEmbeddingProvider()
