# 로컬 환경에서 Jira 웹훅 테스트하기

Jira Cloud는 인터넷에서 접근 가능한 URL로만 웹훅을 전송합니다. 로컬 개발 서버(`localhost:8000`)는 직접 노출되지 않으므로 **ngrok**으로 터널을 열어야 합니다.

---

## 사전 준비

- [ngrok 계정 생성](https://dashboard.ngrok.com/signup) (무료 플랜으로 충분)
- ngrok CLI 설치

```bash
# macOS
brew install ngrok

# 또는 공식 다운로드: https://ngrok.com/download
```

- ngrok 인증 토큰 등록 (최초 1회)

```bash
ngrok config add-authtoken <YOUR_AUTHTOKEN>
```

대시보드 → Your Authtoken 메뉴에서 토큰 확인.

---

## 1단계: 백엔드 실행

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

---

## 2단계: ngrok 터널 열기

별도 터미널에서:

```bash
ngrok http 8000
```

실행 후 표시되는 `Forwarding` 주소를 복사합니다.

```
Forwarding  https://xxxx-xxxx.ngrok-free.app -> http://localhost:8000
```

> **주의:** ngrok 무료 플랜은 세션마다 URL이 바뀝니다. 재시작할 때마다 Jira 웹훅 URL도 업데이트해야 합니다.

---

## 3단계: Jira 웹훅 설정

1. Jira Cloud → **Project Settings** → **Automation** 또는 상단 설정 → **System** → **Webhooks**
2. **Create Webhook** 클릭
3. URL 입력:

```
https://xxxx-xxxx.ngrok-free.app/api/jira/webhook
```

4. 이벤트 선택: **Issue** → `updated` 체크 (또는 `jira:issue_updated`)
5. 저장

---

## 4단계: Jira 연동 설정 (앱 내)

앱 → **설정** → **Jira 연동** 탭에서:

| 항목 | 예시 |
|------|------|
| Jira Base URL | `https://yourcompany.atlassian.net` |
| 이메일 | Jira 계정 이메일 |
| API 토큰 | [Atlassian API 토큰 생성](https://id.atlassian.com/manage-profile/security/api-tokens) |
| 프로젝트 키 | `TEST` (Jira 프로젝트 키) |

저장 후 **연결 테스트** 버튼으로 인증 확인.

---

## 5단계: 종단 간 테스트

1. 앱 → **서비스 요청** → **새 SR** 생성 후 **제출**
2. 제출하면 Jira 이슈가 자동 생성되고 SR 카드에 이슈 키(`TEST-123`)가 표시됩니다
3. Jira에서 해당 이슈를 **Done** 상태로 변경
4. ngrok 터미널에서 수신 확인:

```
POST /api/jira/webhook  200 OK
```

5. 앱 → **설정** → **수신 로그**에서 처리 결과 확인

---

## 트러블슈팅

### `POST /  404 Not Found`

Jira 웹훅 URL에 경로가 빠진 경우입니다. URL 끝에 `/api/jira/webhook`을 추가하세요.

```
# 잘못된 예
https://xxxx.ngrok-free.app

# 올바른 예
https://xxxx.ngrok-free.app/api/jira/webhook
```

### 웹훅이 수신되지 않음 (skipped)

수신 로그 status가 `skipped`인 경우:

- **config 없음**: 앱 설정에서 Jira 연동이 저장되어 있지 않음
- **이슈 키 불일치**: SR 제출 시 Jira 이슈가 정상 생성되어야 SR에 `jira_issue_key`가 저장됨. SR을 새로 제출하고 카드에 Jira 이슈 키가 표시되는지 확인
- **Done 상태 트리거 미설정**: 기본값은 Jira `statusCategory = done`. 특정 상태명으로 제한하려면 설정에서 트리거 상태 이름을 입력

### ngrok `ERR_NGROK_3200` (세션 만료)

무료 플랜은 8시간 세션 제한. ngrok을 재시작하고 새 URL로 Jira 웹훅을 업데이트하세요.

### 연결 테스트 401

API 토큰이 만료되었거나 잘못된 경우. [Atlassian 토큰 관리](https://id.atlassian.com/manage-profile/security/api-tokens)에서 새 토큰을 발급 후 설정을 다시 저장하세요.

---

## ngrok 웹 인터페이스

ngrok 실행 중 `http://127.0.0.1:4040` 에 접속하면 요청/응답 페이로드를 실시간으로 확인할 수 있습니다.
