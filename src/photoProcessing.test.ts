import { expect, it } from 'vitest';
import { MAX_PHOTO_BYTES, photoValidationError } from './photoProcessing';

it('allows exactly 30 MiB and rejects empty, oversized and active-content files', () => {
  expect(photoValidationError({ type: 'image/jpeg', size: MAX_PHOTO_BYTES })).toBeUndefined();
  expect(photoValidationError({ type: 'image/png', size: MAX_PHOTO_BYTES + 1 })).toBeDefined();
  expect(photoValidationError({ type: 'image/jpeg', size: 0 })).toBeDefined();
  expect(photoValidationError({ type: 'image/svg+xml', size: 100 })).toBeDefined();
  expect(photoValidationError({ type: 'text/html', size: 100 })).toBeDefined();
});