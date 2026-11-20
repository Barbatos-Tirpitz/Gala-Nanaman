import { expect, test } from '@playwright/test';

const uid = 'map-browser-user';
const trip = {
  id: 'map-trip', name: 'Tokyo weekend', destination: 'Tokyo', startDate: '2028-02-28', endDate: '2028-03-01',
  timeZone: 'Asia/Tokyo', currencyCode: 'JPY', budgetMinor: 10000, expenses: [], completedDayDates: ['2028-02-28'],
  activities: [
    { id: 'station', title: 'Station', date: '2028-02-28', startTime: '09:00', endTime: '10:00', category: 'Explore', notes: '', location: { label: 'Tokyo station', latitude: 35.68, longitude: 139.76 } },
    { id: 'park', title: 'Park', date: '2028-02-28', startTime: '11:00', endTime: '12:00', category: 'Explore', notes: '', location: { label: 'Tokyo park', latitude: 35.69, longitude: 139.77 } },
  ],
};

test.beforeEach(async ({ context }) => {
  await context.route('**/src/firebase.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `export const firebaseAuth = { currentUser: { uid: '${uid}' } }; export const firestore = null; export const firebaseConfigured = false; export const firebaseApp = null;` }));
  await context.route('**/src/auth/AuthContext.tsx*', (route) => route.fulfill({ contentType: 'application/javascript', body: `const auth = { user: { uid: '${uid}', email: 'map-test@example.com' }, configured: false, loading: false, error: '', signIn: async () => {}, signOut: async () => {} }; export function useAuth() { return auth; } export function AuthProvider({children}) { return children; }` }));
  await context.addInitScript(({ trip, uid }) => {
    if (!localStorage.getItem('gala-nanaman:prototype-trips:v1')) localStorage.setItem('gala-nanaman:prototype-trips:v1', JSON.stringify([trip]));
    if (!localStorage.getItem(`gala-nanaman:offline-consent:v1:${uid}`)) localStorage.setItem(`gala-nanaman:offline-consent:v1:${uid}`, 'yes');
  }, { trip, uid });
  await context.route('https://commons.wikimedia.org/**', (route) => route.fulfill({ json: { query: { pages: {} } } }));
  await context.route('https://router.project-osrm.org/**', (route) => route.fulfill({ json: { code: 'Ok', routes: [{ geometry: { coordinates: [[139.76, 35.68], [139.77, 35.69]] }, distance: 2100, duration: 540 }] } }));
});

test('expanded consent enables persistent lookups; hits save requests and clear removes them', async ({ page, context }) => {
  let requests = 0;
  await context.route('https://photon.komoot.io/**', (route) => {
    requests++;
    return route.fulfill({ headers: { 'cache-control': 'max-age=3600' }, json: { features: [{ geometry: { coordinates: [139.76, 35.68] }, properties: { name: 'Tokyo', country: 'Japan' } }] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const consent = page.getByRole('checkbox', { name: 'Keep map lookups on this device' });
  await expect(consent).not.toBeChecked();
  page.once('dialog', (dialog) => dialog.accept());
  await consent.check();
  await expect(consent).toBeChecked();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const search = async () => {
    await page.getByRole('button', { name: 'Add activity', exact: true }).click();
    await page.getByPlaceholder('Search a place or address').fill('Tokyo station');
    await expect(page.getByRole('option', { name: 'Tokyo, Japan', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  };
  await page.getByRole('button', { name: 'Open itinerary' }).click();
  await search();
  expect(requests).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Open itinerary' }).click();
  await search();
  expect(requests).toBe(1);
  const counts = await page.evaluate((uid) => JSON.parse(localStorage.getItem(`gala-nanaman:usage:v1:${uid}`)!).counts, uid);
  expect(counts.placeSearch).toBe(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/^1 saved lookups/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear cached lookups', exact: true }).click();
  await expect(page.getByText(/^0 saved lookups/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await search();
  expect(requests).toBe(2);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await consent.uncheck();
  await expect(page.getByText(/^0 saved lookups/)).toBeVisible();
});

test('Leaflet uses canonical fixture tiles and Google actions are safe on mobile and desktop', async ({ page, context }) => {
  let googleRequests = 0;
  await context.route('https://www.google.com/**', (route) => { googleRequests++; return route.fulfill({ contentType: 'text/html', body: '<title>External map fixture</title>' }); });
  await page.goto('/');
  const tile = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const drawing = canvas.getContext('2d')!;
    drawing.fillStyle = '#e2eee3'; drawing.fillRect(0, 0, 256, 256);
    drawing.strokeStyle = '#ffffff'; drawing.lineWidth = 12;
    drawing.beginPath(); drawing.moveTo(0, 60); drawing.lineTo(256, 180); drawing.moveTo(130, 0); drawing.lineTo(80, 256); drawing.stroke();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await context.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'image/png', headers: { 'cache-control': 'max-age=604800' }, body: Buffer.from(tile, 'base64') }));
  await page.getByRole('button', { name: 'Open itinerary' }).click();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2);
  await expect(page.getByText('2.1 km · 9 min driving', { exact: true })).toBeVisible();
  expect(googleRequests).toBe(0);
  const details = page.getByRole('complementary', { name: 'Place details and photos' });
  const placeLink = details.getByRole('link', { name: 'Open Tokyo station in Google Maps (opens externally)', exact: true });
  await expect(placeLink).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=35.68%2C139.76');
  await expect(placeLink).toHaveAttribute('rel', 'noopener noreferrer');
  const popupPromise = page.waitForEvent('popup');
  await placeLink.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL('https://www.google.com/maps/search/?api=1&query=35.68%2C139.76');
  await popup.close();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(details.getByRole('link', { name: 'Directions to Tokyo station in Google Maps (opens externally)', exact: true })).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=35.68%2C139.76');
    await expect(page.locator('.leaflet-control-attribution')).toBeVisible();
    await expect.poll(() => page.locator('.leaflet-tile-loaded').count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/leaflet-cache-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Memories', exact: true }).click();
  await expect(page.locator('.memories-wrap').getByRole('link', { name: 'Open Tokyo station in Google Maps (opens externally)', exact: true })).toBeVisible();
});

test('supported Web Locks share a fresh lookup across tabs', async ({ page, context }) => {
  let requests = 0;
  await context.route('https://photon.komoot.io/**', (route) => {
    requests++;
    return route.fulfill({ json: { features: [{ geometry: { coordinates: [139, 35] }, properties: { name: 'Shared result' } }] } });
  });
  await context.addInitScript((uid) => localStorage.setItem(`gala-nanaman:map-history:v1:${uid}`, 'yes'), uid);
  await page.goto('/');
  test.skip(!await page.evaluate(() => Boolean(navigator.locks)), 'Cross-tab coalescing requires Web Locks.');
  const second = await context.newPage();
  await second.goto('/');
  const results = await Promise.all([page, second].map((tab) => tab.evaluate(async () => {
    // @ts-expect-error Vite serves source modules for this browser-only integration test.
    const { searchPlaces } = await import('/src/services/geo.ts');
    return searchPlaces('Shared query', 5);
  })));
  expect(results[0]).toEqual(results[1]);
  expect(requests).toBe(1);
});

test('clearing from a second tab invalidates an in-flight lookup in the first', async ({ page, context }) => {
  let release!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((done) => { started = done; });
  const gate = new Promise<void>((done) => { release = done; });
  await context.route('https://photon.komoot.io/**', async (route) => {
    started();
    await gate;
    await route.fulfill({ json: { features: [{ geometry: { coordinates: [139, 35] }, properties: { name: 'Old result' } }] } });
  });
  await context.addInitScript((uid) => localStorage.setItem(`gala-nanaman:map-history:v1:${uid}`, 'yes'), uid);
  await page.goto('/');
  const second = await context.newPage();
  await second.goto('/');
  const pending = page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules for this browser-only integration test.
    const { searchPlaces } = await import('/src/services/geo.ts');
    try { await searchPlaces('Delayed query', 5); return 'unexpected'; }
    catch (error) { return error instanceof Error ? error.name : 'unknown'; }
  });
  await requestStarted;
  await second.evaluate(async (uid) => {
    // @ts-expect-error Vite serves source modules for this browser-only integration test.
    const { clearMapLookups } = await import('/src/services/mapCache.ts');
    await clearMapLookups(uid, true);
  }, uid);
  release();
  expect(await pending).toBe('AbortError');
  expect(await second.evaluate(async (uid) => {
    // @ts-expect-error Vite serves source modules for this browser-only integration test.
    const { mapCacheSummary } = await import('/src/services/mapCache.ts');
    return (await mapCacheSummary(uid)).count;
  }, uid)).toBe(0);
});