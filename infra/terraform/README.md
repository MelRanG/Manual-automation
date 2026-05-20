# Independent AWS Terraform Stack

이 디렉터리는 기존 AWS 인프라와 충돌하지 않도록 `manual-auto-codex-dev-*` 이름으로 별도 배포 환경을 만든다.

## Managed Resources

- VPC, public/private subnets, internet gateway
- ECR repository
- ECS Fargate cluster, service, and task definition
- Public ALB
- Private RDS PostgreSQL 16
- Private S3 uploads bucket
- Secrets Manager app env secret
- CloudWatch log group
- ECS task execution/task IAM roles

## Current App Notes

- Pushes to `main`, `master`, or `aws` run `.github/workflows/deploy-aws.yml`.
- The root `Dockerfile` builds one container containing the frontend and backend.
- Document uploads are S3-only. `UPLOADS_S3_BUCKET` is required and local upload storage is not used.
- pgvector support is handled by Alembic migrations for `document_chunks.embedding`.
- The latest deployed ALB URL is recorded in `last-deployment-url.txt`.

## Local Terraform Checks

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform validate
terraform plan
```

The CI deployment creates/imports ECR first, builds and pushes the image, applies Terraform, then waits for the ECS service to become stable.

## GitHub Secrets

`.github/workflows/deploy-aws.yml` uses these repository secrets:

| Name | Description |
| --- | --- |
| `AWS_ACCESS_KEY_ID` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `AWS_REGION` | Optional. Defaults to `us-east-1` |
