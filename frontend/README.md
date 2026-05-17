# Frontend

React 19 + Vite + TypeScript + Tailwind CSS 4.

루트 README 참고: `../README.md`

## 개발 명령

```bash
pnpm dev          # 개발 서버 (port 5173, Vite proxy → :8000)
pnpm build        # 프로덕션 빌드
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
```

## 구조 핵심

- **`src/lib/api.ts`** — 백엔드 API 호출 함수 전부. 여기만 보면 API 인터페이스 파악 가능.
- **`src/contexts/AuthContext.tsx`** — 로그인 상태. `localStorage['docops_user']`에 user JSON 저장.
- **`src/hooks/useNotifications.ts`** — SSE 실시간 알림 구독.
- **`src/components/Layout.tsx`** — 사이드바 + 헤더 + 알림벨 + 토스트.

## 프록시 설정

`vite.config.ts`에서 `/api/*` → `http://localhost:8000` 으로 프록시.
백엔드 없이 프론트만 띄우면 API 호출은 전부 실패함.
