import { test, expect } from '@playwright/test'
import { loginAsDemo } from './helpers/auth'

/**
 * 비기술적 현업 사용자 + PM 페르소나 UX 검증
 * - 도메인 지식/개발 지식 없는 현업
 * - 사용자 메뉴얼 작성이 귀찮은 PM
 */
test.describe('UX 워크스루 - 사용자 관점', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page)
  })

  test('전체 네비게이션 흐름: 사이드바 모든 메뉴가 정상 동작', async ({ page }) => {
    await page.goto('/')
    const menus = [
      { text: '대시보드', url: '/' },
      { text: '문서 관리', url: '/documents' },
      { text: 'Q&A 챗봇', url: '/chat' },
      { text: '오류 제보', url: '/feedback' },
      { text: '승인 관리', url: '/approvals' },
      { text: '신뢰도 점수', url: '/trust' },
      { text: '서비스 요청', url: '/sr' },
      { text: '변경 영향', url: '/change-impact' },
      { text: '웹훅 로그', url: '/webhook-logs' },
      { text: '매뉴얼 생성', url: '/manuals' },
      { text: '위젯 대화', url: '/widget-conversations' },
    ]
    for (const menu of menus) {
      await page.locator('aside').getByText(menu.text, { exact: true }).click()
      await expect(page).toHaveURL(menu.url)
      await expect(page.locator('main')).toBeVisible()
    }
  })

  test('PM 플로우: 문서 생성 → 대시보드에서 확인', async ({ page }) => {
    await page.goto('/documents')
    await page.getByText('새 문서').click()
    await page.fill('input[placeholder="문서 제목"]', 'PM 테스트 문서')
    await page.fill('textarea[placeholder="문서 내용..."]', '이것은 PM이 만든 테스트 문서입니다.')
    await page.getByText('문서 생성').click()
    await expect(page.locator('main')).toContainText('PM 테스트 문서', { timeout: 5000 })

    await page.locator('aside').getByText('대시보드').click()
    await expect(page).toHaveURL('/')
    await expect(page.locator('main')).toContainText('문서')
  })

  test('PM 플로우: 매뉴얼 자동 생성 요청', async ({ page }) => {
    await page.goto('/manuals')
    await expect(page.locator('main h2')).toContainText('사용자 매뉴얼 생성')

    await expect(page.locator('main')).toContainText('웹사이트 URL을 입력하면')
    await expect(page.locator('main')).toContainText('AI가 매뉴얼을 자동 생성')

    await page.getByRole('button', { name: '새 매뉴얼 생성' }).click()

    await expect(page.getByText('대상 URL *')).toBeVisible()
    await expect(page.getByText('로그인 URL (선택)')).toBeVisible()
    await expect(page.getByText('시나리오 단계 (선택)')).toBeVisible()

    await page.getByPlaceholder('https://example.com', { exact: true }).fill('https://www.hanjin.co.kr')
    await page.getByRole('button', { name: '매뉴얼 생성 시작' }).click()

    await expect(page.locator('main')).toContainText('https://www.hanjin.co.kr')
  })

  test('PM 플로우: 채팅으로 문서 Q&A', async ({ page }) => {
    await page.goto('/chat')
    await expect(page.locator('text=무엇을 도와드릴까요?')).toBeVisible()

    await page.getByRole('button', { name: '새 대화 시작' }).click()

    await expect(page.locator('textarea[placeholder*="문서 내용에 대해 질문해보세요"]')).toBeVisible({ timeout: 5000 })
  })

  test('PM 플로우: 오류 제보', async ({ page }) => {
    await page.goto('/feedback')
    await expect(page.locator('main h2')).toContainText('오류 제보')

    await page.getByRole('button', { name: '오류 제보' }).click()

    const textarea = page.locator('textarea[placeholder*="발견한 오류나 문제를 설명"]')
    await expect(textarea).toBeVisible()

    await textarea.fill('문서 3페이지에 오타가 있습니다. "완료" → "완룔"')
    await page.getByRole('button', { name: '제보 제출' }).click()

    await expect(page.locator('main')).toContainText('문서 3페이지에 오타가 있습니다')
  })

  test('PM 플로우: Service Request 생성', async ({ page }) => {
    await page.goto('/sr')
    await page.getByRole('button', { name: '새 SR' }).click()

    await page.fill('input[placeholder="SR 제목"]', '홈페이지 메뉴 수정 요청')
    await page.fill('textarea[placeholder="상세 설명..."]', '상단 메뉴 순서를 변경해주세요')
    await page.getByRole('button', { name: '초안 생성' }).click()

    await expect(page.locator('main')).toContainText('홈페이지 메뉴 수정 요청', { timeout: 5000 })
  })

  test('현업 관점: 승인 페이지 이해하기 쉬운지', async ({ page }) => {
    await page.goto('/approvals')
    await expect(page.locator('main')).toContainText('승인 관리')
  })

  test('현업 관점: 신뢰도 점수 페이지 접근', async ({ page }) => {
    await page.goto('/trust')
    await expect(page.locator('main')).toContainText('신뢰도 점수')
  })

  test('현업 관점: 웹훅 로그 페이지가 오류 없이 로드됨', async ({ page }) => {
    await page.goto('/webhook-logs')
    await expect(page.locator('main h2')).toContainText('웹훅 로그')
    await expect(page.locator('main')).toContainText('Jira 웹훅 전송 이력')
  })
})
