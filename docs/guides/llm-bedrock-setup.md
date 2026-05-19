# LLM(Bedrock) 연동 설정 가이드

이 프로젝트의 챗봇은 AWS Bedrock(Claude)을 통해 동작합니다.  
로컬 개발과 배포 환경 각각의 설정 방법을 안내합니다.

---

## ⚠️ 보안 필수 수칙 (먼저 읽어주세요)

### 액세스 키 유출 시 최악의 시나리오

- 유출된 키로 고성능 인스턴스를 대량 생성해 암호화폐 채굴에 악용될 경우 **단 몇 시간 만에 감당하기 어려운 비용**이 청구됩니다.
- 서비스 데이터가 랜섬웨어에 감염되거나 **통째로 삭제**될 수 있습니다.

### 반드시 지켜야 할 수칙

| 수칙 | 설명 |
|------|------|
| **소스코드 하드코딩 절대 금지** | `.env` 파일이나 코드 어디에도 키를 직접 쓰지 마세요 |
| **코드 저장소에 키 업로드 금지** | 퍼블릭/프라이빗 무관하게 GitHub에 키가 올라가선 안 됩니다 |
| **환경 변수 또는 Secret Manager 사용** | `.env`는 `.gitignore`에 포함되어 있으므로 반드시 그 안에서만 관리 |
| **IAM Role 우선 사용** | 만료 없는 액세스 키 대신 임시 자격증명(IAM Role) 사용 권장 |
| **최소 권한 원칙** | Bedrock 호출에 필요한 권한(`bedrock:InvokeModel`)만 부여 |

> `.gitignore` 확인: 이 프로젝트는 `.env` 파일이 이미 `.gitignore`에 등록되어 있습니다.  
> `git add .env`를 절대 실행하지 마세요.

---

## 로컬 개발 설정

### 사전 준비

1. **AWS CLI 설치** (없는 경우)
   ```bash
   brew install awscli   # macOS
   ```

2. **SSO 로그인**
   ```bash
   aws sso login --profile claude-code
   ```
   브라우저가 열리면 본인 계정으로 인증합니다.

3. **Virtual Key 발급**  
   SSO 로그인 후 아래 스크립트를 실행해 LiteLLM Virtual Key를 발급받습니다.
   ```bash
   /Users/muni/path/to/get-gateway-token.sh
   # 출력 예시: sk-1neKDGzGne...
   ```

### `.env` 파일 설정

프로젝트 루트의 `.env` 파일에 아래 내용을 추가합니다.  
**이 파일은 절대 git에 커밋하지 마세요.**

```env
# LLM 제공자
LLM_PROVIDER=bedrock

# 사내 LiteLLM 게이트웨이
BEDROCK_GATEWAY_URL=https://awsllmgw.hist.co.kr/bedrock
BEDROCK_API_KEY=sk-...       # get-gateway-token.sh 실행 결과값
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-6
```

> **주의:** `BEDROCK_API_KEY`는 SSO 세션 만료 시 재발급이 필요합니다.  
> 채팅이 안 되면 `aws sso login` 후 스크립트를 다시 실행해 키를 갱신하세요.

### 동작 확인

백엔드를 실행하고 `http://localhost:5173/chat`에서 질문을 입력해 응답이 오면 정상입니다.

---

## 배포 설정 (ECS Fargate)

배포 환경에서는 **액세스 키를 사용하지 않는** IAM Task Role 방식을 권장합니다.

### 방식 1: IAM Task Role (권장)

키를 코드나 환경변수에 넣지 않아도 됩니다. ECS Task Role에 Bedrock 권한을 부여하면 자동으로 인증됩니다.

**1. IAM Role에 Bedrock 권한 추가**

```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeModel",
    "bedrock:InvokeModelWithResponseStream"
  ],
  "Resource": "*"
}
```

최소 권한 원칙에 따라 `Resource`는 실제 사용하는 모델 ARN으로 제한하는 것을 권장합니다:
```
arn:aws:bedrock:us-east-1::foundation-model/us.anthropic.claude-sonnet-4-6
```

**2. Task Definition 환경변수**

`infra/task-definition.json`의 `environment` 섹션에 추가합니다.  
`AWS_ACCESS_KEY_ID`와 `AWS_SECRET_ACCESS_KEY`는 **넣지 않습니다.**

```json
{ "name": "LLM_PROVIDER", "value": "bedrock" },
{ "name": "AWS_REGION", "value": "us-east-1" },
{ "name": "BEDROCK_MODEL_ID", "value": "us.anthropic.claude-sonnet-4-6" }
```

---

### 방식 2: 사내 게이트웨이 + Secrets Manager

사내 LiteLLM 게이트웨이를 통해 연결하는 경우, `BEDROCK_API_KEY`를 **AWS Secrets Manager** 또는 **Parameter Store**로 주입합니다.

**⚠️ Task Definition에 평문으로 키를 넣지 마세요.**

```json
{ "name": "LLM_PROVIDER", "value": "bedrock" },
{ "name": "BEDROCK_GATEWAY_URL", "value": "https://awsllmgw.hist.co.kr/bedrock" },
{ "name": "BEDROCK_MODEL_ID", "value": "us.anthropic.claude-sonnet-4-6" },
{
  "name": "BEDROCK_API_KEY",
  "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:bedrock-api-key"
}
```

Secrets Manager 등록 방법:
```bash
aws secretsmanager create-secret \
  --name bedrock-api-key \
  --secret-string "sk-..."
```

---

## 자격증명 방식 우선순위 정리

백엔드 코드(`llm_service.py`)는 아래 순서로 자격증명을 선택합니다.

```
1. BEDROCK_GATEWAY_URL 설정됨 → 사내 게이트웨이 + BEDROCK_API_KEY 사용
2. AWS_ACCESS_KEY_ID 설정됨   → 액세스 키 직접 사용
3. AWS_PROFILE 설정됨         → SSO 프로필 사용
4. 모두 없음                  → 환경 자동 감지 (ECS Task Role 등)
```

| 환경 | 권장 방식 |
|------|----------|
| 로컬 개발 | 게이트웨이 + Virtual Key (방식 1) |
| ECS 배포 | IAM Task Role (방식 1) |
| ECS 배포 (게이트웨이) | Secrets Manager로 키 주입 (방식 2) |

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| 채팅 응답이 Mock 형태로 나옴 | `LLM_PROVIDER=mock` | `.env`에서 `LLM_PROVIDER=bedrock`으로 변경 |
| `Authentication Error` | Virtual Key 만료 또는 미설정 | `aws sso login` 후 `get-gateway-token.sh` 재실행 |
| `401 LiteLLM Virtual Key expected` | 게이트웨이 URL은 설정됐으나 키 미설정 | `BEDROCK_API_KEY` 값 확인 |
| `Connection refused` | 게이트웨이 URL 오타 또는 네트워크 문제 | `BEDROCK_GATEWAY_URL` 값 및 VPN 확인 |
