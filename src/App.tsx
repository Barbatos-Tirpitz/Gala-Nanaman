import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleCheck,
  Clock3,
  Compass,
  List,
  ListChecks,
  LogOut,
  Map as MapIcon,
  MapPin,
  Pencil,
  Plus,
  Receipt,
  Search,
  Settings as SettingsIcon,
  Trash2,
  X,
} from 'lucide-react';
import { createId } from './storage';
import { tripRepository } from './repositories/TripRepository';
import RouteMap from './MapView';
import MapPicker from './MapPicker';
import ActivityPhotoGallery from './ActivityPhotoGallery';
import ModalShell from './ModalShell';
import ExpensesView from './ExpensesView';
import { DailyLimitError, reversePlace, searchPlaces } from './services/geo';
import type { Activity, ActivityCategory, Expense, PlaceLocation, Trip } from './types';
import { currencyFractionDigits, formatAmount, parseAmountToMinorUnits } from './money';
import SettingsDialog from './SettingsDialog';
import { formatTime, loadUserSettings, saveUserSettings, type UserSettings } from './settings';
import { deleteLocalPhoto, saveLocalPhoto, type LocalPhotoRef } from './localPhotos';
import { useAuth } from './auth/AuthContext';
import SignInScreen from './auth/SignInScreen';
import { firebaseAuth, firebaseConfigured, firestore } from './firebase';
import { FirestoreTripRepository } from './repositories/FirestoreTripRepository';
import type { TripRepository } from './repositories/TripRepository';

type DialogState =
  | { kind: 'trip'; trip?: Trip }
  | { kind: 'activity'; trip: Trip; activity?: Activity }
  | null;

type AppView = 'trips' | 'itinerary' | 'expenses';

const categoryIcons: Record<ActivityCategory, string> = {
  Explore: 'E',
  Food: 'F',
  Stay: 'S',
  Transit: 'T',
};

function formatDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en', options).format(new Date(`${date}T12:00:00`));
}

