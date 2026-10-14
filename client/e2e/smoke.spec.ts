import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { expect, test, type Page } from '@playwright/test';

const ALEX = 'alex.morgan@fluxora.test'; // seeded sample admin
const SAM = 'sam.rivera@fluxora.test'; // seeded sample member

/**
 * Stands in for the inbox: stores a sign-in token exactly as the server does (SHA-256 hash,
 * 15-minute expiry) and opens the link that would have been emailed.
 */
async function openEmailedLink(page: Page, email: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await mongoose.connection.collection('magiclinktokens').insertOne({ email, tokenHash, expiresAt: new Date(Date.now() + 15 * 60_000) });
  await page.goto(`/auth/verify?token=${token}`);
}

async function signInAs(page: Page, email: string) {
  await openEmailedLink(page, email);
  // The first dashboard render builds the 3D globe with software WebGL in headless Chromium,
  // which can block the page for several seconds — allow more time for this one step.
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible({ timeout: 25_000 });
}

test.beforeAll(() => mongoose.connect(process.env.E2E_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/fluxora'));
test.afterAll(() => mongoose.disconnect());

test.describe('Fluxora smoke', () => {
  test.beforeEach(({ page }) => {
    page.on('pageerror', (e) => {
      throw new Error(`Uncaught page error: ${e.message}`);
    });
  });

  test('protects routes, signs in and signs out', async ({ page }) => {
    await page.goto('/shipments');
    await expect(page).toHaveURL(/\/login\?next=%2Fshipments/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveCount(0); // Google only: no email provider configured
    await expect(page.getByRole('button', { name: /demo|Alex Morgan/i })).toHaveCount(0); // no demo accounts
    await signInAs(page, ALEX);
    await page.goto('/shipments');
    await expect(page.getByRole('heading', { name: 'Shipments', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    // Session is really gone server-side.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(401);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('compares carriers, creates and books a simulated shipment, advances tracking', async ({ page }) => {
    await signInAs(page, ALEX);
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Compare Carriers' }).click();

    const origin = page.locator('fieldset', { hasText: '01 · Origin' });
    await origin.getByLabel('Country').selectOption('CN');
    await origin.getByLabel('City').fill('Shenzhen');
    const dest = page.locator('fieldset', { hasText: '02 · Destination' });
    await dest.getByLabel('Country').selectOption('US');
    await dest.getByLabel('City').fill('Newark');
    await page.getByLabel('Packages').fill('2');
    await page.getByLabel('Total weight (kg)').fill('30');
    await page.getByLabel('Length (cm)').fill('50');
    await page.getByLabel('Width (cm)').fill('40');
    await page.getByLabel('Height (cm)').fill('40');
    await expect(page.getByText(/Billable\s+32 kg/)).toBeVisible();
    await expect(page.getByText('Enter length, width and height together')).toHaveCount(0);

    await page.getByRole('button', { name: 'Compare offers' }).click();
    await expect(page.getByText('All offers below are simulated demonstration data.')).toBeVisible();
    await expect(page.getByText('Best balanced').first()).toBeVisible();

    // Weight sliders re-rank on the server.
    const rank = page.waitForResponse((r) => r.url().includes('/rank') && r.ok());
    await page.getByLabel('Transit time weight').fill('100');
    await rank;

    await page.getByRole('button', { name: 'Create shipment' }).first().click();
    await expect(page).toHaveURL(/\/shipments\/[a-f0-9]{24}/);
    await expect(page.getByText('Quoted', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Book shipment' }).click();
    await expect(page.getByText(/Nothing is booked with/)).toBeVisible();
    await page.getByRole('button', { name: 'Create simulated booking' }).click();
    await expect(page.getByText('Booked', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Simulate next event' }).click();
    await expect(page.getByText('Picked up', { exact: true }).first()).toBeVisible();
    await page.getByRole('tab', { name: /Tracking timeline/ }).click();
    await expect(page.getByText('Shipment picked up from shipper')).toBeVisible();
    await expect(page.getByText('Simulated', { exact: true }).first()).toBeVisible();
  });

  test('runs the purchase-order workflow into a linked shipment', async ({ page }) => {
    await signInAs(page, ALEX);
    await page.goto('/purchase-orders/new');
    await page.getByLabel('Supplier').selectOption({ index: 1 });
    await page.getByLabel('City').fill('Newark');
    await page.getByLabel('Country').selectOption('US');
    await page.getByLabel('Description').fill('E2E widget');
    await page.getByLabel('Qty').fill('10');
    await page.getByLabel(/Unit price/).fill('12.50');
    await expect(page.getByText('$125.00').first()).toBeVisible();
    await page.getByRole('button', { name: 'Create draft' }).click();

    await expect(page).toHaveURL(/\/purchase-orders\/[a-f0-9]{24}$/);
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('button', { name: 'Approve order' }).click();
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Mark ready to ship' }).click();
    await page.getByRole('button', { name: 'Mark ready', exact: true }).click();
    await expect(page.getByText('Ready to ship', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Create shipment' }).first().click();
    await page.getByLabel('Actual total weight (kg)').fill('25');
    await page.getByRole('dialog').getByRole('button', { name: 'Create shipment' }).click();
    await expect(page).toHaveURL(/\/shipments\/[a-f0-9]{24}\?tab=offers/);
    await expect(page.getByText(/PO-\d{4}-\d{5}/).first()).toBeVisible();
  });

  test('members cannot approve purchase orders', async ({ page }) => {
    await signInAs(page, SAM);
    await page.goto('/purchase-orders?status=DRAFT');
    await page.locator('tbody tr a').first().click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await expect(page.getByText('Waiting for approval by an organization admin.')).toBeVisible();
  });

  test('switches between light and dark themes', async ({ page }) => {
    await signInAs(page, ALEX);
    await page.getByRole('button', { name: 'Change theme' }).click();
    await page.getByRole('menuitem', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Change theme' }).click();
    await page.getByRole('menuitem', { name: 'Light' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});
