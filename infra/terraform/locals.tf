locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = local.name_prefix
  }

  database_url = "postgresql+asyncpg://${var.db_username}:${random_password.db_password.result}@${aws_db_instance.app.address}:5432/${var.db_name}"

  app_secret_payload = {
    DATABASE_URL               = local.database_url
    SECRET_KEY                 = random_password.secret_key.result
    LLM_PROVIDER               = var.llm_provider
    EMBEDDING_MODEL            = var.embedding_model
    AWS_REGION                 = var.aws_region
    BEDROCK_MODEL_ID           = var.bedrock_model_id
    BEDROCK_EMBEDDING_MODEL_ID = var.bedrock_embedding_model_id
    BEDROCK_GATEWAY_URL        = var.bedrock_gateway_url
    BEDROCK_API_KEY            = var.bedrock_api_key
    ANTHROPIC_API_KEY          = var.anthropic_api_key
    OPENAI_API_KEY             = var.openai_api_key
    JIRA_WEBHOOK_URL           = var.jira_webhook_url
    UPLOADS_S3_BUCKET          = aws_s3_bucket.uploads.bucket
    UPLOADS_S3_PREFIX          = "uploads"
  }
}
