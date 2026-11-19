import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const trip = {
  id: 'travel', name: "O'Brien 東京", destination: 'Tokyo', startDate: '2028-02-28', endDate: '2028-03-02',
  timeZone: 'Asia/Tokyo', currencyCode: 'JPY', budgetMinor: 10000, expenses: [], completedDayDates: ['2028-02-28'],
  activities: [{ id: 'walk', title: '<script>window.injected=true</script>', date: '2028-02-28', startTime: '09:00', endTime: '10:00', category: 'Explore', notes: 'Recorded memory', photos: [{ id: 'missing', name: 'travel.jpg', mimeType: 'image/jpeg', size: 100 }, { id: 'missing-two', name: 'second.jpg', mimeType: 'image/jpeg', size: 100 }] }],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((data) => {
    if (!localStorage.getItem('gala-nanaman:prototype-trips:v1')) localStorage.setItem('gala-nanaman:prototype-trips:v1', JSON.stringify([data]));
  }, trip);
});

test('mobile next-day planning preserves custom times and memory content is inert', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await page.locator('.account-email').evaluate((element) => { element.textContent = 'a-very-long-email-address-for-testing@example.com'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const brand = await page.locator('.brand').boundingBox();
  const actions = await page.locator('.topbar-actions').boundingBox();
  expect(brand!.x + brand!.width).toBeLessThanOrEqual(actions!.x + 1);
  await page.getByRole('button', { name: 'Open itinerary' }).click();
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  await page.locator('input[name="title"]').fill('Lunch');
  await page.locator('input[name="date"]').fill('2028-02-28');
  await page.locator('input[name="startTime"]').fill('12:15');
  await page.locator('input[name="endTime"]').fill('13:30');
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.locator('input[name="date"]')).toHaveValue('2028-02-29');
  await expect(page.locator('input[name="startTime"]')).toHaveValue('12:15');
  await expect(page.locator('input[name="endTime"]')).toHaveValue('13:30');
  await page.getByRole('button', { name: 'Save activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lunch' })).toBeVisible();
  await page.getByRole('button', { name: 'Memories', exact: true }).click();
  await expect(page.getByRole('heading', { name: trip.activities[0].title, exact: true })).toBeVisible();
  await expect(page.getByText('travel.jpg: unavailable on this device.')).toBeVisible();
  await page.getByRole('button', { name: 'Next activity photos', exact: true }).click();
  await expect(page.getByText('second.jpg: unavailable on this device.')).toBeVisible();
  expect(await page.evaluate(() => 'injected' in window)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/memories-mobile.png', fullPage: true });
});

test('desktop validates fields and disables mutations after network loss', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add trip', exact: true }).click();
  await page.locator('input[name="name"]').fill('   ');
  await page.locator('input[name="destination"]').fill('Tokyo');
  await page.locator('input[name="startDate"]').fill('2028-02-28');
  await page.locator('input[name="endDate"]').fill('2028-03-02');
  await page.getByRole('button', { name: 'Save trip', exact: true }).click();
  await expect(page.locator('input[name="name"]')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Add trip', exact: true })).toBeDisabled();
  await expect(page.getByText('Offline. Read-only.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Memories', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Memories', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/memories-desktop.png', fullPage: true });
});

test('an offline transition preserves an open activity draft', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open itinerary' }).click();
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  await page.locator('input[name="title"]').fill('Keep this draft');
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Save activity', exact: true })).toBeDisabled();
  await expect(page.locator('input[name="title"]')).toHaveValue('Keep this draft');
});

test('failed expense persistence keeps its draft and shows an actionable error', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open itinerary' }).click();
  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  await page.locator('input[name="title"]').fill('Dinner');
  await page.getByPlaceholder('0', { exact: true }).fill('100');
  await page.getByPlaceholder("Person's name").first().fill('Ari');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'gala-nanaman:prototype-trips:v1') throw new DOMException('Full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.locator('input[name="title"]')).toHaveValue('Dinner');
  await expect(page.getByText('Expense could not be saved. Your draft is still here to retry.')).toBeVisible();
});

