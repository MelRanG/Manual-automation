import { test, expect } from '@playwright/test'
import { loginAsDemo } from './helpers/auth'

test.describe('Chat Q&A', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page)
  })

  test('should show empty state and new chat button', async ({ page }) => {
    await page.goto('/chat')
    await expect(page.locator('text=무엇을 도와드릴까요?')).toBeVisible()
    await expect(page.getByRole('button', { name: '새 대화 시작' })).toBeVisible()
  })

  test('can create a new chat session', async ({ page }) => {
    await page.goto('/chat')
    await page.getByRole('button', { name: '새 대화 시작' }).click()

    await expect(page.locator('textarea[placeholder*="문서 내용에 대해 질문해보세요"]')).toBeVisible()
  })
})
