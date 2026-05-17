import { test, expect } from '@playwright/test'
import { loginAsDemo } from './helpers/auth'

test.describe('Error Reports / Feedback', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page)
  })

  test('should show feedback page', async ({ page }) => {
    await page.goto('/feedback')
    await expect(page.locator('h2')).toContainText('오류 제보')
    await expect(page.getByRole('button', { name: '오류 제보' })).toBeVisible()
  })

  test('can open report form', async ({ page }) => {
    await page.goto('/feedback')
    await page.getByRole('button', { name: '오류 제보' }).click()
    await expect(page.locator('textarea[placeholder*="발견한 오류나 문제를 설명"]')).toBeVisible()
    await expect(page.getByRole('button', { name: '제보 제출' })).toBeVisible()
  })
})
