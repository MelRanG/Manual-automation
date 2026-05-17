import { test, expect } from '@playwright/test'
import { loginAsDemo } from './helpers/auth'

test.describe('Manual Generator - 사용자 매뉴얼 생성', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page)
  })

  test('페이지 네비게이션: 사이드바에서 매뉴얼 생성 접근 가능', async ({ page }) => {
    await page.goto('/')
    await page.locator('aside').getByText('매뉴얼 생성').click()
    await expect(page).toHaveURL('/manuals')
    await expect(page.locator('main h2')).toContainText('사용자 매뉴얼 생성')
  })

  test('빈 상태에서 안내 메시지 표시', async ({ page }) => {
    await page.goto('/manuals')
    await expect(page.locator('main')).toContainText('아직 생성된 매뉴얼이 없습니다')
    await expect(page.locator('main')).toContainText('새 매뉴얼 생성')
  })

  test('새 매뉴얼 생성 폼 열기/닫기', async ({ page }) => {
    await page.goto('/manuals')

    await page.getByRole('button', { name: '새 매뉴얼 생성' }).click()
    await expect(page.getByPlaceholder('https://example.com', { exact: true })).toBeVisible()
    await expect(page.getByText('로그인 URL (선택)')).toBeVisible()
    await expect(page.getByText('로그인 ID (선택)')).toBeVisible()
    await expect(page.getByText('로그인 PW (선택)')).toBeVisible()
    await expect(page.getByText('시나리오 단계 (선택)')).toBeVisible()

    await page.getByRole('button', { name: '취소' }).click()
    await expect(page.getByPlaceholder('https://example.com', { exact: true })).not.toBeVisible()
  })

  test('시나리오 단계 추가/삭제', async ({ page }) => {
    await page.goto('/manuals')
    await page.getByRole('button', { name: '새 매뉴얼 생성' }).click()

    await page.getByPlaceholder('예: 마이페이지 클릭').fill('로그인 페이지 이동')
    await page.getByRole('button', { name: '추가' }).click()
    await expect(page.locator('main')).toContainText('로그인 페이지 이동')

    await page.getByPlaceholder('예: 마이페이지 클릭').fill('회원가입 버튼 클릭')
    await page.getByRole('button', { name: '추가' }).click()
    await expect(page.locator('main')).toContainText('회원가입 버튼 클릭')

    const steps = page.locator('main .bg-muted')
    await expect(steps).toHaveCount(2)
    await steps.first().locator('button').click()
    await expect(steps).toHaveCount(1)
    await expect(page.locator('main')).not.toContainText('로그인 페이지 이동')
  })

  test('URL 미입력 시 제출 버튼 비활성화', async ({ page }) => {
    await page.goto('/manuals')
    await page.getByRole('button', { name: '새 매뉴얼 생성' }).click()

    const submitBtn = page.getByRole('button', { name: '매뉴얼 생성 시작' })
    await expect(submitBtn).toBeDisabled()

    await page.getByPlaceholder('https://example.com', { exact: true }).fill('https://www.asiana.com')
    await expect(submitBtn).toBeEnabled()
  })

  test('매뉴얼 생성 작업 제출 성공', async ({ page }) => {
    await page.goto('/manuals')
    await page.getByRole('button', { name: '새 매뉴얼 생성' }).click()

    await page.getByPlaceholder('https://example.com', { exact: true }).fill('https://www.asiana.com')
    await page.getByRole('button', { name: '매뉴얼 생성 시작' }).click()

    await expect(page.getByPlaceholder('https://example.com', { exact: true })).not.toBeVisible()
    await expect(page.locator('main')).toContainText('https://www.asiana.com')
  })
})
