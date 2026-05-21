import hashlib
import os
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


class BedrockEmbeddingProvider(EmbeddingProvider):
    def __init__(self):
        import boto3
        if settings.aws_bearer_token_bedrock.get_secret_value():
            os.environ["AWS_BEARER_TOKEN_BEDROCK"] = settings.aws_bearer_token_bedrock.get_secret_value()
        self.client = boto3.client(
            "bedrock-runtime",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id or None,
            aws_secret_access_key=settings.aws_secret_access_key or None,
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        import asyncio
        import json

        def _embed_one(text: str) -> list[float]:
            body = json.dumps({"inputText": text})
            resp = self.client.invoke_model(
                modelId=settings.bedrock_embedding_model_id,
                body=body,
                contentType="application/json",
                accept="application/json",
            )
            return json.loads(resp["body"].read())["embedding"]

        results = await asyncio.gather(
            *(asyncio.to_thread(_embed_one, text) for text in texts)
        )
        return list(results)


def get_embedding_provider() -> EmbeddingProvider:
    if settings.embedding_model == "bedrock":
        return BedrockEmbeddingProvider()
    if settings.embedding_model == "openai":
        return OpenAIEmbeddingProvider()
    return MockEmbeddingProvider()
