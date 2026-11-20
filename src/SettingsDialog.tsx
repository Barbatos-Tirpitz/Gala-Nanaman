import { useEffect, useState, type FormEvent } from 'react';
import { Check, Trash2 } from 'lucide-react';
import ModalShell from './ModalShell';
import type { UserSettings } from './settings';
import { allowMapHistory, clearMapLookups, mapCacheSummary, mapHistoryEnabled } from './services/mapCache';

export default function SettingsDialog({
  settings,
  onClose,
  onSave,
  cacheUid,
  offlineCopyEnabled = false,
  onCacheNotice,
}: {
  settings: UserSettings;
  onClose: () => void;
  onSave: (settings: UserSettings) => void;
  cacheUid?: string;
  offlineCopyEnabled?: boolean;
  onCacheNotice?: (message: string, error?: boolean) => void;
}) {
  const [timeFormat, setTimeFormat] = useState(settings.timeFormat);
  const [defaultCurrencyCode, setDefaultCurrencyCode] = useState(settings.defaultCurrencyCode);
  const [error, setError] = useState('');
  const [historyEnabled, setHistoryEnabled] = useState(() => Boolean(cacheUid && offlineCopyEnabled && mapHistoryEnabled(cacheUid)));
  const [cacheBusy, setCacheBusy] = useState(false);
  const [summary, setSummary] = useState({ count: 0, bytes: 0 });
  const [cacheError, setCacheError] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = () => {
      setHistoryEnabled(Boolean(cacheUid && offlineCopyEnabled && mapHistoryEnabled(cacheUid)));
      if (cacheUid) void mapCacheSummary(cacheUid).then((value) => { if (active) setSummary(value); }).catch(() => { if (active) setCacheError('Map lookup storage is unavailable on this device.'); });
    };
    refresh();
    window.addEventListener('storage', refresh);
    return () => { active = false; window.removeEventListener('storage', refresh); };
  }, [cacheUid, offlineCopyEnabled]);

  async function changeMapHistory() {
    if (!cacheUid || !offlineCopyEnabled || cacheBusy) return;
    if (!historyEnabled && !window.confirm('Store place searches and coordinates on this device for up to seven days? This reveals travel history to device users. It is separate from personal photos and browser-managed map tiles. Sign-out clears app-managed lookups.')) return;
    const enable = !historyEnabled;
    setHistoryEnabled(enable);
    setCacheBusy(true);
    setCacheError('');
    try {
      if (!enable) await clearMapLookups(cacheUid, true);
      else allowMapHistory(cacheUid);
      setHistoryEnabled(mapHistoryEnabled(cacheUid));
      setSummary(await mapCacheSummary(cacheUid));
    } catch { setCacheError('Map history could not be updated. Retry or clear browser data on shared devices.'); }
    finally { setHistoryEnabled(mapHistoryEnabled(cacheUid)); setCacheBusy(false); }
  }

  async function clearCachedLookups() {
    if (!cacheUid || cacheBusy) return;
    setCacheBusy(true);
    setCacheError('');
    try {
      await clearMapLookups(cacheUid);
      setSummary({ count: 0, bytes: 0 });
      onCacheNotice?.('Cached map lookups cleared. Photos and browser-managed tiles were kept.');
    } catch {
      setCacheError('Some map lookups could not be removed. Retry or clear browser data.');
      onCacheNotice?.('Map lookups could not be fully cleared.', true);
    } finally { setCacheBusy(false); }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      onSave({ timeFormat, defaultCurrencyCode });
      onClose();
    } catch { setError('Settings could not be saved on this device. Retry after checking browser storage.'); }
  }

  return (
    <ModalShell title="Settings" onClose={onClose}>
      <form className="dialog-form" onSubmit={handleSubmit}>
        <div className="settings-option">
          <div><strong>Time display</strong><span>Applies to itinerary and map stop times.</span></div>
          <div className="segmented-control" role="group" aria-label="Time format">
            <button type="button" className={timeFormat === '12h' ? 'selected' : ''} aria-pressed={timeFormat === '12h'} onClick={() => setTimeFormat('12h')}>12-hour</button>
            <button type="button" className={timeFormat === '24h' ? 'selected' : ''} aria-pressed={timeFormat === '24h'} onClick={() => setTimeFormat('24h')}>24-hour</button>
          </div>
        </div>
        <label>
          Default currency for new trips
          <select value={defaultCurrencyCode} onChange={(event) => setDefaultCurrencyCode(event.target.value)}>
            <option value="PHP">PHP · Philippine Peso</option>
            <option value="USD">USD · US Dollar</option>
            <option value="CAD">CAD · Canadian Dollar</option>
            <option value="EUR">EUR · Euro</option>
            <option value="GBP">GBP · British Pound</option>
            <option value="JPY">JPY · Japanese Yen</option>
            <option value="AUD">AUD · Australian Dollar</option>
          </select>
          <span className="field-hint">Existing trips keep their currency.</span>
        </label>
        <section className="map-cache-settings" aria-labelledby="map-cache-heading">
          <h3 id="map-cache-heading">Map lookup storage</h3>
          <label className="toggle-row"><input type="checkbox" checked={historyEnabled} disabled={!cacheUid || !offlineCopyEnabled || cacheBusy} onChange={() => { void changeMapHistory(); }} /> Keep map lookups on this device</label>
          {!cacheUid ? <p className="field-hint">Sign in to enable saved map lookups.</p> : !offlineCopyEnabled ? <p className="field-hint">Enable Offline copy first.</p> : null}
          <p className="field-hint">Place queries and coordinates are kept for at most seven days. Map tiles stay browser-managed; offline map downloads are not available.</p>
          <p role="status">{summary.count} saved lookups · {(summary.bytes / 1024).toFixed(1)} KiB / 5 MiB</p>
          {cacheBusy && <p role="status">Updating map storage...</p>}
          <button type="button" className="button button-outline" disabled={!cacheUid || cacheBusy} onClick={() => { void clearCachedLookups(); }}><Trash2 size={15} /> Clear cached lookups</button>
          {cacheError && <p className="form-error" role="alert">{cacheError}</p>}
        </section>
        <div className="dialog-actions">
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-quiet" type="button" disabled={cacheBusy} onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={cacheBusy}><Check size={16} /> Save settings</button>
        </div>
      </form>
    </ModalShell>
  );
}
