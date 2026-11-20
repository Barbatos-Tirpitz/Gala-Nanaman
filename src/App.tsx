import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  ArrowRight,
  Archive,
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
  RotateCcw,
  Settings as SettingsIcon,
  Trash2,
  X,
} from 'lucide-react';
import { createId } from './storage';
import { tripRepository } from './repositories/TripRepository';
import RouteMap from './MapView';
import MapPicker from './MapPicker';
import ActivityPhotoGallery from './ActivityPhotoGallery';
import MemoriesView from './MemoriesView';
import LocationActions from './LocationActions';
import { mapCacheSummary } from './services/mapCache';
import { photoValidationError } from './photoProcessing';
import ModalShell from './ModalShell';
import ExpensesView from './ExpensesView';
import { DailyLimitError, reversePlace, searchPlaces } from './services/geo';
import { fetchExchangeRate } from './services/currency';
import type { Activity, ActivityCategory, Expense, PlaceLocation, Trip } from './types';
import { currencyFractionDigits, formatAmount, parseAmountToMinorUnits } from './money';
import { convertExpense, convertMinorUnits } from './currencyConversion';
import SettingsDialog from './SettingsDialog';
import { formatTime, loadUserSettings, saveUserSettings, type UserSettings } from './settings';
import { deleteLocalPhoto, saveLocalPhoto, type LocalPhotoRef } from './localPhotos';
import { useAuth } from './auth/AuthContext';
import SignInScreen from './auth/SignInScreen';
import { firebaseAuth, firebaseConfigured, firestore } from './firebase';
import { FirestoreTripRepository } from './repositories/FirestoreTripRepository';
import { OfflineTripRepository } from './repositories/OfflineTripRepository';
import { allowOffline, clearOffline, offlineEnabled, readSnapshot, SNAPSHOT_TTL } from './offline';
import { addCalendarDay, isCalendarDate } from './services/calendar';
import { activitySchema, tripSchema } from './validation';
import { useFormFeedback } from './useFormFeedback';

type DialogState =
  | { kind: 'trip'; trip?: Trip }
  | { kind: 'activity'; trip: Trip; activity?: Activity }
  | null;

type AppView = 'trips' | 'itinerary' | 'expenses' | 'memories';

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

type TripDraft = Omit<Trip, 'id' | 'activities' | 'expenses'>;

interface CurrencyConversionPreview {
  values: TripDraft;
  expenses: Expense[];
  sourceCurrencyCode: string;
  targetCurrencyCode: string;
  rate: number;
  rateDate: string;
  previousBudgetMinor: number;
  previousExpenseTotalMinor: number;
}

