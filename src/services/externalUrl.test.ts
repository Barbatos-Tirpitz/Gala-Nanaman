import { expect, it } from 'vitest';
import { safeProviderUrl } from './externalUrl';

it('allows only HTTPS provider hosts without embedded credentials', () => {
  const hosts = ['commons.wikimedia.org'];
  expect(safeProviderUrl('https://commons.wikimedia.org/wiki/File:A.jpg', hosts)).toBeDefined();
  for (const url of ['javascript:alert(1)', 'https://commons.wikimedia.org.evil.test/x', 'https://user@commons.wikimedia.org/x', 'http://commons.wikimedia.org/x']) {
    expect(safeProviderUrl(url, hosts)).toBeUndefined();
  }
});