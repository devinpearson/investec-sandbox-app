import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { goTo, openForm } from './dashboard';
import { API_URL } from './servers';

const MAIN = '10012420003';

test.beforeEach(async ({ request }) => {
  expect((await request.get(`${API_URL}/restore`)).ok()).toBe(true);
});

test('the dashboard keeps working with authentication on', async ({ page, request }) => {
  const { data: settings } = await (await request.get(`${API_URL}/envs`)).json();
  await request.post(`${API_URL}/envs`, { data: { ...settings, auth: true } });
  try {
    // Without a token the API now refuses...
    expect((await request.get(`${API_URL}/za/pb/v1/accounts`)).status()).toBe(401);
    // ...but the dashboard gets its own and shows the accounts.
    await page.goto('/accounts');
    await expect(page.getByRole('region', { name: 'Accounts' }).getByRole('row', { name: new RegExp(MAIN) })).toBeVisible();
    await goTo(page, 'Cards');
    await expect(page.getByRole('region', { name: 'Cards' }).getByRole('row', { name: /402167XXXXXX1111/ })).toBeVisible();
  } finally {
    await request.post(`${API_URL}/envs`, { data: { ...settings, auth: false } });
  }
});

test('the swipe form offers the reference-rate currencies and says where the rate is from', async ({ page }) => {
  await page.goto('/cards');
  const cards = page.getByRole('region', { name: 'Cards' });
  await openForm(cards, 'Swipe a card');
  const currency = cards.getByLabel('Currency');
  // Rand, and the currencies Frankfurter publishes (not ones it doesn't, like MUR).
  await expect(currency.locator('option', { hasText: 'USD' })).toHaveCount(1);
  await expect(currency.locator('option', { hasText: 'THB' })).toHaveCount(1);
  await expect(currency.locator('option', { hasText: 'MUR' })).toHaveCount(0);

  await currency.selectOption('USD');
  await cards.getByLabel('Amount (USD)').fill('10');
  await expect(cards.getByText(/1 USD = R/)).toBeVisible();
  await expect(cards.getByRole('link', { name: 'ECB reference rate' })).toHaveAttribute('href', 'https://frankfurter.dev');
});

test('export the sandbox, change it, and import the file back', async ({ page }) => {
  await page.goto('/accounts');
  const accounts = page.getByRole('region', { name: 'Accounts' });
  await expect(accounts.getByRole('row', { name: new RegExp(MAIN) })).toBeVisible();

  await goTo(page, 'Data & scenarios');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^sandbox-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();
  const exported = JSON.parse(await readFile(file, 'utf-8'));
  expect(exported.version).toBe(1);

  // Clear everything, then import the file.
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Clear data' }).click();
  await expect(page.getByText('Sandbox data cleared')).toBeVisible();
  await goTo(page, 'Accounts');
  await expect(accounts.getByText(/No accounts yet/)).toBeVisible();

  await goTo(page, 'Data & scenarios');
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Import a sandbox file').setInputFiles(file);
  await expect(page.getByText(/^Imported .+: 5 accounts, 13 transactions, 1 cards$/)).toBeVisible();
  await goTo(page, 'Accounts');
  await expect(accounts.getByRole('row', { name: new RegExp(MAIN) })).toBeVisible();
});
