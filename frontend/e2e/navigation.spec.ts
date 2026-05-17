import { test, expect } from '@playwright/test'
import { loginAsDemo } from './helpers/auth'

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page)
  })

  test('should load dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h2')).toContainText('대시보드')
    await expect(page.locator('aside')).toContainText('DocOps AI')
  })

  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/')

    await page.locator('aside').getByText('문서 관리').click()
    await expect(page).toHaveURL('/documents')
    await expect(page.locator('main h2')).toContainText('문서 관리')

    await page.locator('aside').getByText('Q&A 챗봇').click()
    await expect(page).toHaveURL('/chat')

    await page.locator('aside').getByText('오류 제보').click()
    await expect(page).toHaveURL('/feedback')
    await expect(page.locator('main h2')).toContainText('오류 제보')

    await page.locator('aside').getByText('승인 관리').click()
    await expect(page).toHaveURL('/approvals')

    await page.locator('aside').getByText('신뢰도 점수').click()
    await expect(page).toHaveURL('/trust')

    await page.locator('aside').getByText('서비스 요청').click()
    await expect(page).toHaveURL('/sr')

    await page.locator('aside').getByText('변경 영향').click()
    await expect(page).toHaveURL('/change-impact')

    await page.locator('aside').getByText('웹훅 로그').click()
    await expect(page).toHaveURL('/webhook-logs')

    await page.locator('aside').getByText('매뉴얼 생성').click()
    await expect(page).toHaveURL('/manuals')

    await page.locator('aside').getByText('위젯 대화').click()
    await expect(page).toHaveURL('/widget-conversations')
  })

  test('widget demo page loads independently', async ({ page }) => {
    await page.goto('/widget-demo')
    await expect(page.locator('nav')).toContainText('DocOps AI')
    await expect(page.locator('nav')).toContainText('대시보드')
  })

  test('dashboard shows stat cards', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('main')).toContainText('문서')
    await expect(page.locator('main')).toContainText('대기 중 승인')
    await expect(page.locator('main')).toContainText('오류 제보')
    await expect(page.locator('main')).toContainText('오래된 문서')
  })
})