test('JPEG compression is local, stores actual metadata, and quota failures are surfaced', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules for this browser-only integration test.
    const { saveLocalPhoto, loadLocalPhoto } = await import('/src/localPhotos.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 4000;
    canvas.height = 1000;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#b94f38';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const original = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 1));
    const reference = await saveLocalPhoto(new File([original], 'memory.jpg', { type: 'image/jpeg' }));
    const stored = await loadLocalPhoto(reference.id);
    const decoded = await createImageBitmap(stored!);
    const width = decoded.width;
    decoded.close();
    Object.defineProperty(navigator.storage, 'estimate', { configurable: true, value: async () => ({ usage: 1, quota: 1 }) });
    let quotaError = false;
    try { await saveLocalPhoto(new File([original], 'full.jpg', { type: 'image/jpeg' })); }
    catch { quotaError = true; }
    return { type: reference.mimeType, sizeMatches: reference.size === stored!.size, smaller: reference.size < original.size, width, quotaError };
  });
  expect(result).toEqual({ type: 'image/webp', sizeMatches: true, smaller: true, width: 2560, quotaError: true });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test(`real image uploads persist and render in Memories at ${viewport.width}px`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const uploads: string[] = [];
    page.on('request', (request) => { if (['POST', 'PUT', 'PATCH'].includes(request.method())) uploads.push(request.url()); });
    const png = await readFile('docs/images/trips.png');
    const outfit = await readFile('docs/images/expenses.png');
    const jpegBase64 = await page.evaluate(async (data) => {
      const source = new Image();
      source.src = `data:image/png;base64,${data}`;
      await source.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 3200;
      canvas.height = Math.round(source.naturalHeight * canvas.width / source.naturalWidth);
      canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
    }, png.toString('base64'));
    const jpeg = Buffer.from(jpegBase64, 'base64');
    await page.getByRole('button', { name: 'Open itinerary' }).click();
    await page.getByRole('button', { name: `Edit ${trip.activities[0].title}`, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Remove travel.jpg', exact: true }).click();
    await dialog.getByRole('button', { name: 'Remove second.jpg', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'Outfit of the day' }).check();
    await dialog.locator('input[type="file"]').first().setInputFiles({ name: 'outfit.png', mimeType: 'image/png', buffer: outfit });
    await dialog.locator('input[type="file"]').last().setInputFiles([
      { name: 'memory.png', mimeType: 'image/png', buffer: png },
      { name: 'memory.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    ]);
    await expect(dialog.locator('img')).toHaveCount(3);
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Memories', exact: true }).click();
    const memories = page.locator('.memories-wrap');
    const gallery = memories.getByRole('region', { name: 'Activity photos', exact: true });
    const outfitGallery = memories.getByRole('region', { name: 'Outfit photo', exact: true });
    await expect(gallery.getByAltText('memory.png')).toBeVisible();
    await expect(outfitGallery.getByAltText('outfit.png')).toBeVisible();
    await expect.poll(() => gallery.getByAltText('memory.png').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await gallery.getByRole('button', { name: 'Next activity photos', exact: true }).click();
    const compressed = gallery.locator('figure:not([hidden]) img');
    await expect(compressed).toHaveAttribute('alt', 'memory.webp');
    await expect.poll(() => compressed.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await context.setOffline(true);
    await gallery.getByRole('button', { name: 'Previous activity photos', exact: true }).click();
    await expect(gallery.getByAltText('memory.png')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(uploads).toEqual([]);
    await page.screenshot({ path: `test-results/images-${viewport.width}.png`, fullPage: true });
  });
}

test('image inputs reject over 30 MiB and more than five photos without losing the draft', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open itinerary' }).click();
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name="title"]').fill('Keep my images');
  const png = await readFile('docs/images/trips.png');
  const oversized = Buffer.concat([png, Buffer.alloc(30 * 1024 * 1024 + 1 - png.length)]);
  await dialog.locator('input[type="file"]').last().setInputFiles({ name: 'too-large.png', mimeType: 'image/png', buffer: oversized });
  await expect(dialog.getByText('Choose images no larger than 30 MiB each.')).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Outfit of the day' }).check();
  await dialog.locator('input[type="file"]').first().setInputFiles({ name: 'too-large-outfit.png', mimeType: 'image/png', buffer: oversized });
  await expect(dialog.getByText('Choose images no larger than 30 MiB each.')).toBeVisible();
  await dialog.locator('input[type="file"]').last().setInputFiles(Array.from({ length: 6 }, (_, index) => ({ name: `photo-${index}.png`, mimeType: 'image/png', buffer: png })));
  await expect(dialog.getByText('You can attach up to five photos to an activity.')).toBeVisible();
  await expect(dialog.locator('input[name="title"]')).toHaveValue('Keep my images');
  await expect(dialog.locator('img')).toHaveCount(0);
});