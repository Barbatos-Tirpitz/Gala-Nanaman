import { expect, test } from '@playwright/test';

test('production shell reloads offline and precaches only static same-origin assets', async ({ page, context }) => {
  await page.goto('/');
  const heading = await page.getByRole('heading', { level: 1 }).first().textContent();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const cachedUrls = await page.evaluate(async () => {
    const names = await caches.keys();
    return (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)))).flat();
  });
  expect(cachedUrls.length).toBeGreaterThan(0);
  expect(cachedUrls.every((value) => {
    const url = new URL(value);
    return url.origin === 'http://127.0.0.1:4174' && !url.pathname.includes('/__/') && !url.pathname.includes('/api/');
  })).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(heading!);
});