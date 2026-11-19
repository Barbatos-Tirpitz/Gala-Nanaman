import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import './styles.css';
import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';

if (import.meta.env.PROD && !Capacitor.isNativePlatform()) {
  const update = registerSW({
    onNeedRefresh() {
      if (window.confirm('An app update is ready. Reload now? Unsaved edits will be lost.')) void update(true);
    },
    onRegisterError() { console.warn('Offline application shell could not be cached.'); },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
