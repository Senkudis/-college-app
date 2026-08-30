const { test, expect } = require('@playwright/test');

const accounts = {
  student: { email: process.env.E2E_STUDENT_EMAIL, password: process.env.E2E_STUDENT_PASSWORD },
  doctor: { email: process.env.E2E_DOCTOR_EMAIL, password: process.env.E2E_DOCTOR_PASSWORD },
  leader: { email: process.env.E2E_LEADER_EMAIL, password: process.env.E2E_LEADER_PASSWORD }
};

async function login(page, account) {
  await page.goto('/login.html');
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.locator('button[type="submit"], #loginBtn').first().click();
  await page.waitForURL(/(dashboard|batch-selector|force-change-password)\.html/, { timeout: 15000 });
}

for (const [role, account] of Object.entries(accounts)) {
  test(`${role} can sign in and reaches an allowed landing page`, async ({ page }) => {
    test.skip(!account.email || !account.password, `Set E2E_${role.toUpperCase()}_EMAIL and E2E_${role.toUpperCase()}_PASSWORD to run this journey`);
    await login(page, account);
    expect(page.url()).toMatch(/(dashboard|batch-selector|force-change-password)\.html/);
    await expect(page.locator('body')).toBeVisible();
  });
}

test('connection failure exposes an accessible retry action', async ({ page }) => {
  await page.goto('/login.html');
  await page.evaluate(() => {
    window.CBS.showConnectionError({ retry: async () => {} });
  });
  await expect(page.locator('#cbs-connection-error')).toBeVisible();
  await expect(page.locator('#cbs-connection-error button[aria-label="إعادة المحاولة"]')).toBeVisible();
});
