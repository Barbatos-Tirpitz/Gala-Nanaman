import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  use: { headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
  projects: [
    { name: 'workflows', testIgnore: '**/shell.spec.ts', use: { baseURL: 'http://127.0.0.1:5184' } },
    { name: 'shell', testMatch: '**/shell.spec.ts', use: { baseURL: 'http://127.0.0.1:4174' } },
  ],
  webServer: [{
    command: 'npm run dev -- --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184',
    reuseExistingServer: false,
    env: { VITE_FIREBASE_API_KEY: '', VITE_FIREBASE_AUTH_DOMAIN: '', VITE_FIREBASE_PROJECT_ID: '', VITE_FIREBASE_APP_ID: '' },
  }, {
    command: 'npm run preview -- --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174', reuseExistingServer: false,
  }],
});