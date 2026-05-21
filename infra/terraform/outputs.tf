output "name_prefix" {
  description = "Resource name prefix for this independent stack."
  value       = local.name_prefix
}

output "ecr_repository_name" {
  description = "ECR repository name."
  value       = aws_ecr_repository.app.name
}

output "ecr_repository_url" {
  description = "ECR repository URL."
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.app.name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.app.name
}

output "load_balancer_dns_name" {
  description = "Direct ALB URL (HTTP only, for debugging). Use public_app_url for client traffic."
  value       = "http://${aws_lb.app.dns_name}"
}

output "public_app_url" {
  description = "Public HTTPS URL fronted by CloudFront. Register this as the Jira webhook target."
  value       = "https://${aws_cloudfront_distribution.app.domain_name}"
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint."
  value       = aws_db_instance.app.address
}

output "uploads_bucket_name" {
  description = "Private S3 bucket reserved for uploaded documents."
  value       = aws_s3_bucket.uploads.bucket
}

output "app_env_secret_name" {
  description = "Secrets Manager secret containing app environment variables."
  value       = aws_secretsmanager_secret.app_env.name
}
