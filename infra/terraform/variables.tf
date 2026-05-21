variable "aws_region" {
  description = "AWS region for the independent deployment stack."
  type        = string
  default     = "us-east-1"
}

variable "account_id" {
  description = "AWS account id used for unique resource names."
  type        = string
  default     = "136609826435"
}

variable "project_name" {
  description = "Short project name used in resource names."
  type        = string
  default     = "manual-auto"
}

variable "environment" {
  description = "Independent environment name. Keep this distinct from existing production resources."
  type        = string
  default     = "codex-dev"
}

variable "image_tag" {
  description = "Container image tag deployed to ECS. CI passes the git SHA."
  type        = string
  default     = "latest"
}

variable "container_port" {
  description = "Port exposed by the all-in-one application container."
  type        = number
  default     = 80
}

variable "desired_count" {
  description = "Desired ECS task count."
  type        = number
  default     = 1
}

variable "task_cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 1024
}

variable "task_memory" {
  description = "Fargate task memory in MiB."
  type        = number
  default     = 2048
}

variable "db_name" {
  description = "PostgreSQL database name."
  type        = string
  default     = "docops"
}

variable "db_username" {
  description = "PostgreSQL master username."
  type        = string
  default     = "docops"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GiB."
  type        = number
  default     = 20
}

variable "allowed_http_cidr_blocks" {
  description = "CIDR blocks allowed to access the public load balancer."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "llm_provider" {
  description = "Application LLM provider."
  type        = string
  default     = "bedrock"
}

variable "embedding_model" {
  description = "Application embedding provider."
  type        = string
  default     = "bedrock"
}

variable "bedrock_model_id" {
  description = "Bedrock model id when LLM_PROVIDER=bedrock."
  type        = string
  default     = "us.anthropic.claude-sonnet-4-6"
}

variable "bedrock_embedding_model_id" {
  description = "Bedrock embedding model id. Keep dimensions aligned with document_chunks.embedding."
  type        = string
  default     = "amazon.titan-embed-text-v1"
}

variable "bedrock_gateway_url" {
  description = "Optional internal Bedrock/LiteLLM gateway URL."
  type        = string
  default     = ""
}

variable "bedrock_api_key" {
  description = "Optional Bedrock gateway API key. Prefer setting this after apply with Secrets Manager."
  type        = string
  default     = ""
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Optional Anthropic API key."
  type        = string
  default     = ""
  sensitive   = true
}

variable "openai_api_key" {
  description = "Optional OpenAI API key."
  type        = string
  default     = ""
  sensitive   = true
}

variable "jira_webhook_url" {
  description = "Optional outbound Jira webhook URL."
  type        = string
  default     = ""
  sensitive   = true
}

variable "health_check_path" {
  description = "ALB health check path."
  type        = string
  default     = "/nginx-health"
}
