from pathlib import Path

from pydantic_settings import BaseSettings

_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://docops:docops_dev@localhost:5600/docops"
    llm_provider: str = "mock"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    embedding_model: str = "mock"
    jira_webhook_url: str = ""
    secret_key: str = "change-me-in-production"
    # AWS Bedrock
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"
    aws_profile: str = ""
    bedrock_model_id: str = "us.anthropic.claude-sonnet-4-6-20251101-v1:0"
    # LiteLLM 게이트웨이 (사내 프록시 환경)
    bedrock_gateway_url: str = ""
    bedrock_api_key: str = ""

    model_config = {"env_file": str(_ENV_FILE), "extra": "ignore"}


settings = Settings()
