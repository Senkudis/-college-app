const { test, expect } = require('@playwright/test');
const hasE2EDatabase = Boolean(process.env.E2E_MONGO_URI);

test.describe('Login & Navigation E2E', () => {

  test('should load the login page successfully', async ({ page }) => {
    await page.goto('/login.html');
    
    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/.+/);

    // Expect the login form to be visible
    const loginForm = page.locator('form');
    await expect(loginForm).toBeVisible();

    // Check for username and password inputs
    const usernameInput = page.locator('input[type="email"], input[type="text"]').first();
    const passwordInput = page.locator('input[type="password"]');
    
    await expect(usernameInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    test.skip(!hasE2EDatabase, 'Set E2E_MONGO_URI to run database-dependent login checks');
    await page.goto('/login.html');

    // Fill the login form
    await page.fill('input[type="email"], input[type="text"]', 'invalid_user_e2e@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');

    // Submit the form
    await page.click('button[type="submit"]');

    // Wait for the toast or error message to appear
    const toast = page.locator('.toast.toast-error, .toast-body');
    await expect(toast).toBeVisible({ timeout: 5000 });
  });
});
