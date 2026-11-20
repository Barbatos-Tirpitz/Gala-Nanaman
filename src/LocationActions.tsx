import { ExternalLink, Navigation } from 'lucide-react';
import { googleMapsUrl, type MapDestination } from './services/googleMapsUrl';

export default function LocationActions({ place }: { place: MapDestination }) {
  const search = googleMapsUrl(place);
  const directions = googleMapsUrl(place, 'directions');
  if (!search) return null;
  return <div className="location-actions">
    <a href={search} target="_blank" rel="noopener noreferrer" aria-label={`Open ${place.label ?? 'location'} in Google Maps (opens externally)`}><ExternalLink size={14} /> Open in Google Maps</a>
    {directions && <a href={directions} target="_blank" rel="noopener noreferrer" aria-label={`Directions to ${place.label ?? 'location'} in Google Maps (opens externally)`}><Navigation size={14} /> Directions</a>}
  </div>;
}