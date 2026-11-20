export interface MapDestination {
  latitude?: number;
  longitude?: number;
  label?: string;
}

function coordinates(place: MapDestination): string | undefined {
  const { latitude, longitude } = place;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return `${latitude},${longitude}`;
}

export function googleMapsUrl(place: MapDestination, action: 'place' | 'directions' = 'place'): string | undefined {
  const point = coordinates(place);
  const label = place.label?.trim().slice(0, 200);
  if (!point && (action === 'directions' || !label)) return undefined;
  const url = new URL(action === 'directions' ? 'https://www.google.com/maps/dir/' : 'https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set(action === 'directions' ? 'destination' : 'query', point ?? label!);
  return url.href;
}