function TripDialog({
  trip,
  defaultCurrencyCode,
  readOnly = false,
  onClose,
  onSave,
}: {
  trip?: Trip;
  defaultCurrencyCode: string;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (values: TripDraft, id?: string, convertedExpenses?: Expense[]) => Promise<void>;
}) {
  const [budgetError, setBudgetError] = useState('');
  const feedback = useFormFeedback();
  const [draftId] = useState(createId);
  const [selectedCurrencyCode, setSelectedCurrencyCode] = useState(trip?.currencyCode ?? defaultCurrencyCode);
  const [conversionPreview, setConversionPreview] = useState<CurrencyConversionPreview>();
  const [conversionError, setConversionError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isLoadingRate, setIsLoadingRate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function save(values: TripDraft, convertedExpenses?: Expense[]) {
    setIsSaving(true);
    setSaveError('');
    try {
      await onSave(values, trip?.id ?? draftId, convertedExpenses);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save this trip.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || !navigator.onLine || isLoadingRate || isSaving) return;
    const formData = new FormData(event.currentTarget);
    const startDate = String(formData.get('startDate'));
    const endDate = String(formData.get('endDate'));
    const currencyCode = String(formData.get('currencyCode') ?? trip?.currencyCode ?? defaultCurrencyCode);
    const budget = String(formData.get('budget')).trim();
    const budgetCurrencyCode = trip?.currencyCode ?? currencyCode;
    const budgetMinor = budget ? parseAmountToMinorUnits(budget, budgetCurrencyCode) : 0;

    if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || endDate < startDate) {
      setSaveError('Choose valid dates with the end on or after the start.');
      event.currentTarget.elements.namedItem('endDate') && (event.currentTarget.elements.namedItem('endDate') as HTMLInputElement).focus();
      return;
    }
    if (budgetMinor === undefined) {
      setBudgetError(`Enter a valid ${budgetCurrencyCode} amount with up to ${currencyFractionDigits(budgetCurrencyCode)} decimal places.`);
      return;
    }
    setBudgetError('');

    const values: TripDraft = {
      name: String(formData.get('name')).trim(),
      destination: String(formData.get('destination')).trim(),
      startDate,
      endDate,
      timeZone: String(formData.get('timeZone')).trim(),
      currencyCode,
      budgetMinor,
    };
    if (!feedback.validate(event.currentTarget, tripSchema.safeParse({ ...values, id: trip?.id ?? draftId, activities: [], expenses: [] }))) return;

    if (trip && currencyCode !== trip.currencyCode && (budgetMinor > 0 || trip.expenses.length > 0)) {
      setIsLoadingRate(true);
      setConversionError('');
      try {
        const exchange = await fetchExchangeRate(trip.currencyCode, currencyCode);
        const convertedBudgetMinor = convertMinorUnits(budgetMinor, trip.currencyCode, currencyCode, exchange.rate);
        const convertedExpenses = trip.expenses.map((expense) => convertExpense(expense, trip.currencyCode, currencyCode, exchange.rate));
        setConversionPreview({
          values: { ...values, budgetMinor: convertedBudgetMinor },
          expenses: convertedExpenses,
          sourceCurrencyCode: trip.currencyCode,
          targetCurrencyCode: currencyCode,
          rate: exchange.rate,
          rateDate: exchange.date,
          previousBudgetMinor: budgetMinor,
          previousExpenseTotalMinor: trip.expenses.reduce((total, expense) => total + expense.amountMinor, 0),
        });
      } catch (error) {
        setConversionError(error instanceof Error ? error.message : 'Could not retrieve the live exchange rate.');
      } finally {
        setIsLoadingRate(false);
      }
      return;
    }

    await save(values);
  }

  function closeDialog() {
    if (isLoadingRate || isSaving) return;
    onClose();
  }

  return (
    <Modal title={trip ? 'Edit trip details' : 'Create a trip'} onClose={closeDialog}>
      <form className="dialog-form" onSubmit={handleSubmit}>
        {readOnly && <p role="status">Read-only while disconnected. Your draft is kept here.</p>}
        <fieldset className="form-fields" disabled={readOnly || isSaving}>
        <div className="trip-editor-fields" hidden={Boolean(conversionPreview)}>
        <label>
          Trip name
          <input name="name" defaultValue={trip?.name} required maxLength={70} autoFocus {...feedback.field('name')} />
          {feedback.error('name')}
        </label>
        <label>
          Primary destination
          <input name="destination" defaultValue={trip?.destination} required maxLength={80} placeholder="City or region" {...feedback.field('destination')} />
          {feedback.error('destination')}
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
          <input name="timeZone" defaultValue={trip?.timeZone ?? 'America/New_York'} required maxLength={64} placeholder="America/New_York" {...feedback.field('timeZone')} />
          {feedback.error('timeZone')}
          <span className="field-hint">Use an IANA timezone, such as Asia/Tokyo.</span>
        </label>
        <div className="field-row">
          <label>
            Budget ({trip?.currencyCode ?? selectedCurrencyCode}) <span className="optional-label">Optional</span>
            <input name="budget" type="number" min="0" step={1 / (10 ** currencyFractionDigits(trip?.currencyCode ?? selectedCurrencyCode))} defaultValue={trip?.budgetMinor ? trip.budgetMinor / (10 ** currencyFractionDigits(trip.currencyCode)) : ''} placeholder="0" onChange={() => setBudgetError('')} />
          </label>
          <label>
            Currency
            <select name="currencyCode" value={selectedCurrencyCode} disabled={isLoadingRate || isSaving} onChange={(event) => { setSelectedCurrencyCode(event.target.value); setConversionError(''); }}>
              <option value="PHP">PHP · Philippine Peso</option>
              <option value="USD">USD · US Dollar</option>
              <option value="CAD">CAD · Canadian Dollar</option>
              <option value="EUR">EUR · Euro</option>
              <option value="GBP">GBP · British Pound</option>
              <option value="JPY">JPY · Japanese Yen</option>
              <option value="AUD">AUD · Australian Dollar</option>
            </select>
            {trip && <span className="field-hint">The budget is entered in {trip.currencyCode} and converted with the current reference rate.</span>}
          </label>
        </div>
        {budgetError && <p className="form-error" role="alert">{budgetError}</p>}
        {conversionError && <p className="form-error" role="alert">{conversionError}</p>}
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
        <div className="dialog-actions">
          <button className="button button-quiet" type="button" disabled={isLoadingRate || isSaving} onClick={closeDialog}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={isLoadingRate || isSaving}><Check size={16} /> {isLoadingRate ? 'Getting current rate…' : isSaving ? 'Saving…' : 'Save trip'}</button>
        </div>
        </div>
        {conversionPreview && (
          <section className="currency-confirmation" role="alertdialog" aria-labelledby="currency-confirmation-title">
            <h3 id="currency-confirmation-title">Convert this trip to {conversionPreview.targetCurrencyCode}?</h3>
            <p className="currency-rate">1 {conversionPreview.sourceCurrencyCode} = {conversionPreview.rate.toLocaleString(undefined, { maximumSignificantDigits: 8 })} {conversionPreview.targetCurrencyCode}</p>
            <p className="field-hint">Reference rate dated {conversionPreview.rateDate}, from Frankfurter. Your bank or card provider may use a different rate.</p>
            <dl className="currency-conversion-summary">
              <div><dt>Trip budget</dt><dd>{formatAmount(conversionPreview.previousBudgetMinor, conversionPreview.sourceCurrencyCode)} → {formatAmount(conversionPreview.values.budgetMinor, conversionPreview.targetCurrencyCode)}</dd></div>
              <div><dt>Recorded expenses ({conversionPreview.expenses.length})</dt><dd>{formatAmount(conversionPreview.previousExpenseTotalMinor, conversionPreview.sourceCurrencyCode)} → {formatAmount(conversionPreview.expenses.reduce((total, expense) => total + expense.amountMinor, 0), conversionPreview.targetCurrencyCode)}</dd></div>
            </dl>
            {conversionPreview.expenses.length > 0 && (
              <div className="currency-expense-preview" aria-label="Converted expense amounts">
                {conversionPreview.expenses.map((expense, index) => (
                  <div key={expense.id}><span>{expense.title}</span><strong>{formatAmount(trip?.expenses[index].amountMinor ?? 0, conversionPreview.sourceCurrencyCode)} → {formatAmount(expense.amountMinor, conversionPreview.targetCurrencyCode)}</strong></div>
                ))}
              </div>
            )}
            <p className="field-hint">All expense splits will be adjusted to match their converted totals. This replaces the existing amounts; the trip and its expenses are saved together.</p>
            {saveError && <p className="form-error" role="alert">{saveError}</p>}
            <div className="dialog-actions">
              <button className="button button-quiet" type="button" disabled={isSaving} onClick={() => { setConversionPreview(undefined); setSaveError(''); }}>Back</button>
              <button className="button button-primary" type="button" disabled={isSaving} onClick={() => void save(conversionPreview.values, conversionPreview.expenses)}><Check size={16} /> {isSaving ? 'Converting…' : 'Confirm conversion'}</button>
            </div>
          </section>
        )}
        </fieldset>
      </form>
    </Modal>
  );
}

