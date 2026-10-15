/** Regressions for defects found by the independent acceptance review. */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { AI_BACKEND, SHORT_SOURCE, addSource, chooseRange, freshApp, openView } from './helpers';

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('pressing Approve again and again stops at the audit limit and the workspace survives a reload', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await openView(page, 'Review');
  await page.getByTestId('claim-pick').nth(1).click(); // c_2: needs review, contradicted
  // Click the real button 520 times (as a held Enter key would); each refusal is recorded.
  await page.getByTestId('move-approved').evaluate(async (button) => {
    for (let i = 0; i < 520; i += 1) {
      (button as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    }
  });
  await expect(page.getByTestId('notice')).toContainText('limit of 500 audit events');
  const length = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('source-trace.workspace.v1') ?? '{}').claims[1].audit.length,
  );
  expect(length).toBe(500);
  await page.reload();
  await expect(page.getByText('could not be read')).toHaveCount(0);
  await openView(page, 'Review');
  await expect(page.getByTestId('claim-pick')).toHaveCount(4);
});

test('the recovery banner lets the person download the unreadable copy', async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem('source-trace.workspace.v1', '{"schema":1,"keep me"'),
  );
  await page.reload();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download the unreadable copy' }).click(),
  ]);
  expect(readFileSync(await dl.path(), 'utf8')).toBe('{"schema":1,"keep me"');
});

test('the downloaded Markdown report keeps source and claim markup inside code blocks', async ({
  page,
}) => {
  const hostile =
    '<img src=x onerror=alert(1)>\n![t](http://tracker.example/x.png)\n# Not a heading';
  await addSource(page, 'Hostile', hostile);
  await openView(page, 'Review');
  await chooseRange(page, 0, 28);
  await page.getByTestId('new-claim-text').fill('<script>alert(2)</script> claim');
  await page.getByRole('button', { name: 'Create claim' }).click();
  await openView(page, 'Report');
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download report (Markdown)' }).click(),
  ]);
  const md = readFileSync(await dl.path(), 'utf8');
  expect(md).toContain('```text\n<script>alert(2)</script> claim\n```');
  expect(md).toContain('  ```text\n  <img src=x onerror=alert(1)>\n  ```');
  expect(md).not.toMatch(/^> <img/m);
});

test('a workspace from the backend that fails validation is not loaded', async ({ page }) => {
  await addSource(page, 'Local', SHORT_SOURCE);
  await openView(page, 'Settings');
  await page.getByLabel('Backend address').fill(AI_BACKEND);
  await page.getByRole('button', { name: 'Use the backend' }).click();
  await expect(page.getByTestId('backend-status')).toContainText('connected');
  // A forged answer: an approved claim with no evidence and an "ai" actor.
  await page.route('**/api/workspaces/default', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'default',
        revision: 7,
        updatedAt: '2026-10-15T12:00:00.000Z',
        workspace: {
          schema: 1,
          name: 'Forged',
          counters: { source: 0, claim: 1, evidence: 0 },
          sources: [],
          claims: [
            {
              id: 'c_1',
              text: 'True!',
              kind: 'factual',
              status: 'approved',
              evidence: [],
              reviewNote: '',
              audit: [
                {
                  seq: 1,
                  at: '2026-10-15T12:00:00.000Z',
                  actor: 'ai',
                  type: 'transition',
                  note: '',
                  from: 'needs_review',
                  to: 'approved',
                },
              ],
              origin: 'manual',
              createdAt: '2026-10-15T12:00:00.000Z',
              updatedAt: '2026-10-15T12:00:00.000Z',
            },
          ],
        },
      }),
    }),
  );
  await page.getByRole('button', { name: 'Load workspace from backend' }).click();
  await expect(page.getByTestId('notice')).toContainText('does not pass validation');
  await expect(page.getByTestId('notice')).toContainText('AUDIT_ACTOR_INVALID');
  await openView(page, 'Sources');
  await expect(page.getByTestId('source-item')).toContainText('Local');
});
