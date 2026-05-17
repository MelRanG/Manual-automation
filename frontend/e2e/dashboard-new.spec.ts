import { test, expect } from '@playwright/test'
import { loginAsDemo } from './helpers/auth'

test.describe('Dashboard - 관리자 대시보드', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page)
  })

  test('대시보드에 통계 카드 표시', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('main h2')).toContainText('대시보드')

    await expect(page.locator('main')).toContainText('문서')
    await expect(page.locator('main')).toContainText('대기 중 승인')
    await expect(page.locator('main')).toContainText('오류 제보')
    await expect(page.locator('main')).toContainText('오래된 문서')
  })

  test('대시보드에서 문서 상세 링크 동작', async ({ page }) => {
    await page.goto('/')
    const docLink = page.locator('a[href^="/documents/"]').first()
    if (await docLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await docLink.click()
      await expect(page).toHaveURL(/\/documents\//)
    }
  })
})
