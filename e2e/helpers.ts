import { expect, type Page } from '@playwright/test';

export const AI_BACKEND = 'http://127.0.0.1:8797';
export const NOAI_BACKEND = 'http://127.0.0.1:8798';

export const SHORT_SOURCE =
  'The lighthouse was first lit in 1871. Keepers recorded fog on 212 nights that year. ' +
  'Some visitors claim the lamp could be seen from 60 miles away.';

export const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

export async function openView(
  page: Page,
  name: 'Sources' | 'Review' | 'Report' | 'Settings' | 'About',
): Promise<void> {
  await nav(page).getByRole('link', { name }).click();
  await expect(page.getByRole('link', { name, includeHidden: false })).toHaveAttribute(
    'aria-current',
    'page',
  );
}

/** A clean start: empty storage, app loaded under the Pages prefix. */
export async function freshApp(page: Page): Promise<void> {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'SourceTrace' })).toBeVisible();
}

export async function addSource(
  page: Page,
  title: string,
  text: string,
  extra: { author?: string; date?: string } = {},
): Promise<void> {
  await openView(page, 'Sources');
  await page.getByLabel('Title (required)').fill(title);
  if (extra.author) await page.getByLabel('Author').first().fill(extra.author);
  if (extra.date) await page.getByLabel('Date (YYYY-MM-DD)').fill(extra.date);
  await page.getByLabel('Source text').fill(text);
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByTestId('notice')).toContainText('Added source');
}

/** Selects [start, end) (UTF-16 offsets of the textarea value) and chooses it as the passage. */
export async function chooseRange(page: Page, start: number, end: number): Promise<void> {
  const area = page.getByTestId('source-text');
  await area.evaluate(
    (el, [a, b]) => {
      const t = el as HTMLTextAreaElement;
      t.focus();
      t.setSelectionRange(a as number, b as number);
    },
    [start, end],
  );
  await page.getByRole('button', { name: 'Use selection as passage' }).click();
  await expect(page.getByTestId('pending-passage')).toBeVisible();
}

export function trackLocalRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (r) => {
    if (/127\.0\.0\.1|localhost:(?!4175)/.test(r.url())) hits.push(r.url());
  });
  return hits;
}
