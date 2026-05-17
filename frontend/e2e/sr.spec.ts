import { test, expect } from '@playwright/test'
import { loginAsDemo } from './helpers/auth'

test.describe('Service Requests', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page)
  })

  test('should show SR page', async ({ page }) => {
    await page.goto('/sr')
    await expect(page.locator('h2')).toContainText('서비스 요청')
    await expect(page.getByRole('button', { name: '새 SR' })).toBeVisible()
  })

  test('can open SR creation form', async ({ page }) => {
    await page.goto('/sr')
    await page.getByRole('button', { name: '새 SR' }).click()

    await expect(page.locator('input[placeholder="SR 제목"]')).toBeVisible()
    await expect(page.locator('textarea[placeholder="상세 설명..."]')).toBeVisible()
    await expect(page.getByRole('button', { name: '초안 생성' })).toBeVisible()
  })
})
