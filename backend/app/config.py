from pathlib import Path

from pydantic import SecretStr
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
    uploads_s3_bucket: str = ""
    uploads_s3_prefix: str = "uploads"
    # AWS Bedrock
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"
    aws_profile: str = ""
    bedrock_model_id: str = "us.anthropic.claude-sonnet-4-6"
    bedrock_embedding_model_id: str = "amazon.titan-embed-text-v1"
    # LiteLLM 게이트웨이 (사내 프록시 환경)
    bedrock_gateway_url: str = ""
    bedrock_api_key: str = ""
    # Bedrock Long-term Bearer Token (IAM Identity Center에서 발급)
    aws_bearer_token_bedrock: SecretStr = SecretStr("")

    model_config = {"env_file": str(_ENV_FILE), "extra": "ignore"}


settings = Settings()
