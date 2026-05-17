import asyncio
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator

from app.config import settings


class LLMProvider(ABC):
    @abstractmethod
    async def generate(self, system_prompt: str, user_message: str, context: str = "") -> str:
        ...

    @abstractmethod
    async def generate_stream(self, system_prompt: str, user_message: str, context: str = "") -> AsyncGenerator[str, None]:
        ...


class MockLLMProvider(LLMProvider):
    async def generate(self, system_prompt: str, user_message: str, context: str = "") -> str:
        if context:
            return (
                f"Based on the provided documentation, here is my answer to your question "
                f"about '{user_message[:50]}': The relevant information indicates that the "
                f"documentation covers this topic. [Source: provided context]"
            )
        return f"I can help with '{user_message[:50]}'. However, I don't have specific documentation context to reference for this query."

    async def generate_stream(self, system_prompt: str, user_message: str, context: str = "") -> AsyncGenerator[str, None]:
        full_response = await self.generate(system_prompt, user_message, context)
        words = full_response.split(" ")
        for i, word in enumerate(words):
            yield word if i == 0 else f" {word}"
            await asyncio.sleep(0.03)


class BedrockLLMProvider(LLMProvider):
    def __init__(self):
        import anthropic
        kwargs: dict = {"aws_region": settings.aws_region}
        if settings.aws_access_key_id:
            kwargs["aws_access_key"] = settings.aws_access_key_id
            kwargs["aws_secret_key"] = settings.aws_secret_access_key
        self.client = anthropic.AsyncAnthropicBedrock(**kwargs)
        self.model = settings.bedrock_model_id

    async def generate(self, system_prompt: str, user_message: str, context: str = "") -> str:
        full_message = user_message
        if context:
            full_message = f"Context from documentation:\n{context}\n\nUser question: {user_message}"

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=2048,
            system=system_prompt,
            messages=[{"role": "user", "content": full_message}],
        )
        return response.content[0].text  # type: ignore[union-attr]

    async def generate_stream(self, system_prompt: str, user_message: str, context: str = "") -> AsyncGenerator[str, None]:
        full_message = user_message
        if context:
            full_message = f"Context from documentation:\n{context}\n\nUser question: {user_message}"

        async with self.client.messages.stream(
            model=self.model,
            max_tokens=2048,
            system=system_prompt,
            messages=[{"role": "user", "content": full_message}],
        ) as stream:
            async for text in stream.text_stream:
                yield text


class AnthropicLLMProvider(LLMProvider):
    def __init__(self):
        import anthropic
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def generate(self, system_prompt: str, user_message: str, context: str = "") -> str:
        full_message = user_message
        if context:
            full_message = f"Context from documentation:\n{context}\n\nUser question: {user_message}"

        response = await self.client.messages.create(
            model="claude-sonnet-4-6-20251101",
            max_tokens=2048,
            system=system_prompt,
            messages=[{"role": "user", "content": full_message}],
        )
        return response.content[0].text  # type: ignore[union-attr]

    async def generate_stream(self, system_prompt: str, user_message: str, context: str = "") -> AsyncGenerator[str, None]:
        full_message = user_message
        if context:
            full_message = f"Context from documentation:\n{context}\n\nUser question: {user_message}"

        async with self.client.messages.stream(
            model="claude-sonnet-4-6-20251101",
            max_tokens=2048,
            system=system_prompt,
            messages=[{"role": "user", "content": full_message}],
        ) as stream:
            async for text in stream.text_stream:
                yield text


class OpenAILLMProvider(LLMProvider):
    def __init__(self):
        import openai
        self.client = openai.AsyncOpenAI(api_key=settings.openai_api_key)

    async def generate(self, system_prompt: str, user_message: str, context: str = "") -> str:
        full_message = user_message
        if context:
            full_message = f"Context from documentation:\n{context}\n\nUser question: {user_message}"

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": full_message},
            ],
            max_tokens=2048,
        )
        return response.choices[0].message.content

    async def generate_stream(self, system_prompt: str, user_message: str, context: str = "") -> AsyncGenerator[str, None]:
        full_message = user_message
        if context:
            full_message = f"Context from documentation:\n{context}\n\nUser question: {user_message}"

        stream = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": full_message},
            ],
            max_tokens=2048,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content


def get_llm_provider() -> LLMProvider:
    if settings.llm_provider == "bedrock":
        return BedrockLLMProvider()
    elif settings.llm_provider == "anthropic":
        return AnthropicLLMProvider()
    elif settings.llm_provider == "openai":
        return OpenAILLMProvider()
    return MockLLMProvider()