function ActivityDialog({
  trip,
  activity,
  readOnly = false,
  onClose,
  onSave,
}: {
  trip: Trip;
  activity?: Activity;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (values: Omit<Activity, 'id'>, id?: string, photosDiscarded?: boolean) => Promise<void>;
}) {
  const [placeQuery, setPlaceQuery] = useState(activity?.location?.label ?? '');
  const feedback = useFormFeedback();
  const [draftId] = useState(createId);
  const [selectedLocation, setSelectedLocation] = useState<PlaceLocation | undefined>(activity?.location);
  const [placeResults, setPlaceResults] = useState<PlaceLocation[]>([]);
  const [placeSearchState, setPlaceSearchState] = useState<'idle' | 'loading' | 'error' | 'limit'>('idle');
  const defaults = nextActivityDefaults(trip);
  const [activityDate, setActivityDate] = useState(activity?.date ?? defaults.date);
  const [timeError, setTimeError] = useState('');
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [mapPickerCenter, setMapPickerCenter] = useState<PlaceLocation | undefined>(activity?.location ?? trip.activities.find((item) => item.location)?.location);
  const [mapPickerState, setMapPickerState] = useState<'idle' | 'loading' | 'error' | 'limit'>('idle');
  const [activityPhotos, setActivityPhotos] = useState<LocalPhotoRef[]>(activity?.photos ?? []);
  const [outfitPhoto, setOutfitPhoto] = useState<LocalPhotoRef | undefined>(activity?.outfitPhoto ?? undefined);
  const [pendingPhotoFiles, setPendingPhotoFiles] = useState<File[]>([]);
  const [pendingOutfitPhotoFile, setPendingOutfitPhotoFile] = useState<File>();
  const [outfitOfDay, setOutfitOfDay] = useState(activity?.outfitOfDay ?? false);
  const [outfitNotes, setOutfitNotes] = useState(activity?.outfitNotes ?? '');
  const [photoError, setPhotoError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPhotos, setIsSavingPhotos] = useState(false);

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

  function addPhotos(fileList: FileList | null) {
    const incoming = Array.from(fileList ?? []);
    if (!incoming.length) return;
    if (activityPhotos.length + pendingPhotoFiles.length + incoming.length > 5) {
      setPhotoError('You can attach up to five photos to an activity.');
      return;
    }
    const invalid = incoming.map(photoValidationError).find(Boolean);
    if (invalid) {
      setPhotoError(invalid);
      return;
    }

    setPhotoError('');
    setPendingPhotoFiles((current) => [...current, ...incoming]);
  }

  function addOutfitPhoto(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (fileList && fileList.length > 1) {
      setPhotoError('Choose one outfit photo.');
      return;
    }
    const invalid = photoValidationError(file);
    if (invalid) {
      setPhotoError(invalid);
      return;
    }

    setPhotoError('');
    setPendingOutfitPhotoFile(file);
  }

  function removePhoto(photoId: string) {
    setActivityPhotos((current) => current.filter((photo) => photo.id !== photoId));
  }

  function removePendingPhoto(fileIndex: number) {
    setPendingPhotoFiles((current) => current.filter((_, index) => index !== fileIndex));
  }

  function removeOutfitPhoto() {
    setPendingOutfitPhotoFile(undefined);
    setOutfitPhoto(undefined);
  }

  function closeActivityDialog() {
    if (isSaving || isSavingPhotos) return;
    onClose();
  }

  async function saveSelectedPhotos(): Promise<{ photos: LocalPhotoRef[]; outfitPhoto?: LocalPhotoRef; created: LocalPhotoRef[]; failed: boolean }> {
    const savedPhotos: LocalPhotoRef[] = [];
    const created: LocalPhotoRef[] = [];
    try {
      for (const file of pendingPhotoFiles) {
        const saved = await saveLocalPhoto(file);
        savedPhotos.push(saved);
        created.push(saved);
      }
      let savedOutfitPhoto = outfitPhoto;
      if (pendingOutfitPhotoFile) {
        savedOutfitPhoto = await saveLocalPhoto(pendingOutfitPhotoFile);
        created.push(savedOutfitPhoto);
      }
      return { photos: [...activityPhotos, ...savedPhotos], outfitPhoto: savedOutfitPhoto, created, failed: false };
    } catch {
      await Promise.all(created.map((photo) => deleteLocalPhoto(photo.id).catch(() => undefined)));
      throw new Error('Photos could not be saved on this device. Free some storage and retry, or remove the selected photos.');
    }
  }

  async function saveActivityForm(values: Omit<Activity, 'id'>, id: string | undefined, photosDiscarded: boolean) {
    await onSave(values, id, photosDiscarded);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || !navigator.onLine || isSaving || isSavingPhotos) return;
    const formData = new FormData(event.currentTarget);
    const startTime = String(formData.get('startTime'));
    const endTime = String(formData.get('endTime'));
    if (!feedback.validate(event.currentTarget, activitySchema.safeParse({
      id: activity?.id ?? draftId, title: String(formData.get('title')).trim(), date: activityDate,
      startTime, endTime, category: String(formData.get('category')), notes: String(formData.get('notes')).trim(),
    }))) return;
    if (endTime <= startTime) {
      setTimeError('End time must be later than start time. For an overnight stop, add it on the next date.');
      return;
    }
    setTimeError('');

    setIsSaving(true);
    setSaveError('');
    setIsSavingPhotos(true);
    let savedPhotoData: Awaited<ReturnType<typeof saveSelectedPhotos>>;
    try {
      savedPhotoData = await saveSelectedPhotos();
    } catch {
      setSaveError('Photos could not be saved on this device. Free storage and retry, or remove the selected photos.');
      setIsSaving(false);
      return;
    } finally {
      setIsSavingPhotos(false);
    }

    try {
      await saveActivityForm(
        {
          title: String(formData.get('title')).trim(),
          date: String(formData.get('date')),
          startTime,
          endTime,
          category: String(formData.get('category')) as ActivityCategory,
          notes: String(formData.get('notes')).trim(),
          outfitOfDay,
          outfitNotes: outfitNotes.trim(),
          outfitPhoto: savedPhotoData.outfitPhoto ?? null,
          photos: savedPhotoData.photos,
          ...(selectedLocation ? { location: selectedLocation } : {}),
        },
        activity?.id ?? draftId,
        savedPhotoData.failed,
      );
    } catch (error) {
      await Promise.all(savedPhotoData.created.map((photo) => deleteLocalPhoto(photo.id).catch(() => undefined)));
      setSaveError(error instanceof Error ? error.message : 'The activity could not be saved. Your local photos are still available to retry.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal title={activity ? 'Edit activity' : 'Add to the itinerary'} onClose={closeActivityDialog}>
      <form className="dialog-form" onSubmit={handleSubmit}>
        {readOnly && <p role="status">Read-only while disconnected. Your draft is kept here.</p>}
        <fieldset className="form-fields" disabled={readOnly || isSaving}>
        <label>
          Activity
          <input name="title" defaultValue={activity?.title} required maxLength={90} autoFocus placeholder="What are you planning?" {...feedback.field('title')} />
          {feedback.error('title')}
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
            <input name="date" type="date" min={trip.startDate} max={trip.endDate} value={activityDate} onChange={(event) => setActivityDate(event.target.value)} required />
            <button type="button" className="button button-outline" disabled={!isCalendarDate(activityDate) || activityDate >= trip.endDate} onClick={() => setActivityDate(addCalendarDay(activityDate))}><ArrowRight size={15} /> Next day</button>
            {activityDate >= trip.endDate && <span className="field-hint">Last day of this trip.</span>}
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
            <input name="startTime" type="time" defaultValue={activity?.startTime ?? defaults.startTime} required aria-invalid={Boolean(timeError)} aria-describedby={timeError ? 'activity-time-error' : undefined} onChange={() => setTimeError('')} />
          </label>
          <label>
            Ends
            <input name="endTime" type="time" defaultValue={activity?.endTime ?? defaults.endTime} required onChange={() => setTimeError('')} {...feedback.field('endTime')} />
            {feedback.error('endTime')}
          </label>
        </div>
        {timeError && <p id="activity-time-error" className="form-error" role="alert">{timeError}</p>}
        <label>
          Notes <span className="optional-label">Optional</span>
          <textarea name="notes" defaultValue={activity?.notes} rows={3} maxLength={400} placeholder="Reservations, reminders, or useful details" />
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={outfitOfDay} onChange={(event) => setOutfitOfDay(event.target.checked)} />
          <span>Outfit of the day</span>
        </label>
        {outfitOfDay && (
          <>
            <label>
              Outfit notes <span className="optional-label">Optional</span>
              <textarea value={outfitNotes} onChange={(event) => setOutfitNotes(event.target.value)} rows={2} maxLength={300} placeholder="Weather, layers, or packing note" />
            </label>
            <label>
              Outfit photo <span className="optional-label">Optional · saved on this device only</span>
              <input type="file" accept="image/*" disabled={isSaving} onChange={(event) => { addOutfitPhoto(event.target.files); event.target.value = ''; }} />
            </label>
            <ActivityPhotoGallery photos={pendingOutfitPhotoFile ? [] : outfitPhoto ? [outfitPhoto] : []} newFiles={pendingOutfitPhotoFile ? [pendingOutfitPhotoFile] : []} label="Outfit photo" onRemoveStored={removeOutfitPhoto} onRemoveFile={removeOutfitPhoto} />
          </>
        )}
        <label>
          Photos <span className="optional-label">Optional · this device only · 30 MiB per photo</span>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={isSaving}
            onChange={(event) => {
              addPhotos(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
        {isSavingPhotos && <p className="field-hint" role="status">Saving selected photos…</p>}
        <ActivityPhotoGallery photos={activityPhotos} newFiles={pendingPhotoFiles} onRemoveStored={removePhoto} onRemoveFile={removePendingPhoto} />
        {photoError && <p className="form-error" role="alert">{photoError}</p>}
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
        <div className="dialog-actions">
          <button className="button button-quiet" type="button" disabled={isSaving || isSavingPhotos} onClick={closeActivityDialog}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={isSaving || isSavingPhotos}><Check size={16} /> {isSavingPhotos ? 'Saving photos…' : isSaving ? 'Saving activity…' : 'Save activity'}</button>
        </div>
        </fieldset>
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
  const repository = useMemo(() => new OfflineTripRepository(
    firebaseAuth && firestore ? new FirestoreTripRepository(firestore, firebaseAuth) : tripRepository,
    auth.user?.uid,
  ), [auth.user?.uid]);
  const access = useSyncExternalStore(repository.subscribe, repository.getStatus);
  const readOnly = access.mode !== 'online';
  const [offlineConsent, setOfflineConsent] = useState(() => auth.user ? offlineEnabled(auth.user.uid) : false);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [toastError, setToastError] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTripId, setActiveTripId] = useState('');
  const [currentView, setCurrentView] = useState<AppView>('trips');
  const [itineraryMode, setItineraryMode] = useState<'list' | 'map'>('list');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [storageError, setStorageError] = useState(false);
  const [tripRefreshNotice, setTripRefreshNotice] = useState('');
  const [activityPhotoNotice, setActivityPhotoNotice] = useState('');
  const [loadingTrips, setLoadingTrips] = useState(true);
  const [settings, setSettings] = useState<UserSettings>(loadUserSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expenseActivityId, setExpenseActivityId] = useState<string>();
  const [tripListMode, setTripListMode] = useState<'active' | 'archived'>('active');
  const activeTrips = trips.filter((trip) => !trip.archived);
  const archivedTrips = trips.filter((trip) => trip.archived);
  const visibleTrips = tripListMode === 'active' ? activeTrips : archivedTrips;
  const activeTrip = trips.find((trip) => trip.id === activeTripId && !trip.archived);
  const canLoadTrips = !auth.configured || Boolean(auth.user);

  function notify(message: string, error = false) { setToast(message); setToastError(error); }

  useEffect(() => {
    const warning = () => notify('Map lookups could not be saved on this device. Repeated requests may use the network.', true);
    window.addEventListener('map-cache-warning', warning);
    if (auth.user) void mapCacheSummary(auth.user.uid).catch(() => undefined);
    return () => window.removeEventListener('map-cache-warning', warning);
  }, [auth.user?.uid]);

  useEffect(() => {
    if (!toast || toastError) return;
    const timer = window.setTimeout(() => setToast(''), 6000);
    return () => window.clearTimeout(timer);
  }, [toast, toastError]);

  useEffect(() => {
    if (access.mode === 'unavailable') { setTrips([]); setDialog(null); }
  }, [access.mode]);

  useEffect(() => {
    const offline = () => { repository.goOffline(); };
    const online = () => { void refreshTrips().catch(() => { setTrips([]); }); };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    const timer = window.setInterval(() => {
      if (access.mode === 'offline' && access.syncedAt && Date.now() - access.syncedAt >= SNAPSHOT_TTL) {
        setTrips([]);
        repository.invalidate();
        if (auth.user) void readSnapshot(auth.user.uid).catch(() => notify('Expired offline copy could not be removed.', true));
        notify('Offline copy expired. Reconnect to load trips.', true);
      }
    }, 30_000);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.clearInterval(timer);
    };
  }, [repository, access.mode, access.syncedAt]);

  useEffect(() => {
    const storageChanged = () => {
      if (!auth.user) return;
      const enabled = offlineEnabled(auth.user.uid);
      setOfflineConsent(enabled);
      if (!enabled && access.mode === 'offline') { setTrips([]); setDialog(null); repository.invalidate(); }
    };
    window.addEventListener('storage', storageChanged);
    return () => window.removeEventListener('storage', storageChanged);
  }, [auth.user?.uid, access.mode, repository]);

  async function changeOfflineConsent() {
    if (!auth.user || offlineBusy) return;
    if (!offlineConsent && !window.confirm('Keep a read-only copy of trips on this device for up to seven days? Device users may be able to read it. Access revocation cannot be checked offline. Sign-out clears trip snapshots, but not local photos.')) return;
    setOfflineBusy(true);
    try {
      if (offlineConsent) {
        await clearOffline(auth.user.uid);
        setOfflineConsent(false);
        if (readOnly) { setTrips([]); repository.invalidate(); }
        notify('Offline trip copy cleared. Local photos were kept.');
      } else {
        allowOffline(auth.user.uid);
        setOfflineConsent(true);
        await refreshTrips();
        notify('Offline viewing enabled.');
      }
    } catch { notify('Offline storage could not be updated. Retry when connected.', true); }
    finally { setOfflineBusy(false); }
  }

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
        setActiveTripId((current) => loadedTrips.some((trip) => trip.id === current && !trip.archived)
          ? current
          : loadedTrips.find((trip) => !trip.archived)?.id ?? '');
        setStorageError(false);
      })
      .catch(() => {
        if (active) { setTrips([]); setStorageError(true); }
      })
      .finally(() => {
        if (active) setLoadingTrips(false);
      });

    return () => { active = false; repository.invalidate(); };
  }, [repository, canLoadTrips, auth.user?.uid]);

  async function refreshTrips(): Promise<void> {
    let loadedTrips: Trip[];
    try { loadedTrips = await repository.listTrips(); }
    catch (error) { setTrips([]); throw error; }
    setTrips(loadedTrips);
    setActiveTripId((current) => loadedTrips.some((trip) => trip.id === current && !trip.archived)
      ? current
      : loadedTrips.find((trip) => !trip.archived)?.id ?? '');
    setStorageError(false);
    setTripRefreshNotice('');
  }

  async function setTripArchived(trip: Trip, archived: boolean) {
    const action = archived ? 'Archive' : 'Restore';
    const detail = archived
      ? 'It will be hidden from active trips. Its activities, expenses, and photos will be kept.'
      : 'It will return to your active trips.';
    if (!window.confirm(`${action} "${trip.name}"? ${detail}`)) return;

    try {
      await repository.setTripArchived(trip.id, archived);
      notify(archived ? 'Trip archived.' : 'Trip restored.');
      await refreshTrips();
      if (archived && activeTripId === trip.id) setCurrentView('trips');
      if (!archived && !activeTripId) setActiveTripId(trip.id);
    } catch {
      setStorageError(true);
      notify('Trip status could not be changed.', true);
    }
  }

  function updateSettings(nextSettings: UserSettings) {
    try {
      saveUserSettings(nextSettings);
      setSettings(nextSettings);
      notify('Settings saved.');
    } catch {
      setStorageError(true);
      notify('Settings could not be saved.', true);
      throw new Error('Settings could not be saved.');
    }
  }

  async function saveTrip(values: Omit<Trip, 'id' | 'activities' | 'expenses'>, id?: string, convertedExpenses?: Expense[]) {
    const existing = id ? trips.find((trip) => trip.id === id) : undefined;
    const savedTrip: Trip = existing
      ? { ...existing, ...values, ...(convertedExpenses ? { expenses: convertedExpenses } : {}) }
      : { ...values, id: createId(), activities: [], expenses: [] };

    try {
      if (convertedExpenses) await repository.saveCurrencyConversion(savedTrip);
      else await repository.saveTrip(savedTrip);
    } catch {
      setStorageError(true);
      notify('Trip could not be saved.', true);
      throw new Error('Trip could not be saved. Check the fields and connection, then retry.');
    }

    try {
      await refreshTrips();
    } catch {
      setTripRefreshNotice('Trip saved, but the latest trip list could not be refreshed. Reload the page to sync the view.');
      setTrips((current) => current.some((trip) => trip.id === savedTrip.id)
        ? current.map((trip) => trip.id === savedTrip.id ? savedTrip : trip)
        : [...current, savedTrip]);
    }
    if (!existing) {
      setActiveTripId(savedTrip.id);
      setCurrentView('itinerary');
    }
    setDialog(null);
    notify('Trip saved.');
  }

  async function saveActivity(values: Omit<Activity, 'id'>, id?: string, photosDiscarded = false) {
    if (dialog?.kind !== 'activity') return;
    const { trip } = dialog;
    const existing = trip.activities.find((activity) => activity.id === id);
    const activity: Activity = existing ? { ...existing, ...values } : { ...values, id: createId() };
    try {
      await repository.saveActivity(trip.id, activity);
      notify('Activity saved.');
    } catch {
      setStorageError(true);
      throw new Error('Could not save this activity.');
    }
    setActivityPhotoNotice(photosDiscarded ? 'Activity saved. Some photos could not be stored on this device and were discarded.' : '');
    const retainedPhotoIds = new Set([...(activity.photos ?? []).map((photo) => photo.id), activity.outfitPhoto?.id]);
    const previousPhotos = [...(existing?.photos ?? []), ...(existing?.outfitPhoto ? [existing.outfitPhoto] : [])];
    await Promise.all(previousPhotos.filter((photo) => !retainedPhotoIds.has(photo.id)).map((photo) => deleteLocalPhoto(photo.id).catch(() => undefined)));
    setDialog(null);
    try { await refreshTrips(); } catch { setStorageError(true); }
  }

  async function deleteActivity(activity: Activity) {
    if (!activeTrip || !window.confirm(`Remove "${activity.title}" from the itinerary?`)) return;
    try {
      await repository.deleteActivity(activeTrip.id, activity.id);
      notify('Activity removed.');
      await Promise.all([...(activity.photos ?? []), ...(activity.outfitPhoto ? [activity.outfitPhoto] : [])].map((photo) => deleteLocalPhoto(photo.id).catch(() => undefined)));
      await refreshTrips();
    } catch {
      setStorageError(true);
    }
  }

  async function saveExpense(expense: Expense) {
    if (!activeTrip) return;
    try {
      await repository.saveExpense(activeTrip.id, expense);
      notify('Expense saved.');
    } catch {
      setStorageError(true);
      notify('Expense could not be saved.', true);
      throw new Error('Expense could not be saved. Check the fields and connection, then retry.');
    }
    try { await refreshTrips(); } catch { notify('Expense saved, but the latest list could not be refreshed.', true); }
  }

  async function deleteExpense(expense: Expense) {
    if (!activeTrip || !window.confirm(`Delete "${expense.title}" from expenses?`)) return;
    try {
      await repository.deleteExpense(activeTrip.id, expense.id);
      notify('Expense removed.');
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
      notify(completedDates.has(date) ? 'Day completed. Added to Memories.' : 'Day marked not done.');
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
            <button className={currentView === 'memories' ? 'active' : ''} aria-current={currentView === 'memories' ? 'page' : undefined} onClick={() => setCurrentView('memories')}><CalendarDays size={15} /> Memories</button>
            <button className={currentView === 'trips' ? 'active' : ''} aria-current={currentView === 'trips' ? 'page' : undefined} onClick={() => setCurrentView('trips')}><MapPin size={15} /> Trips <span>{activeTrips.length}</span></button>
            <button className={currentView === 'itinerary' ? 'active' : ''} aria-current={currentView === 'itinerary' ? 'page' : undefined} disabled={!activeTrip} onClick={() => setCurrentView('itinerary')}><ListChecks size={15} /> Itinerary</button>
            <button className={currentView === 'expenses' ? 'active' : ''} aria-current={currentView === 'expenses' ? 'page' : undefined} disabled={!activeTrip} onClick={() => setCurrentView('expenses')}><Receipt size={15} /> Expenses</button>
          </nav>
          <div className="topbar-actions">
            <div className="topbar-status"><span className="status-dot" /><span className="account-email" title={auth.user?.email ?? 'Local prototype'}>{auth.user?.email ?? 'Local prototype'}</span></div>
            <button className="icon-button" type="button" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}><SettingsIcon size={16} /></button>
            {auth.user && <button className="icon-button" type="button" aria-label="Sign out" title="Sign out" onClick={() => { void auth.signOut(); }}><LogOut size={15} /></button>}
          </div>
        </header>

        <div className="offline-toolbar">
          <span role="status">{readOnly ? access.message || 'Checking connection...' : 'Online'}{access.syncedAt ? ` · Last synced ${new Date(access.syncedAt).toLocaleString()}` : ''}</span>
          {access.message && !readOnly && <span role="status">{access.message}</span>}
          <button type="button" className="icon-button" aria-label="Refresh trips" title="Refresh trips" onClick={() => { void refreshTrips().catch(() => notify('Trips could not be refreshed.', true)); }}><RotateCcw size={16} /></button>
          {auth.user && <label className="offline-toggle"><input type="checkbox" checked={offlineConsent} disabled={offlineBusy || (!offlineConsent && readOnly)} onChange={() => { void changeOfflineConsent(); }} /> Offline copy</label>}
        </div>
        {toast && <div className={`app-toast ${toastError ? 'toast-error' : ''}`} role={toastError ? 'alert' : 'status'}><span>{toast}</span><button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => setToast('')}><X size={16} /></button></div>}
        {auth.error && <p className="storage-alert" role="alert">{auth.error}</p>}

        {storageError && <div className="storage-alert" role="status">{auth.configured
          ? 'Firestore could not load or save trip data. Check your connection and sign-in; each trip is saved with the signed-in user UID as ownerId, and Firestore Rules must allow that owner.'
          : 'Firebase is not configured in this browser. Trip data is using local prototype storage, not a database. Configure .env.local to connect Firestore.'}</div>}
        {tripRefreshNotice && <div className="photo-save-notice" role="status">{tripRefreshNotice}</div>}
        {activityPhotoNotice && <div className="photo-save-notice" role="status">{activityPhotoNotice}</div>}

        <div hidden={currentView !== 'memories'}><MemoriesView trips={trips} timeFormat={settings.timeFormat} /></div>
        {currentView === 'memories' ? null : currentView === 'trips' ? (
          <div className="content-wrap trips-wrap">
            <section className="trips-page-heading">
              <div>
                <div className="eyebrow"><span className="eyebrow-line" /> YOUR TRAVEL PLANS</div>
                <h1>Trips</h1>
                <p>Keep each journey and its itinerary in its own workspace.</p>
              </div>
              <button className="button button-primary add-trip-button" disabled={readOnly} onClick={() => setDialog({ kind: 'trip' })}><Plus size={18} /> Add trip</button>
            </section>

            {trips.length ? (
              <>
                <div className="trip-list-mode segmented-control" role="group" aria-label="Trip status">
                  <button className={tripListMode === 'active' ? 'selected' : ''} aria-pressed={tripListMode === 'active'} onClick={() => setTripListMode('active')}>Active <span>{activeTrips.length}</span></button>
                  <button className={tripListMode === 'archived' ? 'selected' : ''} aria-pressed={tripListMode === 'archived'} onClick={() => setTripListMode('archived')}>Archived <span>{archivedTrips.length}</span></button>
                </div>
                {visibleTrips.length ? <section className="trip-overview-list" aria-label={tripListMode === 'active' ? 'Active trips' : 'Archived trips'}>
                {visibleTrips.map((trip, index) => (
                  <article className="trip-overview-row" key={trip.id}>
                    <span className={`overview-trip-marker marker-${index % 3}`}><MapPin size={18} /></span>
                    <div className="overview-trip-main">
                      <h2>{trip.name}</h2>
                      <p>{trip.destination}</p>
                    </div>
                    <div className="overview-trip-dates"><CalendarDays size={15} /><span>{dateRange(trip.startDate, trip.endDate)}</span></div>
                    <div className="overview-trip-count"><strong>{trip.activities.length}</strong><span>activities</span></div>
                    <div className="overview-trip-actions">
                      {trip.archived ? (
                        <button className="icon-button" disabled={readOnly} aria-label={`Restore ${trip.name}`} title="Restore trip" onClick={() => { void setTripArchived(trip, false); }}><RotateCcw size={15} /></button>
                      ) : (
                        <>
                          <button className="icon-button" disabled={readOnly} aria-label={`Edit ${trip.name}`} title="Edit trip" onClick={() => setDialog({ kind: 'trip', trip })}><Pencil size={15} /></button>
                          <button className="icon-button" disabled={readOnly} aria-label={`Archive ${trip.name}`} title="Archive trip" onClick={() => { void setTripArchived(trip, true); }}><Archive size={15} /></button>
                          <button className="button button-outline" onClick={() => { setActiveTripId(trip.id); setCurrentView('itinerary'); }}>Open itinerary <ArrowRight size={15} /></button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
                </section> : <div className="empty-state trips-empty-state"><span className="empty-icon">{tripListMode === 'archived' ? <Archive size={20} /> : <MapPin size={20} />}</span><h3>No {tripListMode} trips</h3><p>{tripListMode === 'archived' ? 'Archived trips will appear here and can be restored.' : 'Create a trip to start a separate itinerary workspace.'}</p>{tripListMode === 'active' && <button className="button button-primary add-trip-button" onClick={() => setDialog({ kind: 'trip' })}><Plus size={17} /> Add your first trip</button>}</div>}
              </>
            ) : loadingTrips ? (
              <div className="empty-state trips-empty-state" role="status">Loading trips…</div>
            ) : (
              <div className="empty-state trips-empty-state">
                <span className="empty-icon"><MapPin size={20} /></span>
                <h3>No trips yet</h3>
                <p>Create a trip to start a separate itinerary workspace.</p>
                <button className="button button-primary add-trip-button" disabled={readOnly} onClick={() => setDialog({ kind: 'trip' })}><Plus size={17} /> Add your first trip</button>
              </div>
            )}
          </div>
        ) : currentView === 'expenses' && activeTrip ? (
          <ExpensesView trip={activeTrip} readOnly={readOnly} initialActivityId={expenseActivityId} onSave={saveExpense} onDelete={deleteExpense} />
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
                  <button className="button button-outline edit-trip-button" disabled={readOnly} onClick={() => setDialog({ kind: 'trip', trip: activeTrip })}><Pencil size={15} /> Edit trip</button>
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
              <button className="button button-primary summary-add" disabled={readOnly} onClick={() => setDialog({ kind: 'activity', trip: activeTrip })}><Plus size={17} /> Add activity</button>
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
                readOnly ? <p>Map services are unavailable offline. Recorded places remain in the list.</p> : <RouteMap trip={activeTrip} activities={sortedActivities} timeFormat={settings.timeFormat} />
              ) : activityDays.length ? (
                <div className="day-list">
                  {activityDays.map((date, dayIndex) => {
                    const dayActivities = sortedActivities.filter((activity) => activity.date === date);
                    return (
                      <section className={`day-group ${(activeTrip.completedDayDates ?? []).includes(date) ? 'completed' : ''}`} key={date}>
                        <div className="day-label">
                          <span className="day-number">{String(dayIndex + 1).padStart(2, '0')}</span>
                          <div><h3>{formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</h3><span>{dayActivities.length} {dayActivities.length === 1 ? 'stop' : 'stops'}</span></div>
                          <button className="day-complete-toggle" type="button" disabled={readOnly} aria-pressed={(activeTrip.completedDayDates ?? []).includes(date)} title={(activeTrip.completedDayDates ?? []).includes(date) ? 'Mark day not done' : 'Mark day done'} aria-label={`Mark ${formatDate(date, { month: 'long', day: 'numeric' })} ${(activeTrip.completedDayDates ?? []).includes(date) ? 'not done' : 'done'}`} onClick={() => { void toggleDayComplete(date); }}>
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
                                {activity.location && <LocationActions place={activity.location} />}
                                {activity.notes && <p>{activity.notes}</p>}
                                {activity.outfitNotes && <p>{activity.outfitNotes}</p>}
                                {activity.outfitPhoto && <ActivityPhotoGallery photos={[activity.outfitPhoto]} newFiles={[]} readOnly label="Outfit photo" />}
                                {activity.photos?.length ? <ActivityPhotoGallery photos={activity.photos} newFiles={[]} readOnly /> : null}
                                {activeTrip.expenses.some((expense) => expense.activityId === activity.id) && <p className="activity-expense-note">Spent {formatAmount(activeTrip.expenses.filter((expense) => expense.activityId === activity.id).reduce((sum, expense) => sum + expense.amountMinor, 0), activeTrip.currencyCode)}</p>}
                              </div>
                              <div className="activity-actions">
                                <button className="icon-button" disabled={readOnly} aria-label={`Edit ${activity.title}`} title="Edit activity" onClick={() => setDialog({ kind: 'activity', trip: activeTrip, activity })}><Pencil size={15} /></button>
                                <button className="icon-button" disabled={readOnly} aria-label={`Add expense for ${activity.title}`} title="Add expense for activity" onClick={() => { setExpenseActivityId(activity.id); setCurrentView('expenses'); }}><Receipt size={15} /></button>
                                <button className="icon-button danger-hover" disabled={readOnly} aria-label={`Remove ${activity.title}`} title="Remove activity" onClick={() => deleteActivity(activity)}><Trash2 size={15} /></button>
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
                  <button className="button button-outline" disabled={readOnly} onClick={() => setDialog({ kind: 'activity', trip: activeTrip })}><Plus size={16} /> Add the first activity</button>
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

      {dialog?.kind === 'trip' && <TripDialog key={dialog.trip?.id ?? 'new-trip'} trip={dialog.trip} readOnly={readOnly} defaultCurrencyCode={settings.defaultCurrencyCode} onClose={() => setDialog(null)} onSave={saveTrip} />}
      {dialog?.kind === 'activity' && <ActivityDialog key={dialog.activity?.id ?? 'new-activity'} trip={dialog.trip} activity={dialog.activity} readOnly={readOnly} onClose={() => setDialog(null)} onSave={saveActivity} />}
      {settingsOpen && <SettingsDialog settings={settings} cacheUid={auth.user?.uid} offlineCopyEnabled={offlineConsent} onCacheNotice={notify} onClose={() => setSettingsOpen(false)} onSave={updateSettings} />}
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  return <AppWorkspace key={auth.user?.uid ?? 'signed-out'} />;
}
