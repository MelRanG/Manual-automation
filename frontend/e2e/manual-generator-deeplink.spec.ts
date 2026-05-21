import { test, expect } from "@playwright/test"
import { loginAsDemo } from "./helpers/auth"

test.describe("ManualGenerator deep-link", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page)
  })

  test("opens with job selected and draft tab when url has ?job=&tab=draft", async ({ page, request }) => {
    const res = await page.request.get("/api/manual-jobs").catch(() => null)
    test.skip(!res || !res.ok(), "no manual job fixture available")

    const jobs = await res!.json()
    const target = jobs.find((j: { status: string }) => j.status === "completed") ?? jobs[0]
    test.skip(!target, "no manual job to test deeplink against")

    await page.goto(`/manuals?job=${target.id}&tab=draft`)

    await expect(page.getByRole("heading", { level: 3 })).toContainText(target.target_url)
    const draftTab = page.getByRole("button", { name: "AI 초안" })
    await expect(draftTab).toBeVisible()
    await expect(draftTab).toHaveClass(/text-\[#00288e\]/)

    void request
  })
})
