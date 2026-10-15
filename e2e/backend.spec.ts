import { expect, test } from '@playwright/test';
import { AI_BACKEND, NOAI_BACKEND, addSource, freshApp, openView } from './helpers';

async function connect(page: import('@playwright/test').Page, url: string): Promise<void> {
  await openView(page, 'Settings');
  await page.getByLabel('Backend address').fill(url);
  await page.getByRole('button', { name: 'Use the backend' }).click();
}

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('connected mode: PDF extraction becomes available, and a malformed PDF is refused clearly', async ({
  page,
}) => {
  await connect(page, AI_BACKEND);
  await expect(page.getByTestId('backend-status')).toContainText('connected');
  await expect(page.getByTestId('mode-chip')).toContainText('Backend connected');

  await openView(page, 'Sources');
  await expect(page.getByRole('button', { name: 'Extract text from a PDF' })).toBeEnabled();
  await page.locator('#pdf-file').setInputFiles('e2e/fixtures/malformed.pdf');
  await expect(page.getByTestId('source-error')).toContainText('not a readable PDF');

  await page.locator('#pdf-file').setInputFiles('e2e/fixtures/synthetic.pdf');
  await expect(page.getByLabel('Source text')).toHaveValue(/The reservoir was completed in 1954/);
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByTestId('notice')).toContainText('Added source s_1');
  await expect(page.getByTestId('source-item')).toContainText('pdf');
});

test('save to the backend, load it back, and a stale save is refused', async ({
  page,
  request,
}) => {
  await connect(page, AI_BACKEND);
  await addSource(page, 'Persisted', 'Text that should persist on the backend.');
  await openView(page, 'Settings');
  await page.getByRole('button', { name: 'Save workspace to backend' }).click();
  await expect(page.getByTestId('notice')).toContainText('revision 1');

  // someone else saves a newer revision
  const current = await request.get(`${AI_BACKEND}/api/workspaces/default`);
  const body = await current.json();
  const bump = await request.put(`${AI_BACKEND}/api/workspaces/default`, {
    data: { baseRevision: body.revision, workspace: body.workspace },
    headers: { origin: 'http://localhost:4175' },
  });
  expect(bump.ok()).toBe(true);

  await page.getByRole('button', { name: 'Save workspace to backend' }).click();
  await expect(page.getByTestId('notice')).toContainText('changed since you loaded it');

  await page.getByRole('button', { name: 'Load workspace from backend' }).click();
  await expect(page.getByTestId('notice')).toContainText('revision 2');
});

test('AI assistant: off until the session opt-in; suggestions are drafts only; bad ones are dropped', async ({
  page,
}) => {
  await connect(page, AI_BACKEND);
  await addSource(
    page,
    'AI source',
    'The canal was dug in 1820. Tolls were abolished later. [[FAKE:INVENT]]',
  );
  await openView(page, 'Review');
  const ask = page.getByRole('button', { name: 'Suggest claims from this source' });
  await expect(ask).toBeDisabled();
  await page.getByLabel(/Allow AI suggestions for this session/).check();
  await expect(ask).toBeEnabled();
  await ask.click();
  const list = page.getByTestId('suggestions');
  await expect(list.locator('li')).toHaveCount(1);
  await expect(list).toContainText('The canal was dug in 1820.');
  await expect(page.getByText(/1 discarded because they did not match the source/)).toBeVisible();
  await list.getByRole('button', { name: 'Add as a draft claim' }).click();
  await expect(page.getByTestId('claim-detail')).toContainText('started from an AI suggestion');
  await expect(page.getByTestId('claim-detail')).toContainText('Draft');
  // it is a draft with one matching passage; nothing was approved
  await expect(page.getByTestId('claim-detail').getByTestId('evidence-item')).toContainText(
    'Matches source',
  );

  // the opt-in is per session: a reload turns it off again
  await page.reload();
  await openView(page, 'Review');
  await expect(
    page.getByRole('button', { name: 'Suggest claims from this source' }),
  ).toBeDisabled();
});

test('AI response that tries to set a status is rejected whole and nothing changes', async ({
  page,
}) => {
  await connect(page, AI_BACKEND);
  await addSource(page, 'Hostile', 'The mill closed in 1901. [[FAKE:APPROVE]]');
  await openView(page, 'Review');
  await page.getByLabel(/Allow AI suggestions for this session/).check();
  await page.getByRole('button', { name: 'Suggest claims from this source' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'schema' })).toBeVisible();
  await expect(page.getByTestId('claim-pick')).toHaveCount(0);
});

test('disabled-provider mode: the backend works, the assistant says it is not configured', async ({
  page,
}) => {
  await connect(page, NOAI_BACKEND);
  await expect(page.getByTestId('backend-status')).toContainText('connected');
  await expect(page.getByTestId('ai-settings-disabled')).toBeVisible();
  await addSource(page, 'No AI', 'Plain manual review still works.');
  await openView(page, 'Review');
  await expect(page.getByTestId('ai-disabled')).toContainText('no AI provider configured');
  await page.getByTestId('new-claim-text').fill('Manual claim');
  await page.getByRole('button', { name: 'Create claim' }).click();
  await expect(page.getByTestId('claim-detail')).toContainText('c_1');
});

test('backend offline: clear message, local-data mode keeps working', async ({ page }) => {
  await connect(page, 'http://127.0.0.1:8899');
  await expect(page.getByTestId('backend-status')).toContainText('unreachable');
  await expect(page.getByRole('alert').first()).toContainText('Local-data mode keeps working');
  await addSource(page, 'Offline ok', 'Still fine without the backend.');
  await openView(page, 'Review');
  await expect(page.getByTestId('source-text')).toHaveValue(/Still fine/);
  await openView(page, 'Settings');
  await expect(page.getByRole('button', { name: 'Save workspace to backend' })).toBeDisabled();
});

test('the backend refuses a snapshot whose approved claim fails the gate', async ({
  page,
  request,
}) => {
  const response = await request.put(`${AI_BACKEND}/api/workspaces/crafted`, {
    headers: { origin: 'http://localhost:4175' },
    data: {
      baseRevision: null,
      workspace: {
        schema: 1,
        name: 'crafted',
        counters: { source: 0, claim: 1, evidence: 0 },
        sources: [],
        claims: [
          {
            id: 'c_1',
            text: 'Approved with nothing behind it',
            kind: 'factual',
            status: 'approved',
            evidence: [],
            reviewNote: '',
            audit: [
              { seq: 1, at: '2026-10-15T12:00:00.000Z', actor: 'user', type: 'created', note: '' },
              {
                seq: 2,
                at: '2026-10-15T12:00:01.000Z',
                actor: 'user',
                type: 'transition',
                note: '',
                from: 'draft',
                to: 'approved',
              },
            ],
            origin: 'manual',
            createdAt: '2026-10-15T12:00:00.000Z',
            updatedAt: '2026-10-15T12:00:01.000Z',
          },
        ],
      },
    },
  });
  expect(response.status()).toBe(422);
  const err = (await response.json()).error;
  expect(err.code).toBe('invalid_workspace');
  expect(err.details.codes).toEqual(['APPROVED_FAILS_GATE', 'AUDIT_TRANSITION_INVALID']);
  expect(page.url()).toContain('/source-trace/');
});
