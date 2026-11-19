import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, Image, MapPin, Navigation, Route, Sparkles } from 'lucide-react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import { DailyLimitError, findPlacePhotos, getDrivingRoute, searchPlaces, type PlacePhoto } from './services/geo';
import type { Activity, PlaceLocation, Trip } from './types';
import { formatTime, type TimeFormat } from './settings';
import 'leaflet/dist/leaflet.css';
import { MAP_TILES } from './services/mapProviders';
import LocationActions from './LocationActions';

interface MapViewProps {
  trip: Trip;
  activities: Activity[];
  timeFormat: TimeFormat;
}

interface MapPoint {
  id: string;
  title: string;
  location: PlaceLocation;
  activity?: Activity;
}

function stopIcon(number: number, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: 'route-map-pin',
    html: `<span class="route-pin ${selected ? 'selected' : ''}">${number}</span>`,
    iconSize: [34, 40],
    iconAnchor: [17, 36],
  });
}

function MapBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  const boundsKey = points.map(([latitude, longitude]) => `${latitude},${longitude}`).join(';');

  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 14);
    if (points.length > 1) map.fitBounds(points, { padding: [42, 42], maxZoom: 14 });
  }, [boundsKey, map]);

  return null;
}

async function lookupPlace(query: string, signal: AbortSignal): Promise<PlaceLocation | undefined> {
  const [place] = await searchPlaces(query, 1, signal);
  return place ? { ...place, label: place.label || query } : undefined;
}

