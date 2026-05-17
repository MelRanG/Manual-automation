import { Page } from '@playwright/test'

export async function loginAsDemo(page: Page) {
  const res = await page.request.post('http://localhost:8000/api/auth/login', {
    data: { email: 'admin@docops.ai' },
  })
  const user = await res.json()

  await page.goto('/')
  await page.evaluate((u: object) => {
    localStorage.setItem('docops_user', JSON.stringify(u))
  }, user)
}
