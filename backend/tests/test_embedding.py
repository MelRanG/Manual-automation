from unittest.mock import patch
from app.services.embedding_service import get_embedding_provider, BedrockEmbeddingProvider, MockEmbeddingProvider


def test_get_provider_mock():
    with patch("app.services.embedding_service.settings") as mock_settings:
        mock_settings.embedding_model = "mock"
        provider = get_embedding_provider()
    assert isinstance(provider, MockEmbeddingProvider)


def test_get_provider_bedrock():
    with patch("app.services.embedding_service.settings") as mock_settings:
        mock_settings.embedding_model = "bedrock"
        mock_settings.aws_region = "us-east-1"
        mock_settings.aws_access_key_id = "key"
        mock_settings.aws_secret_access_key = "secret"
        mock_settings.aws_bearer_token_bedrock.get_secret_value.return_value = ""
        provider = get_embedding_provider()
    assert isinstance(provider, BedrockEmbeddingProvider)
