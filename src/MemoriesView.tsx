import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import type { Trip } from './types';
import { memoryDays } from './services/memories';
import { formatTime } from './settings';
import ActivityPhotoGallery from './ActivityPhotoGallery';
import LocationActions from './LocationActions';

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

export default function MemoriesView({ trips, timeFormat }: { trips: Trip[]; timeFormat: '12h' | '24h' }) {
  const days = memoryDays(trips);
  const today = new Date();
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [selected, setSelected] = useState(days.at(-1)?.date ?? todayDate);
  const [month, setMonth] = useState(selected.slice(0, 7));
  const grid = useRef<HTMLDivElement>(null);
  const initialized = useRef(days.length > 0);
  useEffect(() => {
    if (initialized.current || !days.length) return;
    const latest = days.at(-1)!.date;
    initialized.current = true;
    setSelected(latest);
    setMonth(latest.slice(0, 7));
  }, [trips]);
  const first = new Date(`${month}-01T12:00:00Z`);
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const marked = new Set(days.map((day) => day.date));
  const visible = days.filter((day) => day.date === selected);

  function moveMonth(amount: number) {
    const next = new Date(first);
    next.setUTCMonth(next.getUTCMonth() + amount);
    setMonth(next.toISOString().slice(0, 7));
  }

  function focusDate(date: string, offset: number) {
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + offset);
    const value = next.toISOString().slice(0, 10);
    setSelected(value);
    setMonth(value.slice(0, 7));
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-date="${value}"]`)?.focus());
  }

  return <section className="content-wrap memories-wrap">
    <h1>Memories</h1>
    <div className="memory-layout">
      <div>
        <div className="calendar-heading">
          <button className="icon-button" aria-label="Previous month" title="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={18} /></button>
          <h2 aria-live="polite">{new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)}</h2>
          <button className="icon-button" aria-label="Next month" title="Next month" onClick={() => moveMonth(1)}><ChevronRight size={18} /></button>
        </div>
        <div className="memory-calendar" ref={grid} role="group" aria-label="Memory calendar">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="weekday" key={day}>{day}</span>)}
          {Array.from({ length: first.getUTCDay() }, (_, index) => <span key={`blank-${index}`} />)}
          {Array.from({ length: count }, (_, index) => {
            const date = `${month}-${String(index + 1).padStart(2, '0')}`;
            return <button key={date} data-date={date} tabIndex={date === (selected.startsWith(month) ? selected : `${month}-01`) ? 0 : -1} className={marked.has(date) ? 'has-memory' : ''} aria-pressed={selected === date} aria-current={date === todayDate ? 'date' : undefined} aria-label={`${dateLabel(date)}${marked.has(date) ? ', completed' : ''}`} onClick={() => setSelected(date)} onKeyDown={(event) => {
              const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
              if (offset) { event.preventDefault(); focusDate(date, offset); }
            }}>{index + 1}{marked.has(date) && <span aria-hidden="true">•</span>}</button>;
          })}
        </div>
      </div>
      <div className="memory-timeline">
        <h2 aria-live="polite">{dateLabel(selected)}</h2>
        {!days.length ? <p>No completed days yet.</p> : !visible.length ? <p>No completed days on this date.</p> : null}
        {visible.map((day) => <section key={day.tripId} className="memory-day">
          <h3>{day.tripName}</h3><p className="field-hint">{day.timeZone}</p>
          {!day.activities.length && <p>No activities recorded.</p>}
          {day.activities.map((activity) => <article key={activity.id} className="memory-stop">
            <p className="memory-time">{formatTime(activity.startTime, timeFormat)} – {formatTime(activity.endTime, timeFormat)}</p>
            <h4>{activity.title}</h4>
            {activity.location && <p><MapPin size={14} /> {activity.location.label}</p>}
            {activity.location && <LocationActions place={activity.location} />}
            {activity.notes && <p>{activity.notes}</p>}
            {activity.outfitNotes && <p>{activity.outfitNotes}</p>}
            <ActivityPhotoGallery photos={activity.photos ?? []} newFiles={[]} readOnly />
            {activity.outfitPhoto && <ActivityPhotoGallery photos={[activity.outfitPhoto]} newFiles={[]} readOnly label="Outfit photo" />}
          </article>)}
        </section>)}
      </div>
    </div>
  </section>;
}