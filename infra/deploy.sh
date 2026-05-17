#!/usr/bin/env bash
# ECS Fargate 배포 스크립트
# 사용법: ./infra/deploy.sh <ACCOUNT_ID> <REGION> [IMAGE_TAG]
#
# 사전 준비:
#   1. aws cli 설치 및 aws configure 완료
#   2. ECR 리포 생성:
#      aws ecr create-repository --repository-name manual-automation-backend --region $REGION
#      aws ecr create-repository --repository-name manual-automation-frontend --region $REGION
#   3. task-definition.json의 플레이스홀더 치환 후 실행

set -euo pipefail

ACCOUNT_ID="${1:?ACCOUNT_ID 필요}"
REGION="${2:?REGION 필요}"
TAG="${3:-latest}"

ECR_BASE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
BACKEND_IMAGE="${ECR_BASE}/manual-automation-backend:${TAG}"
FRONTEND_IMAGE="${ECR_BASE}/manual-automation-frontend:${TAG}"

echo "=== ECR 로그인 ==="
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_BASE"

echo "=== 백엔드 빌드 & 푸시 ==="
docker build --platform linux/amd64 -t "$BACKEND_IMAGE" ./backend
docker push "$BACKEND_IMAGE"

echo "=== 프론트엔드 빌드 & 푸시 ==="
docker build --platform linux/amd64 -t "$FRONTEND_IMAGE" ./frontend
docker push "$FRONTEND_IMAGE"

echo "=== Task Definition 등록 ==="
# 플레이스홀더 치환 후 등록
TASK_DEF=$(sed \
  -e "s/ACCOUNT_ID/${ACCOUNT_ID}/g" \
  -e "s/REGION/${REGION}/g" \
  infra/task-definition.json)

aws ecs register-task-definition \
  --region "$REGION" \
  --cli-input-json "$TASK_DEF"

echo "=== ECS 서비스 업데이트 ==="
# ECS 클러스터/서비스 이름이 다르면 아래 값 수정
CLUSTER="manual-automation"
SERVICE="manual-automation-service"

aws ecs update-service \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --task-definition manual-automation \
  --force-new-deployment

echo ""
echo "배포 완료. 롤아웃 상태 확인:"
echo "  aws ecs describe-services --cluster $CLUSTER --services $SERVICE --region $REGION"
