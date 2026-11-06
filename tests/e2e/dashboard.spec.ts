import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';

const apiKey = () =>
  (
    JSON.parse(readFileSync(new URL('./.state/demo.json', import.meta.url), 'utf8')) as {
      apiKey: string;
    }
  ).apiKey;

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('API key').fill(apiKey());
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('unauthenticated visitors are sent to the login page', async ({ page }) => {
  await page.goto('/deposits');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('API key').fill('not-a-key');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'does not look like a Welyvra API key' }),
  ).toBeVisible();
});

test('overview reflects the ingested testnet deposits', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Recent deposits').locator('..')).toContainText('6');
  await expect(page.getByText('Unattributed', { exact: true }).locator('..')).toContainText('1');
  await expect(page.getByText('in sync')).toBeVisible();
});

test('deposits show exact amounts and routing keys for memo, M and W payments', async ({
  page,
}) => {
  await login(page);
  await page.goto('/deposits');
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(6);
  for (const text of [
    '1.0000001',
    '1.5',
    'id:1001',
    'text:INV-42',
    'id:2002',
    'id:3003',
    'Alice Mora',
    'Dave Solís',
  ]) {
    await expect(page.locator('tbody')).toContainText(text);
  }
});

test('an operator resolves the unattributed deposit from its case', async ({ page }) => {
  await login(page);
  await page.goto('/cases?status=open');
  await page.getByRole('link', { name: 'Unattributed deposit' }).click();
  await expect(page.getByRole('heading', { name: 'Attribute to a customer' })).toBeVisible();
  await expect(page.getByText('no routing key')).toBeVisible();

  await page.getByLabel('Customer').selectOption({ label: 'Dave Solís' });
  await page
    .getByLabel('Reason (recorded in the audit log)')
    .fill('customer confirmed the transfer by email');
  await page.getByRole('button', { name: 'Attribute deposit' }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}\?updated=attributed$/);
  await expect(page.getByRole('status')).toContainText('Deposit attributed');
  await expect(page.locator('header').getByText('resolved')).toBeVisible();
  await expect(page.getByText('customer confirmed the transfer by email')).toBeVisible();

  await page.goto('/deposits?status=unattributed');
  await expect(page.getByText('No deposits yet')).toBeVisible();
  await page.goto('/audit');
  await expect(page.locator('tbody')).toContainText('deposit.attribute');
});

test('closed cases offer no further transitions', async ({ page }) => {
  await login(page);
  await page.goto('/cases?status=resolved');
  await page.getByRole('link', { name: 'Unattributed deposit' }).click();
  await expect(page.getByText('This case is closed.')).toBeVisible();
});

test('running reconciliation from the dashboard records a new run', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Run reconciliation' }).click();
  await expect(page.getByRole('status')).toHaveText('Reconciliation completed');
  await page.goto('/reconciliation');
  await expect(page.locator('tbody tr')).toHaveCount(2);
});

test('keyboard users can skip to the main content', async ({ page }) => {
  await login(page);
  await page.goto('/deposits'); // fresh page load: focus starts at the top of the document
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
});
