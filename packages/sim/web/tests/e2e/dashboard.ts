import type { Locator, Page } from '@playwright/test';

// The dashboard's pages (components/dashboard/sections.ts), and the forms
// that are folded until opened.

export type Section =
  | 'Accounts'
  | 'Transactions'
  | 'Cards'
  | 'Beneficiaries'
  | 'Clock & schedules'
  | 'Faults'
  | 'Data & scenarios'
  | 'Settings'
  | 'Request log';

// Go to a page with the dashboard's navigation (a client-side navigation,
// so the live connection and the request log carry over).
export async function goTo(page: Page, section: Section) {
  const link = page.getByRole('navigation', { name: 'Dashboard' }).getByRole('link', { name: section, exact: true });
  const href = await link.getAttribute('href');
  await link.click();
  await page.waitForURL(url => url.pathname === href);
}

// Open a folded form (Disclosure) in a panel; leaves an open one open.
export async function openForm(panel: Locator, title: string) {
  const summary = panel.locator('summary', { hasText: title });
  const open = await summary.evaluate(s => (s.parentElement as HTMLDetailsElement).open);
  if (!open) await summary.click();
}
