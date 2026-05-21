import asyncio
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator

from app.config import settings


def _prepend_context(messages: list[dict], context: str) -> list[dict]:
    """context가 있으면 마지막 user 메시지 앞에 RAG context를 prepend한다."""
    if not context or not messages:
        return list(messages)
    result = list(messages)
    for i in range(len(result) - 1, -1, -1):
        if result[i]["role"] == "user":
            result[i] = {
                "role": "user",
                "content": f"Context from documentation:\n{context}\n\nUser question: {result[i]['content']}",
            }
            break
    return result


class LLMProvider(ABC):
    @abstractmethod
    async def generate(self, system_prompt: str, user_message: str, context: str = "") -> str:
        ...

    @abstractmethod
    async def generate_stream(self, system_prompt: str, user_message: str, context: str = "") -> AsyncGenerator[str, None]:
        ...

    @abstractmethod
    async def generate_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> str:
        ...

    @abstractmethod
    async def generate_stream_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> AsyncGenerator[str, None]:
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

    async def generate_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> str:
        last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        return await self.generate(system_prompt, last_user, context)

    async def generate_stream_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> AsyncGenerator[str, None]:
        last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        async for token in self.generate_stream(system_prompt, last_user, context):
            yield token


class BedrockLLMProvider(LLMProvider):
    def __init__(self):
        import os
        import anthropic
        import httpx
        self.model = settings.bedrock_model_id

        if settings.bedrock_gateway_url:
            # 사내 LiteLLM 게이트웨이 방식: Virtual Key + base_url
            self.client: anthropic.AsyncAnthropicBedrock = anthropic.AsyncAnthropicBedrock(
                base_url=settings.bedrock_gateway_url,
                aws_region=settings.aws_region,
                api_key=settings.bedrock_api_key,
                http_client=httpx.AsyncClient(verify=False),
            )
        else:
            # 직접 AWS 키 방식 — 시스템 환경변수 ANTHROPIC_BEDROCK_BASE_URL이
            # 설정되어 있으면 SDK가 자동으로 게이트웨이를 사용하므로 임시 제거
            saved_base_url = os.environ.pop("ANTHROPIC_BEDROCK_BASE_URL", None)
            try:
                kwargs: dict = {"aws_region": settings.aws_region}
                if settings.aws_access_key_id:
                    kwargs["aws_access_key"] = settings.aws_access_key_id
                    kwargs["aws_secret_key"] = settings.aws_secret_access_key
                elif settings.aws_profile:
                    kwargs["aws_profile"] = settings.aws_profile
                self.client = anthropic.AsyncAnthropicBedrock(**kwargs)
            finally:
                if saved_base_url is not None:
                    os.environ["ANTHROPIC_BEDROCK_BASE_URL"] = saved_base_url

    async def generate(self, system_prompt: str, user_message: str, context: str = "") -> str:
        full_message = user_message
        if context:
            full_message = f"Context from documentation:\n{context}\n\nUser question: {user_message}"

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=settings.llm_max_tokens,
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
            max_tokens=settings.llm_max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": full_message}],
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def generate_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> str:
        prepared = _prepend_context(messages, context)
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=settings.llm_max_tokens,
            system=system_prompt,
            messages=prepared,
        )
        return response.content[0].text  # type: ignore[union-attr]

    async def generate_stream_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> AsyncGenerator[str, None]:
        prepared = _prepend_context(messages, context)
        async with self.client.messages.stream(
            model=self.model,
            max_tokens=settings.llm_max_tokens,
            system=system_prompt,
            messages=prepared,
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
            max_tokens=settings.llm_max_tokens,
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
            max_tokens=settings.llm_max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": full_message}],
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def generate_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> str:
        prepared = _prepend_context(messages, context)
        response = await self.client.messages.create(
            model="claude-sonnet-4-6-20251101",
            max_tokens=settings.llm_max_tokens,
            system=system_prompt,
            messages=prepared,
        )
        return response.content[0].text  # type: ignore[union-attr]

    async def generate_stream_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> AsyncGenerator[str, None]:
        prepared = _prepend_context(messages, context)
        async with self.client.messages.stream(
            model="claude-sonnet-4-6-20251101",
            max_tokens=settings.llm_max_tokens,
            system=system_prompt,
            messages=prepared,
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
            max_tokens=settings.llm_max_tokens,
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
            max_tokens=settings.llm_max_tokens,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def generate_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> str:
        prepared = _prepend_context(messages, context)
        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "system", "content": system_prompt}] + prepared,
            max_tokens=settings.llm_max_tokens,
        )
        return response.choices[0].message.content or ""

    async def generate_stream_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> AsyncGenerator[str, None]:
        prepared = _prepend_context(messages, context)
        stream = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "system", "content": system_prompt}] + prepared,
            max_tokens=settings.llm_max_tokens,
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
