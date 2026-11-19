import { expect, it } from 'vitest';
import { googleMapsUrl } from './googleMapsUrl';

it('uses a fixed HTTPS origin and encodes place labels as data', () => {
  const label = '東京 & O\'Brien?api=evil#<script>';
  const url = new URL(googleMapsUrl({ label })!);
  expect(url.origin).toBe('https://www.google.com');
  expect(url.pathname).toBe('/maps/search/');
  expect(url.searchParams.get('api')).toBe('1');
  expect(url.searchParams.get('query')).toBe(label);
  expect([...url.searchParams.keys()]).toEqual(['api', 'query']);
});

it('prefers coordinates and omits origin, user identity and tracking', () => {
  const url = new URL(googleMapsUrl({ latitude: 0, longitude: 180, label: 'Ignored' }, 'directions')!);
  expect(url.pathname).toBe('/maps/dir/');
  expect([...url.searchParams.entries()]).toEqual([['api', '1'], ['destination', '0,180']]);
});

it('does not offer directions without valid coordinates', () => {
  for (const place of [{ label: 'Tokyo' }, { latitude: NaN, longitude: 1 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, {}]) {
    expect(googleMapsUrl(place, 'directions')).toBeUndefined();
  }
  expect(googleMapsUrl({})).toBeUndefined();
});