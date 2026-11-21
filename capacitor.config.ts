/// <reference types="@capacitor-firebase/authentication" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'gala.nanaman.app',
  appName: 'Gala Nanaman',
  webDir: 'dist',
  plugins: {
    FirebaseAuthentication: {
      providers: ['google.com'],
      skipNativeAuth: true,
    },
  },
};

export default config;