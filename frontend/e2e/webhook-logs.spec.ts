import { test, expect } from '@playwright/test'
import { loginAsDemo } from './helpers/auth'

test.describe('Webhook Logs - 웹훅 전송 로그', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page)
  })

  test('페이지 로드 및 빈 상태 표시', async ({ page }) => {
    await page.goto('/webhook-logs')
    await expect(page.locator('main h2')).toContainText('웹훅 로그')
    await expect(page.locator('main')).toContainText('Jira 웹훅 전송 이력')
  })

  test('새로고침 버튼 동작', async ({ page }) => {
    await page.goto('/webhook-logs')
    const refreshBtn = page.getByRole('button', { name: /새로고침/i })
    await expect(refreshBtn).toBeVisible()
    await refreshBtn.click()
    await expect(page.locator('main h2')).toContainText('웹훅 로그')
  })
})
