import { useEffect, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { PlaceLocation } from './types';

function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: 'route-map-pin',
    html: '<span class="route-pin selected">+</span>',
    iconSize: [34, 40],
    iconAnchor: [17, 36],
  });
}

function ClickToPick({ onPick }: { onPick: (point: { latitude: number; longitude: number }) => void }) {
  useMapEvents({
    click(event) {
      onPick({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  return null;
}

function RecenterMap({ center }: { center: PlaceLocation }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.latitude, center.longitude], 14);
  }, [center.latitude, center.longitude, map]);
  return null;
}

export default function MapPicker({
  center,
  selected,
  onPick,
}: {
  center: PlaceLocation;
  selected?: PlaceLocation;
  onPick: (point: { latitude: number; longitude: number }) => void;
}) {
  const [picked, setPicked] = useState<{ latitude: number; longitude: number } | undefined>();
  const point = picked ?? selected;
  const position: [number, number] = point
    ? [point.latitude, point.longitude]
    : [center.latitude, center.longitude];

  function selectPoint(nextPoint: { latitude: number; longitude: number }) {
    setPicked(nextPoint);
    onPick(nextPoint);
  }

  return (
    <div className="map-picker-frame" aria-label="Pick an exact location on the map">
      <MapContainer center={[center.latitude, center.longitude]} zoom={14} scrollWheelZoom className="map-picker">
        <RecenterMap center={center} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToPick onPick={selectPoint} />
        {point && <Marker position={position} icon={pinIcon()} />}
      </MapContainer>
      <p className="map-picker-hint">Tap or click the exact spot to drop the pin.</p>
    </div>
  );
}
