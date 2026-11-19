/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    injectRegister: null,
    includeAssets: [],
    manifest: {
      name: 'Gala-Nanaman', short_name: 'Gala-Nanaman', start_url: '/', display: 'standalone',
      theme_color: '#344f40', background_color: '#f8f9f6',
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,woff2}'],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/__\//, /^\/api\//],
      cleanupOutdatedCaches: true,
      runtimeCaching: [],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    },
  })],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
