import { test, expect } from '@playwright/test'
import { loginAsDemo } from './helpers/auth'

test.describe('Documents', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page)
  })

  test('should show documents page with create button', async ({ page }) => {
    await page.goto('/documents')
    await expect(page.locator('h2')).toContainText('문서 관리')
    await expect(page.locator('text=새 문서')).toBeVisible()
    await expect(page.locator('text=업로드')).toBeVisible()
  })

  test('can create a document', async ({ page }) => {
    const docName = `E2E Doc ${Date.now()}`
    await page.goto('/documents')
    await page.click('text=새 문서')

    await page.fill('input[placeholder="문서 제목"]', docName)
    await page.fill('input[placeholder="설명 (선택)"]', 'Created by Playwright')
    await page.fill('textarea[placeholder="문서 내용..."]', 'This is automated test content for verification.')

    await page.click('text=문서 생성')

    await expect(page.locator(`text=${docName}`).first()).toBeVisible({ timeout: 5000 })
  })

  test('can search documents', async ({ page }) => {
    await page.goto('/documents')
    await page.fill('input[placeholder="문서명 검색..."]', 'E2E Test')
    await expect(page.locator('input[placeholder="문서명 검색..."]')).toHaveValue('E2E Test')
  })

  test('can click into document detail', async ({ page }) => {
    const docName = `Detail View ${Date.now()}`
    await page.goto('/documents')
    await page.click('text=새 문서')
    await page.fill('input[placeholder="문서 제목"]', docName)
    await page.fill('textarea[placeholder="문서 내용..."]', 'Content for detail view.')
    await page.click('text=문서 생성')

    await expect(page.locator(`text=${docName}`).first()).toBeVisible({ timeout: 5000 })
    await page.locator(`text=${docName}`).first().click()

    await expect(page).toHaveURL(/\/documents\//, { timeout: 5000 })
    await expect(page.locator('main h1')).toContainText(docName, { timeout: 5000 })
    await expect(page.locator('main').getByText('신뢰도 점수')).toBeVisible()
    await expect(page.locator('main').getByText('버전 히스토리')).toBeVisible()
  })
})
