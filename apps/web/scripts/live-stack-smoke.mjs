import { randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';
import { resolveBaseUrl } from './live-smoke-config.mjs';

const baseUrl = resolveBaseUrl(process.env.AEGISLAB_WEB_URL);
const health = await fetch(`${baseUrl}/api/health`, { redirect: 'manual' }).catch(() => null);
if (!health?.ok || (await health.json()).database !== 'connected') {
  throw new Error('Start the local Compose API and PostgreSQL before this test');
}

const email = `browser-${randomBytes(6).toString('hex')}@example.test`;
const password = randomBytes(24).toString('hex');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

await context.route('**/*', (route) => {
  const target = new URL(route.request().url());
  return ['127.0.0.1', 'localhost'].includes(target.hostname) ? route.continue() : route.abort();
});

async function waitForDashboardOrAlert(stage) {
  const winner = await Promise.race([
    page.getByRole('heading', { name: 'Painel de engenharia' }).waitFor({ timeout: 10_000 }).then(() => 'dashboard'),
    page.getByRole('alert').waitFor({ timeout: 10_000 }).then(() => 'alert'),
  ]);
  if (winner === 'alert') throw new Error(`${stage}: ${await page.getByRole('alert').innerText()}`);
}

try {
  await page.goto(baseUrl);
  if (new URL(page.url()).origin !== baseUrl) throw new Error('Dashboard redirected outside the local origin');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await waitForDashboardOrAlert('Registration failed');
  await page.getByText('Engenharia de segurança').waitFor();

  await page.setViewportSize({ width: 320, height: 700 });
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (hasOverflow) throw new Error('The dashboard overflows at 320px');

  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await page.getByRole('heading', { name: 'Entre na sua área de trabalho.' }).waitFor({ timeout: 10_000 });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await waitForDashboardOrAlert('Login failed');

  const sessionCookies = await context.cookies(`${baseUrl}/api/auth/me`);
  if (sessionCookies.length === 0) throw new Error('No session cookie was set before logout');
  const oldCookieHeader = sessionCookies.map(({ name, value }) => `${name}=${value}`).join('; ');
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await page.getByRole('heading', { name: 'Entre na sua área de trabalho.' }).waitFor({ timeout: 10_000 });
  const revoked = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: oldCookieHeader }, redirect: 'manual' });
  if (revoked.status !== 401) throw new Error(`Logout did not revoke the previous session (HTTP ${revoked.status})`);
  process.stdout.write('Live browser flow passed: register, dashboard, 320px layout, logout, login, final logout and revocation.\n');
  process.stdout.write('Each run uses 1 registration and 1 login from local limits of 5 and 10 attempts per 10 minutes.\n');
} finally {
  await browser.close();
}
