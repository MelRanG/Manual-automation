# 프론트 e2e Playwright 캡처 옵션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `frontend/playwright.config.ts`에 스크린샷/비디오/트레이스 옵션을 추가해 e2e 테스트 실패 시 자동 캡처가 남도록 한다.

**Architecture:** 단일 파일 변경. Phase 1/2와 독립. 매뉴얼 자동화와 무관(매뉴얼 자동화는 백엔드 Playwright이고 별도 plan에서 처리).

**Tech Stack:** Playwright Test (TypeScript)

**Spec:** `docs/superpowers/specs/2026-05-21-notification-hub-design.md` — "별도 PR" 섹션

---

## File Structure

**Modify:**
- `frontend/playwright.config.ts`
- `frontend/.gitignore` (필요 시)

---

## Task 1: `playwright.config.ts`에 캡처 옵션 추가

**Files:**
- Modify: `frontend/playwright.config.ts`

- [ ] **Step 1: `use` 블록 갱신**

`frontend/playwright.config.ts` 전체를 다음으로 교체:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'cd ../backend && uv run uvicorn app.main:app --port 8000',
      port: 8000,
      reuseExistingServer: true,
      timeout: 15000,
    },
    {
      command: 'pnpm dev',
      port: 5173,
      reuseExistingServer: true,
      timeout: 15000,
    },
  ],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
})
```

요점:
- `screenshot: 'only-on-failure'` — 실패 시점에만 PNG 저장
- `trace: 'retain-on-failure'` — 실패한 테스트의 trace.zip 보존 (디버깅에 가장 가치 큼)
- `video: 'retain-on-failure'` — 실패 영상 보존
- 성공 케이스는 캡처 없음 → CI 시간/저장공간 영향 최소

- [ ] **Step 2: 캡처 산출물이 git에 안 잡히는지 확인**

Run: `cat frontend/.gitignore`
Expected: `test-results/`, `playwright-report/` 패턴 포함되어 있음. 없으면 다음 항목 추가:

```
test-results/
playwright-report/
```

- [ ] **Step 3: 일부러 실패하는 테스트로 캡처 동작 확인**

임시로 `frontend/e2e/_capture_smoke.spec.ts` 생성:

```typescript
import { test, expect } from '@playwright/test'

test('intentional fail to verify capture', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('this-title-definitely-does-not-exist')
})
```

Run: `cd frontend && pnpm exec playwright test e2e/_capture_smoke.spec.ts`
Expected: 테스트 실패. `frontend/test-results/_capture_smoke-...-chromium/` 폴더에 `test-failed-1.png`, `trace.zip`, `video.webm` 생성됨.

검증 후 임시 파일 삭제:

```bash
rm frontend/e2e/_capture_smoke.spec.ts
rm -rf frontend/test-results
```

- [ ] **Step 4: 기존 e2e가 회귀 없는지 확인**

Run: `cd frontend && pnpm exec playwright test --reporter=line`
Expected: 기존 동작 그대로. 통과/실패 결과는 본 PR로 변경 없음.

- [ ] **Step 5: 커밋**

```bash
git add frontend/playwright.config.ts frontend/.gitignore
git commit -m "chore(frontend): enable e2e screenshot/trace/video on failure

Playwright config의 use 블록에 screenshot, trace, video를
retain-on-failure로 설정. 성공 케이스 캡처 없음 → CI 부담 최소."
```

---

## 통합 검증

- [ ] **A. lint/typecheck 통과**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음 (config 파일 변경은 영향 없을 예정)

- [ ] **B. PR 생성**

```bash
git push -u origin <branch>
gh pr create --title "chore: enable Playwright capture on e2e failure" --body "$(cat <<'EOF'
## Summary
- screenshot/trace/video 옵션을 retain-on-failure로 설정
- 실패한 e2e 테스트의 PNG/trace/video를 test-results에 보존
- 성공 케이스는 캡처 없음 → CI 시간/저장공간 영향 최소

## Spec
docs/superpowers/specs/2026-05-21-notification-hub-design.md (별도 PR 섹션)

## Test plan
- [ ] 일부러 실패하는 테스트로 캡처 산출물 생성 확인 후 제거
- [ ] 기존 e2e 회귀 없음

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done 정의

- `frontend/playwright.config.ts`에 캡처 옵션 3종 추가
- 일부러 실패 케이스에서 산출물 정상 생성 확인
- `.gitignore` 보강 (필요 시)
