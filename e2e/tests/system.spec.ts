import { test, expect } from '../fixtures'

test.describe('系统状态', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByRole('button', { name: /settings/i }).click()
    await page.getByRole('button', { name: /system/i }).click()
    await page.waitForTimeout(500)
  })

  test('系统状态页面加载', async ({ page }) => {
    // 等待系统状态信息加载
    await expect(page.getByTestId('system-status')).toBeVisible({ timeout: 10_000 })
  })

  test('显示状态卡片', async ({ page }) => {
    // 至少有一个状态卡片
    await expect(page.getByTestId('status-card').first()).toBeVisible({ timeout: 10_000 })
  })
})