function dateRange(start: string, end: string): string {
  const startLabel = formatDate(start, { month: 'short', day: 'numeric' });
  const endLabel = formatDate(end, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startLabel} - ${endLabel}`;
}

function tripLength(start: string, end: string): number {
  const startDay = Date.parse(`${start}T00:00:00Z`);
  const endDay = Date.parse(`${end}T00:00:00Z`);
  return Math.max(1, Math.round((endDay - startDay) / 86_400_000) + 1);
}

function addCalendarDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function nextActivityDefaults(trip: Trip): { date: string; startTime: string; endTime: string } {
  const last = [...trip.activities].sort((left, right) => `${left.date}T${left.startTime}`.localeCompare(`${right.date}T${right.startTime}`)).at(-1);
  let date = last?.date ?? trip.startDate;
  let startMinutes = last ? Number(last.endTime.slice(0, 2)) * 60 + Number(last.endTime.slice(3, 5)) + 60 : 9 * 60;

  if (startMinutes >= 24 * 60) {
    date = addCalendarDay(date);
    startMinutes %= 24 * 60;
  }
  if (startMinutes + 60 >= 24 * 60) {
    date = addCalendarDay(date);
    startMinutes = (startMinutes + 60) % (24 * 60);
  }
  if (date > trip.endDate) {
    date = trip.startDate;
    startMinutes = 9 * 60;
  }

  const endMinutes = (startMinutes + 60) % (24 * 60);
  const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return { date, startTime: toTime(startMinutes), endTime: toTime(endMinutes) };
}

function TripDialog({
  trip,
  defaultCurrencyCode,
  onClose,
  onSave,
}: {
  trip?: Trip;
  defaultCurrencyCode: string;
  onClose: () => void;
  onSave: (values: Omit<Trip, 'id' | 'activities' | 'expenses'>, id?: string) => void;
}) {
  const [budgetError, setBudgetError] = useState('');
  const currencyLocked = Boolean(trip && (trip.budgetMinor > 0 || trip.expenses.length > 0));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const startDate = String(formData.get('startDate'));
    const endDate = String(formData.get('endDate'));
    const currencyCode = String(formData.get('currencyCode') ?? trip?.currencyCode ?? defaultCurrencyCode);
    const budget = String(formData.get('budget')).trim();
    const budgetMinor = budget ? parseAmountToMinorUnits(budget, currencyCode) : 0;

    if (endDate < startDate) return;
    if (budgetMinor === undefined) {
      setBudgetError(`Enter a valid ${currencyCode} amount with up to ${currencyFractionDigits(currencyCode)} decimal places.`);
      return;
    }
    setBudgetError('');

    onSave(
      {
        name: String(formData.get('name')).trim(),
        destination: String(formData.get('destination')).trim(),
        startDate,
        endDate,
        timeZone: String(formData.get('timeZone')).trim(),
        currencyCode,
        budgetMinor,
      },
      trip?.id,
    );
  }

  return (
    <Modal title={trip ? 'Edit trip details' : 'Create a trip'} onClose={onClose}>
      <form className="dialog-form" onSubmit={handleSubmit}>
        <label>
          Trip name
          <input name="name" defaultValue={trip?.name} required maxLength={70} autoFocus />
        </label>
        <label>
          Primary destination
          <input name="destination" defaultValue={trip?.destination} required maxLength={80} placeholder="City or region" />
        </label>
        <div className="field-row">
          <label>
            Start date
            <input name="startDate" type="date" defaultValue={trip?.startDate} required />
          </label>
          <label>
            End date
            <input name="endDate" type="date" defaultValue={trip?.endDate} required min={trip?.startDate} />
          </label>
        </div>
        <label>
          Trip timezone
          <input name="timeZone" defaultValue={trip?.timeZone ?? 'America/New_York'} required maxLength={64} placeholder="America/New_York" />
          <span className="field-hint">Use an IANA timezone, such as Asia/Tokyo.</span>
        </label>
        <div className="field-row">
          <label>
            Budget <span className="optional-label">Optional</span>
            <input name="budget" type="number" min="0" step={1 / (10 ** currencyFractionDigits(trip?.currencyCode ?? defaultCurrencyCode))} defaultValue={trip?.budgetMinor ? trip.budgetMinor / (10 ** currencyFractionDigits(trip.currencyCode)) : ''} placeholder="0" onChange={() => setBudgetError('')} />
          </label>
          <label>
            Currency
            <select name="currencyCode" defaultValue={trip?.currencyCode ?? defaultCurrencyCode} disabled={currencyLocked}>
              <option value="PHP">PHP · Philippine Peso</option>
              <option value="USD">USD · US Dollar</option>
              <option value="CAD">CAD · Canadian Dollar</option>
              <option value="EUR">EUR · Euro</option>
              <option value="GBP">GBP · British Pound</option>
              <option value="JPY">JPY · Japanese Yen</option>
              <option value="AUD">AUD · Australian Dollar</option>
            </select>
            {currencyLocked && <span className="field-hint">Currency is locked after setting a budget or recording expenses.</span>}
          </label>
        </div>
        {budgetError && <p className="form-error" role="alert">{budgetError}</p>}
        <div className="dialog-actions">
          <button className="button button-quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit"><Check size={16} /> Save trip</button>
        </div>
      </form>
    </Modal>
  );
}

function ActivityDialog({
  trip,
  activity,
  onClose,
  onSave,
}: {
  trip: Trip;
  activity?: Activity;
  onClose: () => void;
  onSave: (values: Omit<Activity, 'id'>, id?: string) => Promise<void>;
}) {
  const [placeQuery, setPlaceQuery] = useState(activity?.location?.label ?? '');
  const [selectedLocation, setSelectedLocation] = useState<PlaceLocation | undefined>(activity?.location);
  const [placeResults, setPlaceResults] = useState<PlaceLocation[]>([]);
  const [placeSearchState, setPlaceSearchState] = useState<'idle' | 'loading' | 'error' | 'limit'>('idle');
  const defaults = nextActivityDefaults(trip);
  const [timeError, setTimeError] = useState('');
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [mapPickerCenter, setMapPickerCenter] = useState<PlaceLocation | undefined>(activity?.location ?? trip.activities.find((item) => item.location)?.location);
  const [mapPickerState, setMapPickerState] = useState<'idle' | 'loading' | 'error' | 'limit'>('idle');
  const [activityPhotos, setActivityPhotos] = useState<LocalPhotoRef[]>(activity?.photos ?? []);
  const [newPhotoFiles, setNewPhotoFiles] = useState<File[]>([]);
  const [outfitOfDay, setOutfitOfDay] = useState(activity?.outfitOfDay ?? false);
  const [outfitNotes, setOutfitNotes] = useState(activity?.outfitNotes ?? '');
  const [photoError, setPhotoError] = useState('');

  useEffect(() => {
    const query = placeQuery.trim();
    if (query.length < 3 || selectedLocation?.label === query) {
      setPlaceResults([]);
      setPlaceSearchState('idle');
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setPlaceSearchState('loading');
      try {
        const results = (await searchPlaces(query, 5, controller.signal))
          .filter((place) => place.label)
          .map((place) => ({ ...place, searchTerm: query }));
        if (controller.signal.aborted) return;
        setPlaceResults(results);
        setPlaceSearchState('idle');
      } catch (error) {
        if (!controller.signal.aborted) setPlaceSearchState(error instanceof DailyLimitError ? 'limit' : 'error');
      }
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [placeQuery, selectedLocation?.label]);

  useEffect(() => {
    if (!mapPickerOpen || mapPickerCenter) return;
    const controller = new AbortController();
    setMapPickerState('loading');
    searchPlaces(trip.destination, 1, controller.signal)
      .then(([place]) => {
        if (controller.signal.aborted) return;
        if (!place) {
          setMapPickerState('error');
          return;
        }
        setMapPickerCenter(place);
        setMapPickerState('idle');
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setMapPickerState(error instanceof DailyLimitError ? 'limit' : 'error');
      });
    return () => controller.abort();
  }, [mapPickerOpen, mapPickerCenter, trip.destination]);

  function handleMapPick(point: { latitude: number; longitude: number }) {
    const pinnedLabel = `Pinned location (${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)})`;
    const fallbackLocation: PlaceLocation = { ...point, label: pinnedLabel, searchTerm: pinnedLabel };
    setSelectedLocation(fallbackLocation);
    setPlaceQuery(pinnedLabel);
    setMapPickerState('loading');

    void reversePlace(point.latitude, point.longitude)
      .then((place) => {
        setSelectedLocation(place);
        setPlaceQuery(place.label);
        setMapPickerCenter(place);
        setMapPickerState('idle');
      })
      .catch((error: unknown) => {
        setMapPickerState(error instanceof DailyLimitError ? 'limit' : 'idle');
      });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const startTime = String(formData.get('startTime'));
    const endTime = String(formData.get('endTime'));
    if (endTime <= startTime) {
      setTimeError('End time must be later than start time. For an overnight stop, add it on the next date.');
      return;
    }
    setTimeError('');

    let newlyStoredPhotos: LocalPhotoRef[] = [];
    try {
      newlyStoredPhotos = await Promise.all(newPhotoFiles.map(saveLocalPhoto));
      await onSave(
        {
        title: String(formData.get('title')).trim(),
        date: String(formData.get('date')),
        startTime,
        endTime,
        category: String(formData.get('category')) as ActivityCategory,
        notes: String(formData.get('notes')).trim(),
        outfitOfDay,
        outfitNotes: outfitNotes.trim(),
        photos: [...activityPhotos, ...newlyStoredPhotos],
        ...(selectedLocation ? { location: selectedLocation } : {}),
        },
        activity?.id,
      );
      const retainedIds = new Set([...activityPhotos, ...newlyStoredPhotos].map((photo) => photo.id));
      await Promise.all((activity?.photos ?? []).filter((photo) => !retainedIds.has(photo.id)).map((photo) => deleteLocalPhoto(photo.id).catch(() => undefined)));
    } catch {
      await Promise.all(newlyStoredPhotos.map((photo) => deleteLocalPhoto(photo.id).catch(() => undefined)));
      setPhotoError('The activity or its photos could not be saved. Check local storage and try again.');
    }
  }

  return (
    <Modal title={activity ? 'Edit activity' : 'Add to the itinerary'} onClose={onClose}>
      <form className="dialog-form" onSubmit={handleSubmit}>
        <label>
          Activity
          <input name="title" defaultValue={activity?.title} required maxLength={90} autoFocus placeholder="What are you planning?" />
        </label>
        <label>
          Place <span className="optional-label">Optional</span>
          <div className="place-search-field">
            <Search size={16} />
            <input
              value={placeQuery}
              onChange={(event) => {
                setPlaceQuery(event.target.value);
                if (event.target.value !== selectedLocation?.label) setSelectedLocation(undefined);
              }}
              placeholder="Search a place or address"
              autoComplete="off"
              maxLength={200}
            />
            {placeQuery && <button type="button" className="place-clear" aria-label="Clear place" onClick={() => { setPlaceQuery(''); setSelectedLocation(undefined); }}><X size={15} /></button>}
          </div>
          {placeSearchState === 'loading' && <span className="field-hint">Searching OpenStreetMap places…</span>}
          {placeSearchState === 'error' && <span className="field-hint">Place lookup is unavailable right now.</span>}
          {placeSearchState === 'limit' && <span className="field-hint">Daily place search limit reached. Try again tomorrow.</span>}
          {placeResults.length > 0 && (
            <div className="place-suggestions" role="listbox" aria-label="Place search results">
              {placeResults.map((place) => (
                <button key={`${place.latitude}-${place.longitude}`} type="button" role="option" onClick={() => { setSelectedLocation(place); setMapPickerCenter(place); setPlaceQuery(place.label); setPlaceResults([]); }}>
                  <MapPin size={14} /><span>{place.label}</span>
                </button>
              ))}
            </div>
          )}
          <span className="field-hint">Search results are provided by Photon and OpenStreetMap.</span>
          <button className="button button-outline map-picker-toggle" type="button" onClick={() => setMapPickerOpen((open) => !open)}><MapIcon size={15} /> {mapPickerOpen ? 'Hide map picker' : 'Choose exact point on map'}</button>
          {mapPickerOpen && (
            <div className="activity-map-picker">
              {mapPickerState === 'loading' && !mapPickerCenter && <p className="field-hint">Locating the trip destination…</p>}
              {mapPickerState === 'limit' && <p className="field-hint">Daily place lookup limit reached.</p>}
              {mapPickerState === 'error' && !mapPickerCenter && <p className="field-hint">Search for a place above first, then select it to center the map.</p>}
              {mapPickerCenter && <MapPicker center={mapPickerCenter} selected={selectedLocation} onPick={handleMapPick} />}
            </div>
          )}
        </label>
        <div className="field-row">
          <label>
            Date
            <input name="date" type="date" min={trip.startDate} max={trip.endDate} defaultValue={activity?.date ?? defaults.date} required />
          </label>
          <label>
            Type
            <select name="category" defaultValue={activity?.category ?? 'Explore'}>
              <option>Explore</option>
              <option>Food</option>
              <option>Stay</option>
              <option>Transit</option>
            </select>
          </label>
        </div>
        <div className="field-row">
          <label>
            Starts
            <input name="startTime" type="time" defaultValue={activity?.startTime ?? defaults.startTime} required onChange={() => setTimeError('')} />
          </label>
          <label>
            Ends
            <input name="endTime" type="time" defaultValue={activity?.endTime ?? defaults.endTime} required onChange={() => setTimeError('')} />
          </label>
        </div>
        {timeError && <p className="form-error" role="alert">{timeError}</p>}
        <label>
          Notes <span className="optional-label">Optional</span>
          <textarea name="notes" defaultValue={activity?.notes} rows={3} maxLength={400} placeholder="Reservations, reminders, or useful details" />
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={outfitOfDay} onChange={(event) => setOutfitOfDay(event.target.checked)} />
          <span>Outfit of the day</span>
        </label>
        {outfitOfDay && (
          <label>
            Outfit notes <span className="optional-label">Optional</span>
            <textarea value={outfitNotes} onChange={(event) => setOutfitNotes(event.target.value)} rows={2} maxLength={300} placeholder="Weather, layers, or packing note" />
          </label>
        )}
        <label>
          Photos <span className="optional-label">Optional · saved on this device only</span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              const incoming = Array.from(event.target.files ?? []);
              if (activityPhotos.length + newPhotoFiles.length + incoming.length > 5) {
                setPhotoError('You can attach up to five photos to an activity.');
                event.target.value = '';
                return;
              }
              if (incoming.some((file) => !file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)) {
                setPhotoError('Choose image files no larger than 5 MB each.');
                event.target.value = '';
                return;
              }
              setPhotoError('');
              setNewPhotoFiles((current) => [...current, ...incoming]);
              event.target.value = '';
            }}
          />
        </label>
        <ActivityPhotoGallery
          photos={activityPhotos}
          newFiles={newPhotoFiles}
          onRemoveStored={(id) => setActivityPhotos((current) => current.filter((photo) => photo.id !== id))}
          onRemoveFile={(index) => setNewPhotoFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
        />
        {photoError && <p className="form-error" role="alert">{photoError}</p>}
        <div className="dialog-actions">
          <button className="button button-quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit"><Check size={16} /> Save activity</button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return <ModalShell title={title} onClose={onClose}>{children}</ModalShell>;
}

function AppWorkspace() {
  const auth = useAuth();
  const repository = useMemo<TripRepository>(() => {
    if (firebaseAuth && firestore) return new FirestoreTripRepository(firestore, firebaseAuth);
    return tripRepository;
  }, []);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTripId, setActiveTripId] = useState('');
  const [currentView, setCurrentView] = useState<AppView>('trips');
  const [itineraryMode, setItineraryMode] = useState<'list' | 'map'>('list');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [storageError, setStorageError] = useState(false);
  const [loadingTrips, setLoadingTrips] = useState(true);
  const [settings, setSettings] = useState<UserSettings>(loadUserSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expenseActivityId, setExpenseActivityId] = useState<string>();
  const activeTrip = trips.find((trip) => trip.id === activeTripId);
  const canLoadTrips = !auth.configured || Boolean(auth.user);

  useEffect(() => {
    let active = true;
    if (!canLoadTrips) {
      setTrips([]);
      setActiveTripId('');
      setLoadingTrips(false);
      return () => { active = false; };
    }

    setLoadingTrips(true);
    repository.listTrips()
      .then((loadedTrips) => {
        if (!active) return;
        setTrips(loadedTrips);
        setActiveTripId((current) => current || loadedTrips[0]?.id || '');
        setStorageError(false);
      })
      .catch(() => {
        if (active) setStorageError(true);
      })
      .finally(() => {
        if (active) setLoadingTrips(false);
      });

    return () => { active = false; };
  }, [repository, canLoadTrips, auth.user?.uid]);

  async function refreshTrips(): Promise<void> {
    const loadedTrips = await repository.listTrips();
    setTrips(loadedTrips);
    setStorageError(false);
  }

  function updateSettings(nextSettings: UserSettings) {
    try {
      saveUserSettings(nextSettings);
      setSettings(nextSettings);
    } catch {
      setStorageError(true);
    }
  }

  async function saveTrip(values: Omit<Trip, 'id' | 'activities' | 'expenses'>, id?: string) {
    const existing = id ? trips.find((trip) => trip.id === id) : undefined;
    const savedTrip: Trip = existing
      ? { ...existing, ...values }
      : { ...values, id: createId(), activities: [], expenses: [] };

    try {
      await repository.saveTrip(savedTrip);
      await refreshTrips();
      if (!existing) {
        setActiveTripId(savedTrip.id);
        setCurrentView('itinerary');
      }
      setDialog(null);
    } catch {
      setStorageError(true);
    }
  }

  async function saveActivity(values: Omit<Activity, 'id'>, id?: string) {
    if (dialog?.kind !== 'activity') return;
    const { trip } = dialog;
    const existing = trip.activities.find((activity) => activity.id === id);
    const activity: Activity = existing ? { ...existing, ...values } : { ...values, id: createId() };
    try {
      await repository.saveActivity(trip.id, activity);
    } catch {
      setStorageError(true);
      throw new Error('Could not save this activity.');
    }
    const retainedPhotoIds = new Set((activity.photos ?? []).map((photo) => photo.id));
    await Promise.all((existing?.photos ?? []).filter((photo) => !retainedPhotoIds.has(photo.id)).map((photo) => deleteLocalPhoto(photo.id).catch(() => undefined)));
    setDialog(null);
    try { await refreshTrips(); } catch { setStorageError(true); }
  }

  async function deleteActivity(activity: Activity) {
    if (!activeTrip || !window.confirm(`Remove "${activity.title}" from the itinerary?`)) return;
    try {
      await repository.deleteActivity(activeTrip.id, activity.id);
      await Promise.all((activity.photos ?? []).map((photo) => deleteLocalPhoto(photo.id).catch(() => undefined)));
      await refreshTrips();
    } catch {
      setStorageError(true);
    }
  }

  async function saveExpense(expense: Expense) {
    if (!activeTrip) return;
    try {
      await repository.saveExpense(activeTrip.id, expense);
      await refreshTrips();
    } catch {
      setStorageError(true);
    }
  }

  async function deleteExpense(expense: Expense) {
    if (!activeTrip || !window.confirm(`Delete "${expense.title}" from expenses?`)) return;
    try {
      await repository.deleteExpense(activeTrip.id, expense.id);
      await refreshTrips();
    } catch {
      setStorageError(true);
    }
  }

  async function toggleDayComplete(date: string) {
    if (!activeTrip) return;
    const completedDates = new Set(activeTrip.completedDayDates ?? []);
    if (completedDates.has(date)) completedDates.delete(date);
    else completedDates.add(date);

    try {
      await repository.saveTrip({ ...activeTrip, completedDayDates: [...completedDates] });
      await refreshTrips();
    } catch {
      setStorageError(true);
    }
  }

  const sortedActivities = activeTrip
    ? [...activeTrip.activities].sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))
    : [];
  const activityDays = [...new Set(sortedActivities.map((activity) => activity.date))];
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const localTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const nextActivity = sortedActivities.find((activity) => `${activity.date}T${activity.startTime}` >= `${localDate}T${localTime}`);

  if (firebaseConfigured && auth.loading) {
    return <main className="auth-shell"><p role="status">Checking sign-in…</p></main>;
  }

  if (firebaseConfigured && !auth.user) {
    return <SignInScreen busy={false} error={auth.error} onSignIn={() => { void auth.signIn(); }} />;
  }

  if (!firebaseConfigured && import.meta.env.PROD) {
    return <main className="auth-shell"><section className="auth-panel"><h1>Firebase setup required</h1><p>Add the Firebase project settings to the deployment environment before publishing this app.</p></section></main>;
  }

  return (
    <div className="app-shell">
      <main className="main-panel">
        <header className="topbar">
          <a className="brand" href="#home" aria-label="Gala-Nanaman home">
            <span className="brand-mark"><Compass size={20} strokeWidth={2.2} /></span>
            <span className="brand-wordmark">gala<span>·</span>nanaman</span>
          </a>
          <nav className="workspace-tabs" aria-label="Workspace views">
            <button className={currentView === 'trips' ? 'active' : ''} aria-current={currentView === 'trips' ? 'page' : undefined} onClick={() => setCurrentView('trips')}><MapPin size={15} /> Trips <span>{trips.length}</span></button>
            <button className={currentView === 'itinerary' ? 'active' : ''} aria-current={currentView === 'itinerary' ? 'page' : undefined} disabled={!activeTrip} onClick={() => setCurrentView('itinerary')}><ListChecks size={15} /> Itinerary</button>
            <button className={currentView === 'expenses' ? 'active' : ''} aria-current={currentView === 'expenses' ? 'page' : undefined} disabled={!activeTrip} onClick={() => setCurrentView('expenses')}><Receipt size={15} /> Expenses</button>
          </nav>
          <div className="topbar-actions">
            <div className="topbar-status"><span className="status-dot" /> {auth.user?.email ?? 'Local prototype'}</div>
            <button className="icon-button" type="button" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}><SettingsIcon size={16} /></button>
            {auth.user && <button className="icon-button" type="button" aria-label="Sign out" title="Sign out" onClick={() => { void auth.signOut(); }}><LogOut size={15} /></button>}
          </div>
        </header>

        {storageError && <div className="storage-alert" role="status">Trip data could not be loaded or saved. Check your connection and account access.</div>}

        {currentView === 'trips' ? (
          <div className="content-wrap trips-wrap">
            <section className="trips-page-heading">
              <div>
                <div className="eyebrow"><span className="eyebrow-line" /> YOUR TRAVEL PLANS</div>
                <h1>Trips</h1>
                <p>Keep each journey and its itinerary in its own workspace.</p>
              </div>
              <button className="button button-primary add-trip-button" onClick={() => setDialog({ kind: 'trip' })}><Plus size={18} /> Add trip</button>
            </section>

            {trips.length ? (
              <section className="trip-overview-list" aria-label="Saved trips">
                {trips.map((trip, index) => (
                  <article className="trip-overview-row" key={trip.id}>
                    <span className={`overview-trip-marker marker-${index % 3}`}><MapPin size={18} /></span>
                    <div className="overview-trip-main">
                      <h2>{trip.name}</h2>
                      <p>{trip.destination}</p>
                    </div>
                    <div className="overview-trip-dates"><CalendarDays size={15} /><span>{dateRange(trip.startDate, trip.endDate)}</span></div>
                    <div className="overview-trip-count"><strong>{trip.activities.length}</strong><span>activities</span></div>
                    <div className="overview-trip-actions">
                      <button className="icon-button" aria-label={`Edit ${trip.name}`} title="Edit trip" onClick={() => setDialog({ kind: 'trip', trip })}><Pencil size={15} /></button>
                      <button className="button button-outline" onClick={() => { setActiveTripId(trip.id); setCurrentView('itinerary'); }}>Open itinerary <ArrowRight size={15} /></button>
                    </div>
                  </article>
                ))}
              </section>
            ) : loadingTrips ? (
              <div className="empty-state trips-empty-state" role="status">Loading trips…</div>
            ) : (
              <div className="empty-state trips-empty-state">
                <span className="empty-icon"><MapPin size={20} /></span>
                <h3>No trips yet</h3>
                <p>Create a trip to start a separate itinerary workspace.</p>
                <button className="button button-primary add-trip-button" onClick={() => setDialog({ kind: 'trip' })}><Plus size={17} /> Add your first trip</button>
              </div>
            )}
          </div>
        ) : currentView === 'expenses' && activeTrip ? (
          <ExpensesView trip={activeTrip} initialActivityId={expenseActivityId} onSave={saveExpense} onDelete={deleteExpense} />
        ) : activeTrip ? (
          <div className="content-wrap">
            <section className="trip-heading">
              <div className="trip-heading-copy">
                <div className="eyebrow"><span className="eyebrow-line" /> TRIP OVERVIEW</div>
                <div className="title-row">
                  <div>
                    <h1>{activeTrip.name}</h1>
                    <p className="trip-location"><MapPin size={16} /> {activeTrip.destination}</p>
                  </div>
                  <button className="button button-outline edit-trip-button" onClick={() => setDialog({ kind: 'trip', trip: activeTrip })}><Pencil size={15} /> Edit trip</button>
                </div>
                <div className="trip-meta">
                  <span><CalendarDays size={15} /> {dateRange(activeTrip.startDate, activeTrip.endDate)}</span>
                  <span className="meta-divider" />
                  <span><Clock3 size={15} /> {activeTrip.timeZone}</span>
                </div>
              </div>
              <div className="trip-index"><span>TRIP</span><strong>{String(trips.findIndex((trip) => trip.id === activeTrip.id) + 1).padStart(2, '0')}</strong><span>OF {String(trips.length).padStart(2, '0')}</span></div>
            </section>

            <section className="summary-strip" aria-label="Trip summary">
              <div className="summary-item"><span className="summary-label">LENGTH</span><strong>{tripLength(activeTrip.startDate, activeTrip.endDate)} <small>days</small></strong></div>
              <div className="summary-item"><span className="summary-label">PLANNED</span><strong>{activeTrip.activities.length} <small>activities</small></strong></div>
              <div className="summary-item next-up-item"><span className="summary-label">NEXT UP</span><strong>{nextActivity?.title ?? 'Nothing scheduled yet'}</strong></div>
              <button className="button button-primary summary-add" onClick={() => setDialog({ kind: 'activity', trip: activeTrip })}><Plus size={17} /> Add activity</button>
            </section>

            <section className="itinerary-section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-line" /> THE PLAN</div>
                  <h2>Itinerary</h2>
                </div>
                <div className="itinerary-heading-actions">
                  <div className="segmented-control" role="group" aria-label="Itinerary display">
                    <button className={itineraryMode === 'list' ? 'selected' : ''} aria-pressed={itineraryMode === 'list'} onClick={() => setItineraryMode('list')}><List size={15} /> List</button>
                    <button className={itineraryMode === 'map' ? 'selected' : ''} aria-pressed={itineraryMode === 'map'} onClick={() => setItineraryMode('map')}><MapIcon size={15} /> Map</button>
                  </div>
                  {itineraryMode === 'list' && <span className="day-count">{activityDays.length} {activityDays.length === 1 ? 'day planned' : 'days planned'}</span>}
                </div>
              </div>

              {itineraryMode === 'map' ? (
                <RouteMap trip={activeTrip} activities={sortedActivities} timeFormat={settings.timeFormat} />
              ) : activityDays.length ? (
                <div className="day-list">
                  {activityDays.map((date, dayIndex) => {
                    const dayActivities = sortedActivities.filter((activity) => activity.date === date);
                    return (
                      <section className={`day-group ${(activeTrip.completedDayDates ?? []).includes(date) ? 'completed' : ''}`} key={date}>
                        <div className="day-label">
                          <span className="day-number">{String(dayIndex + 1).padStart(2, '0')}</span>
                          <div><h3>{formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</h3><span>{dayActivities.length} {dayActivities.length === 1 ? 'stop' : 'stops'}</span></div>
                          <button className="day-complete-toggle" type="button" aria-pressed={(activeTrip.completedDayDates ?? []).includes(date)} title={(activeTrip.completedDayDates ?? []).includes(date) ? 'Mark day not done' : 'Mark day done'} aria-label={`${(activeTrip.completedDayDates ?? []).includes(date) ? 'Mark' : 'Mark'} ${formatDate(date, { month: 'long', day: 'numeric' })} ${(activeTrip.completedDayDates ?? []).includes(date) ? 'not done' : 'done'}`} onClick={() => { void toggleDayComplete(date); }}>
                            <CircleCheck size={17} />
                          </button>
                        </div>
                        <div className="activity-list">
                          {dayActivities.map((activity) => (
                            <article className={`activity-row category-${activity.category.toLowerCase()}`} key={activity.id}>
                              <div className="activity-time"><strong>{formatTime(activity.startTime, settings.timeFormat)}</strong><span>{formatTime(activity.endTime, settings.timeFormat)}</span></div>
                              <span className="activity-marker" aria-hidden="true">{categoryIcons[activity.category]}</span>
                              <div className="activity-main">
                                <div className="activity-title-line"><h4>{activity.title}</h4><span className={`category-label ${activity.category.toLowerCase()}`}>{activity.category}</span></div>
                                {activity.outfitOfDay && <span className="outfit-label">Outfit of the day</span>}
                                {activity.location && <p className="activity-place"><MapPin size={12} /> {activity.location.label}</p>}
                                {activity.notes && <p>{activity.notes}</p>}
                                {activity.outfitNotes && <p>{activity.outfitNotes}</p>}
                                {activity.photos?.length ? <ActivityPhotoGallery photos={activity.photos} newFiles={[]} readOnly /> : null}
                                {activeTrip.expenses.some((expense) => expense.activityId === activity.id) && <p className="activity-expense-note">Spent {formatAmount(activeTrip.expenses.filter((expense) => expense.activityId === activity.id).reduce((sum, expense) => sum + expense.amountMinor, 0), activeTrip.currencyCode)}</p>}
                              </div>
                              <div className="activity-actions">
                                <button className="icon-button" aria-label={`Edit ${activity.title}`} title="Edit activity" onClick={() => setDialog({ kind: 'activity', trip: activeTrip, activity })}><Pencil size={15} /></button>
                                <button className="icon-button" aria-label={`Add expense for ${activity.title}`} title="Add expense for activity" onClick={() => { setExpenseActivityId(activity.id); setCurrentView('expenses'); }}><Receipt size={15} /></button>
                                <button className="icon-button danger-hover" aria-label={`Remove ${activity.title}`} title="Remove activity" onClick={() => deleteActivity(activity)}><Trash2 size={15} /></button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="empty-icon"><CalendarDays size={20} /></span>
                  <h3>A little room for a plan</h3>
                  <p>Add your first activity to start shaping the days ahead.</p>
                  <button className="button button-outline" onClick={() => setDialog({ kind: 'activity', trip: activeTrip })}><Plus size={16} /> Add the first activity</button>
                </div>
              )}
            </section>
            <footer className="content-footer"><span>Times shown in {activeTrip.timeZone}</span><span>Prototype data stays on this device</span></footer>
          </div>
        ) : (
          <div className="empty-workspace">
            <span className="empty-icon"><Compass size={22} /></span>
            <h1>Choose a trip first.</h1>
            <p>Open a trip from your Trips view to see and edit its itinerary.</p>
            <button className="button button-primary" onClick={() => setCurrentView('trips')}><ArrowRight size={16} /> View trips</button>
          </div>
        )}
      </main>

      {dialog?.kind === 'trip' && <TripDialog key={dialog.trip?.id ?? 'new-trip'} trip={dialog.trip} defaultCurrencyCode={settings.defaultCurrencyCode} onClose={() => setDialog(null)} onSave={saveTrip} />}
      {dialog?.kind === 'activity' && <ActivityDialog key={dialog.activity?.id ?? 'new-activity'} trip={dialog.trip} activity={dialog.activity} onClose={() => setDialog(null)} onSave={saveActivity} />}
      {settingsOpen && <SettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} onSave={updateSettings} />}
    </div>
  );
}

export default function App() {
  return <AppWorkspace />;
}