export default function RouteMap({ trip, activities, timeFormat }: MapViewProps) {
  const locatedActivities = activities.filter((activity) => activity.location
    && Number.isFinite(activity.location.latitude)
    && Number.isFinite(activity.location.longitude)
    && Math.abs(activity.location.latitude) <= 90
    && Math.abs(activity.location.longitude) <= 180);
  const locationKey = locatedActivities.map((activity) => `${activity.id}:${activity.location?.latitude},${activity.location?.longitude}`).join('|');
  const [destinationLocation, setDestinationLocation] = useState<PlaceLocation>();
  const [destinationState, setDestinationState] = useState<'loading' | 'ready' | 'error' | 'limit'>('loading');
  const [selectedStopId, setSelectedStopId] = useState(() => locatedActivities[0]?.id ?? 'destination');
  const [routeCoordinates, setRouteCoordinates] = useState<Array<[number, number]>>([]);
  const [routeLabel, setRouteLabel] = useState('');
  const [routeState, setRouteState] = useState<'idle' | 'loading' | 'ready' | 'fallback' | 'error'>('idle');
  const [photos, setPhotos] = useState<PlacePhoto[]>([]);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [photoQueryUsed, setPhotoQueryUsed] = useState('');
  const [photoState, setPhotoState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'limit'>('loading');

  useEffect(() => {
    if (locatedActivities.length) {
      setDestinationLocation(undefined);
      setDestinationState('ready');
      return;
    }

    const controller = new AbortController();
    setDestinationState('loading');
    lookupPlace(trip.destination, controller.signal)
      .then((location) => {
        if (controller.signal.aborted) return;
        setDestinationLocation(location);
        setDestinationState(location ? 'ready' : 'error');
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDestinationState(error instanceof DailyLimitError ? 'limit' : 'error');
      });
    return () => controller.abort();
  }, [trip.destination, locationKey]);

  useEffect(() => {
    setSelectedStopId(locatedActivities[0]?.id ?? 'destination');
  }, [trip.id, locationKey]);

  useEffect(() => {
    if (locatedActivities.length < 2) {
      setRouteCoordinates([]);
      setRouteLabel(locatedActivities.length === 1 ? 'Add another located activity to connect a route.' : 'Add locations to activities to plot a route.');
      setRouteState('idle');
      return;
    }

    const controller = new AbortController();
    const stops = locatedActivities.map((activity) => ({ latitude: activity.location!.latitude, longitude: activity.location!.longitude }));
    setRouteState('loading');
    setRouteLabel('Calculating driving route…');

    getDrivingRoute(stops, controller.signal)
      .then((route) => {
        if (controller.signal.aborted) return;
        setRouteCoordinates(route.coordinates);
        setRouteLabel(`${(route.distanceMeters / 1000).toFixed(1)} km · ${Math.round(route.durationSeconds / 60)} min driving`);
        setRouteState('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRouteCoordinates(stops.map(({ latitude, longitude }): [number, number] => [latitude, longitude]));
        setRouteLabel(error instanceof DailyLimitError ? 'Daily route limit reached · showing stop order' : 'Driving route unavailable · showing stop order');
        setRouteState('fallback');
      });

    return () => controller.abort();
  }, [locationKey]);

  const selectedActivity = locatedActivities.find((activity) => activity.id === selectedStopId);
  const photoQuery = selectedActivity?.location?.searchTerm ?? selectedActivity?.location?.label ?? trip.destination;

  useEffect(() => {
    const controller = new AbortController();
    setPhotoState('loading');
    setPhotoIndex(0);
    setPhotos([]);
    setPhotoQueryUsed('');

    findPlacePhotos([photoQuery, trip.destination], controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setPhotos(result.photos);
        setPhotoQueryUsed(result.query ?? '');
        setPhotoState(result.photos.length ? 'ready' : 'empty');
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setPhotoState(error instanceof DailyLimitError ? 'limit' : 'error');
      });

    return () => controller.abort();
  }, [photoQuery, trip.destination]);

  const mapPoints: MapPoint[] = locatedActivities.length
    ? locatedActivities.map((activity) => ({ id: activity.id, title: activity.title, location: activity.location!, activity }))
    : destinationLocation
      ? [{ id: 'destination', title: trip.destination, location: destinationLocation }]
      : [];
  const coordinates = mapPoints.map((point) => [point.location.latitude, point.location.longitude] as [number, number]);
  const mapCenter: [number, number] = coordinates[0] ?? [20, 0];
  const activePhoto = photos[photoIndex];

  return (
    <div className="route-map-layout">
      <section className="map-frame" aria-label="Trip route map">
        <div className="map-frame-heading">
          <div><span className="map-section-kicker"><Route size={14} /> ROUTE PREVIEW</span><strong>{locatedActivities.length ? `${locatedActivities.length} mapped stops` : 'Destination preview'}</strong></div>
          {routeLabel && <span className={`route-distance ${routeState === 'fallback' ? 'route-warning' : ''}`}><Navigation size={14} /> {routeLabel}</span>}
        </div>
        {mapPoints.length ? (
          <MapContainer key={trip.id} center={mapCenter} zoom={12} scrollWheelZoom className="leaflet-map">
            <TileLayer
              attribution={MAP_TILES.attribution}
              url={MAP_TILES.url}
            />
            <MapBounds points={coordinates} />
            {routeCoordinates.length > 1 && <Polyline positions={routeCoordinates} pathOptions={{ color: '#d76d50', weight: 5, opacity: 0.88, lineCap: 'round', lineJoin: 'round' }} />}
            {mapPoints.map((point, index) => (
              <Marker
                key={point.id}
                position={[point.location.latitude, point.location.longitude]}
                icon={stopIcon(index + 1, point.id === selectedStopId)}
                eventHandlers={{ click: () => setSelectedStopId(point.id) }}
              />
            ))}
          </MapContainer>
        ) : (
          <div className="map-unavailable">
            <MapPin size={24} />
            <strong>{destinationState === 'loading' ? 'Finding your destination on the map…' : destinationState === 'limit' ? 'Daily place search limit reached.' : 'We couldn’t place this destination on the map.'}</strong>
            <span>{destinationState === 'loading' ? 'Searching OpenStreetMap for the trip destination.' : destinationState === 'limit' ? 'Map lookups are available again tomorrow.' : 'Try a city or region name in the trip details, or add a place to an activity.'}</span>
          </div>
        )}
        <div className="map-attribution-note">Map data &copy; OpenStreetMap · Route preview by OSRM</div>
      </section>

      <aside className="place-preview-panel" aria-label="Place details and photos">
        <div className="place-panel-heading">
          <div><span className="map-section-kicker"><Sparkles size={14} /> PLACE PREVIEW</span><h3>{selectedActivity?.title ?? trip.destination}</h3></div>
          {selectedActivity && <span className="place-time"><Clock3 size={13} /> {formatTime(selectedActivity.startTime, timeFormat)}</span>}
        </div>
        <p className="place-address"><MapPin size={14} /> {selectedActivity?.location?.label ?? destinationLocation?.label ?? trip.destination}</p>
        <LocationActions place={selectedActivity?.location ?? destinationLocation ?? { label: trip.destination }} />

        <div className="photo-carousel" aria-label="Place photo carousel" aria-busy={photoState === 'loading'}>
          {activePhoto ? (
            <>
              <img src={activePhoto.thumbnail} alt={activePhoto.title} />
              {photos.length > 1 && (
                <div className="photo-controls">
                  <button className="photo-arrow" aria-label="Previous photo" onClick={() => setPhotoIndex((index) => (index - 1 + photos.length) % photos.length)}><ChevronLeft size={18} /></button>
                  <span>{photoIndex + 1} / {photos.length}</span>
                  <button className="photo-arrow" aria-label="Next photo" onClick={() => setPhotoIndex((index) => (index + 1) % photos.length)}><ChevronRight size={18} /></button>
                </div>
              )}
            </>
          ) : (
            <div className="photo-placeholder">
              <Image size={24} />
              <span>{photoState === 'loading' ? 'Finding place photos…' : photoState === 'limit' ? 'Daily photo limit reached. Try again tomorrow.' : photoState === 'error' ? 'Photos could not be loaded.' : 'No photos found for this place.'}</span>
            </div>
          )}
        </div>
        {photoQueryUsed && photoQueryUsed !== photoQuery && <p className="photo-provider-note">No venue photos found; showing destination inspiration for {photoQueryUsed}.</p>}
        {activePhoto && <a className="photo-credit" href={activePhoto.sourceUrl} target="_blank" rel="noreferrer">{activePhoto.title} · View source</a>}

        {locatedActivities.length > 0 ? (
          <div className="mapped-stop-list">
            <div className="stop-list-heading"><strong>Stops in this route</strong><span>{locatedActivities.length}</span></div>
            {locatedActivities.map((activity, index) => (
              <button className={`mapped-stop ${activity.id === selectedStopId ? 'selected' : ''}`} key={activity.id} onClick={() => setSelectedStopId(activity.id)} aria-pressed={activity.id === selectedStopId}>
                <span className="mapped-stop-number">{index + 1}</span>
                <span className="mapped-stop-copy"><strong>{activity.title}</strong><small>{activity.location?.label}</small></span>
                <span className="mapped-stop-time">{formatTime(activity.startTime, timeFormat)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="map-hint">Add a place to each activity to connect stops and calculate the driving route.</div>
        )}
        <p className="photo-provider-note">Place searches, route coordinates, and photo queries use public services, with daily lookup limits for each account. Routes are driving estimates, not navigation. Check photo licenses and attribution before reuse.</p>
      </aside>
    </div>
  );
}
