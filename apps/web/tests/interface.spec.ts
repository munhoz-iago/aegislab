import { expect, test } from '@playwright/test';

test('sign in flow shows API module states without invented measurements', async ({ page }) => {
  let unexpectedApiCalls = 0;
  const cspViolations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) cspViolations.push(message.text());
  });
  await page.route('**/api/**', (route) => {
    unexpectedApiCalls += 1;
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found' } }) });
  });
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unauthorized' } }) }));
  await page.route('**/api/auth/login', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'user-1', email: 'analista@example.test' } }) }));
  await page.route('**/api/dashboard', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'foundation', note: 'Scanners ainda não integrados.', modules: [{ id: 'demo', label: 'Aplicação de demonstração', status: 'available' }, { id: 'security', label: 'Segurança', status: 'planned' }] }) }));

  const pageResponse = await page.goto('/');
  expect(pageResponse?.url()).toBe('http://127.0.0.1:5174/');
  expect(pageResponse?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(pageResponse?.headers()['x-content-type-options']).toBe('nosniff');
  expect(pageResponse?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.getByRole('heading', { name: 'Experimentos com escopo. Evidências que podem ser repetidas.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const loginScreenshot = await page.screenshot({ path: test.info().outputPath('login.png'), fullPage: true });
  await test.info().attach('login', { body: loginScreenshot, contentType: 'image/png' });
  await page.getByLabel('E-mail').fill('analista@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('strong-password-123');
  await page.getByRole('button', { name: 'Entrar no laboratório' }).click();

  await expect(page.getByRole('heading', { name: 'Painel de engenharia' })).toBeVisible();
  await expect(page.getByText('Scanners ainda não integrados.')).toBeVisible();
  await expect(page.getByText('Implementado')).toBeVisible();
  await expect(page.getByText('Planejado')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('requisições por segundo');
  const dashboardScreenshot = await page.screenshot({ path: test.info().outputPath('dashboard.png'), fullPage: true });
  await test.info().attach('dashboard', { body: dashboardScreenshot, contentType: 'image/png' });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(horizontalOverflow).toBe(false);
  expect(unexpectedApiCalls).toBe(0);
  expect(cspViolations).toEqual([]);
});
