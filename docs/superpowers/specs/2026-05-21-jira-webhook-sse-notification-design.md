# Jira Webhook SSE 알림 누락 수정

**Date:** 2026-05-21
**Status:** Approved
**Owner:** qazwsx30803@gmail.com

## 배경

Jira 웹훅으로 이슈 상태가 "완료"로 바뀌면 백엔드는 `ApprovalRequest`를 만들고 SR을 `pending_doc_review`로 전환한다. 그러나 이 시점에 SSE 알림이 발생하지 않아 admin과 SR 작성자가 폴링 없이는 변경을 알 수 없다.

콜백 로그 예시:
```json
{
  "jira_issue_key": "SCRUM-189",
  "sr_title": "메인 페이지 '시연하기' 탭 추가",
  "jira_issue_status": "완료",
  "status": "processed"
}
```

## 근본 원인

`backend/app/routers/jira.py:96-151` `receive_jira_webhook`에서 `ApprovalRequest` 생성 후 `create_notification` 호출이 없다. SSE는 `jira_service.process_jira_done`에서만 발생(`jira_service.py:367-382`), 이는 admin이 문서를 선택한 뒤 단계라 webhook 직후 알림은 비어 있다.

## 목표

웹훅 처리 시점에 다음 두 대상에게 SSE 알림을 전송한다.

- **Admin 전원** (`User.role == "admin"`): 문서화 검토 필요 안내
- **SR 작성자** (`sr.user_id`): 자신의 SR이 Jira에서 완료 처리됨 안내

또한 기존 `process_jira_done`의 admin 알림을 `.limit(1)` 한 명에서 admin 전원으로 일관화한다.

## 설계

### 변경 위치

1. `backend/app/routers/jira.py:142-150` — `ApprovalRequest` 생성·SR 상태 전환 후 알림 호출 추가
2. `backend/app/services/jira_service.py:367-382` — admin 단일 알림을 전원 알림으로 변경

### 알림 페이로드

**Admin 대상**
```python
type = "jira_sr_doc_review_needed"
title = f"Jira SR '{sr.title}' 완료"
message = "문서화 검토가 필요합니다"
link_path = "/approvals?tab=jira_sr"
document_id = None
```

**SR 작성자 대상**
```python
type = "jira_sr_done_owner"
title = "내 SR Jira 완료 처리됨"
message = f"'{sr.title}' SR이 Jira에서 완료되었습니다"
link_path = "/approvals?tab=jira_sr"
document_id = None
```

### 흐름

```
POST /api/jira/webhook
  └─ ApprovalRequest 생성, SR.status = "pending_doc_review", commit
  └─ try:
       admins = SELECT User WHERE role = "admin"
       for admin in admins:
         create_notification(admin)  # SSE push 포함
       create_notification(sr.user_id)  # SSE push 포함
     except Exception: logger.warning(...)  # 흐름 차단 금지
  └─ return 200
```

### Error handling

알림 실패가 webhook 응답을 깨면 Jira 측 재시도가 무한 반복될 수 있다. `create_notification` 호출 전체를 `try/except`로 감싸고 실패 시 로그만 남긴다 (`jira_service.py:381` 패턴과 동일).

### 데이터 모델

기존 `Notification` 모델 사용. 스키마 변경 없음. 신규 `type` 값 2종(`jira_sr_doc_review_needed`, `jira_sr_done_owner`)이 추가된다. 프론트엔드 `NotificationBell` 컴포넌트는 `title`/`message`/`link_path`만 렌더링하고 `type`별 분기 없음(`frontend/src/components/NotificationBell.tsx:41,103,105` 확인 완료) → frontend 변경 불필요.

### `process_jira_done` 일관화

```python
# 기존
admin_result = await session.execute(
    select(User).where(User.role == "admin").limit(1)
)
admin = admin_result.scalar_one_or_none()
if admin:
    await create_notification(session, user_id=admin.id, ...)

# 변경 후
admin_result = await session.execute(
    select(User).where(User.role == "admin")
)
admins = admin_result.scalars().all()
for admin in admins:
    await create_notification(session, user_id=admin.id, ...)
```

## 테스트

신규 테스트 파일 (또는 기존 jira 테스트 파일 확장):

1. **webhook → admin + owner 알림 생성**
   - 사전: admin 2명 + SR 작성자 1명 + SR 1건 시드
   - 행위: `POST /api/jira/webhook` (완료 상태 payload)
   - 검증: `Notification` 테이블에 row 3건 (admin 2 + owner 1), 각 `type`/`link_path` 일치

2. **알림 실패가 webhook 응답을 깨지 않음**
   - 사전: `create_notification`을 raise하도록 monkeypatch
   - 검증: webhook 응답 200, `ApprovalRequest` 정상 생성, 로그 경고 출력

3. **`process_jira_done` admin 전원 알림**
   - 사전: admin 2명
   - 행위: `process_jira_done` 호출 (제안 ≥1건 생성되는 시나리오)
   - 검증: admin 2명 모두 `jira_sr_proposals_ready` 알림 받음

## YAGNI / 비목표

- 알림 그룹화/집계 도입 안 함
- 신규 알림 타입 전용 프론트엔드 렌더링 도입 안 함 (기존 UI 재사용)
- `process_jira_done` 외 다른 알림 호출부는 변경 안 함

## 영향 범위

- Backend only. Frontend 변경 없음.
- DB 마이그레이션 없음.
- 외부 시스템 영향 없음.
