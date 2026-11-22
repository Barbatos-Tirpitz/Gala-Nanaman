import { afterEach, expect, it, vi } from 'vitest';
import { createSecureRandomUUID } from './secureRandom';

afterEach(() => vi.unstubAllGlobals());

it('uses the platform UUID generator when available', () => {
  vi.stubGlobal('crypto', { randomUUID: () => 'secure-uuid' });
  expect(createSecureRandomUUID()).toBe('secure-uuid');
});

it('generates a version 4 UUID from cryptographically secure bytes', () => {
  vi.stubGlobal('crypto', {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.fill(0);
      return bytes;
    },
  });
  expect(createSecureRandomUUID()).toBe('00000000-0000-4000-8000-000000000000');
});

it('fails rather than falling back to insecure randomness', () => {
  vi.stubGlobal('crypto', undefined);
  expect(() => createSecureRandomUUID()).toThrow('Secure random generator is unavailable');
});
