import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import ModalShell from './ModalShell';
import type { UserSettings } from './settings';

export default function SettingsDialog({
  settings,
  onClose,
  onSave,
}: {
  settings: UserSettings;
  onClose: () => void;
  onSave: (settings: UserSettings) => void;
}) {
  const [timeFormat, setTimeFormat] = useState(settings.timeFormat);
  const [defaultCurrencyCode, setDefaultCurrencyCode] = useState(settings.defaultCurrencyCode);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ timeFormat, defaultCurrencyCode });
    onClose();
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
        <div className="dialog-actions">
          <button className="button button-quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit"><Check size={16} /> Save settings</button>
        </div>
      </form>
    </ModalShell>
  );
}
