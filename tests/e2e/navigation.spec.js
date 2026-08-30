const { test, expect } = require('@playwright/test');

test.describe('Public Navigation E2E', () => {

  test('should load the main page successfully', async ({ page }) => {
    await page.goto('/index.html');
    
    // Make sure we have the landing page
    await expect(page).toHaveTitle(/.+/);
    
    // Check if the logo or welcome text is visible
    const loginButton = page.locator('a[href="/login.html"], button:has-text("تسجيل الدخول")').first();
    if (await loginButton.count() > 0) {
      await expect(loginButton).toBeVisible();
    }
  });

  test('should have working 404 page for unknown routes', async ({ page }) => {
    // Navigating to a non-existent API or HTML page might redirect to 404.html
    // Assuming backend serves 404 for unknown HTML
    const res = await page.goto('/this-page-does-not-exist.html');
    
    // The response status might be 404, or the title might contain 404
    expect(res.status() === 404 || (await page.title()).includes('404')).toBeTruthy();
  });
});
