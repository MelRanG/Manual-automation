# Independent AWS Terraform Stack

이 디렉터리는 기존 AWS 인프라와 충돌하지 않도록 `manual-auto-codex-dev-*` 이름으로 새 배포 환경을 만든다.

## 생성 리소스

- VPC, public/private subnet, internet gateway
- 단일 ECR repository
- ECS Fargate cluster/service/task definition
- Public ALB
- Private RDS PostgreSQL 16
- Private S3 uploads bucket
- Secrets Manager app env secret
- CloudWatch log group
- ECS task execution/task IAM roles

## 중요한 전제

- 루트 `Dockerfile`을 사용해 프론트엔드와 백엔드를 한 컨테이너로 배포한다.
- 기존 ECS/RDS/ECR은 참조하거나 수정하지 않는다.
- S3 bucket은 먼저 인프라만 준비한다. 현재 백엔드 업로드 코드는 로컬 `uploads` 디렉터리를 사용하므로, 실제 업로드를 S3로 저장하려면 애플리케이션 코드 변경이 추가로 필요하다.
- 민감한 값은 Terraform state에 남을 수 있다. 운영 키는 가능하면 apply 후 Secrets Manager에서 직접 갱신한다.

## 로컬 실행

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform validate
terraform plan
```

최초 배포는 ECR repository가 먼저 필요하므로 CI에서는 다음 순서로 실행한다.

```text
1. terraform apply -target=aws_ecr_repository.app
2. docker build
3. docker push
4. terraform apply
5. aws ecs wait services-stable
```

## GitHub Secrets

`.github/workflows/deploy-aws.yml`가 아래 값을 사용한다.

| 이름 | 설명 |
| --- | --- |
| `AWS_ACCESS_KEY_ID` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `AWS_REGION` | 선택. 기본값 `us-east-1` |

기존 키를 일단 쓸 수는 있지만, 노출된 키는 폐기 후 새로 발급하는 것이 안전하다.
