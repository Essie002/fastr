import { useState } from 'react';
import { formatDuration, type CompletedFast, type TimeZone } from '@fastr/shared';
import { MoodPicker } from './MoodPicker.js';
import { validateFastTimes } from '../time/validateFastTimes.js';

/**
 * Editing a finished fast. Requirements 9.3 and 13.1.
 *
 * `datetime-local` inputs, which means a value in the browser's own zone rather than the user's configured
 * one. Those are the same thing for almost everybody, and the alternative — a bespoke date and time picker
 * that respects a configured zone — is a lot of component for a difference most people never see. The form
 * says which zone it is editing in so the two are not silently conflated.
 *
 * The ordering rule is checked here for a readable message and again by the database, which is what makes it
 * true.
 */
export function EditFastForm({
  fast,
  timeZone,
  busy,
  onSubmit,
  onCancel,
  onDelete,
}: {
  fast: CompletedFast;
  timeZone: TimeZone;
  busy: boolean;
  onSubmit: (input: {
    startAt: string;
    endedAt: string;
    status: 'completed' | 'ended_early';
    mood: number | null;
    energy: number | null;
    note: string | null;
  }) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [startAt, setStartAt] = useState(() => toLocalInput(fast.startAt));
  const [endedAt, setEndedAt] = useState(() => toLocalInput(fast.endedAt));
  const [mood, setMood] = useState<number | null>(fast.mood);
  const [energy, setEnergy] = useState<number | null>(fast.energy);
  const [note, setNote] = useState(fast.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);

    const checked = validateFastTimes(startAt, endedAt);
    if (!checked.ok) {
      setProblem(checked.problem);
      return;
    }

    const { startMs: start, endMs: end } = checked.times;
    const minutes = (end - start) / 60_000;

    onSubmit({
      startAt: new Date(start).toISOString(),
      endedAt: new Date(end).toISOString(),
      // Recomputed from the edited times, so correcting a time also corrects whether the goal was met —
      // otherwise a fast stretched past its goal would still read as ended early.
      status: minutes >= fast.goalMinutes ? 'completed' : 'ended_early',
      mood,
      energy,
      note: note.trim() === '' ? null : note.trim(),
    });
  }

  const start = Date.parse(startAt);
  const end = Date.parse(endedAt);
  const preview =
    Number.isNaN(start) || Number.isNaN(end) || end <= start
      ? null
      : formatDuration((end - start) / 60_000);

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-labelledby="edit-fast-heading">
      <h2 id="edit-fast-heading">Edit this fast</h2>
      <p className="field__hint">
        Times are in this device&apos;s zone. Your account is set to {timeZone}.
      </p>

      <div className="field">
        <label className="field__label" htmlFor="edit-start">
          Started
        </label>
        <input
          id="edit-start"
          className="field__input"
          type="datetime-local"
          value={startAt}
          disabled={busy}
          onChange={(event) => setStartAt(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="edit-end">
          Ended
        </label>
        <input
          id="edit-end"
          className="field__input"
          type="datetime-local"
          value={endedAt}
          disabled={busy}
          onChange={(event) => setEndedAt(event.target.value)}
        />
      </div>

      {preview && (
        <p className="muted" role="status">
          That is {preview}, against a goal of {formatDuration(fast.goalMinutes)}.
        </p>
      )}

      <MoodPicker
        mood={mood}
        energy={energy}
        note={note}
        onMoodChange={setMood}
        onEnergyChange={setEnergy}
        onNoteChange={setNote}
        disabled={busy}
      />

      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}

      <div className="notice__actions">
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button
          className="button button--secondary"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>

      {confirmingDelete ? (
        <div className="notice notice--danger" role="alertdialog" aria-labelledby="delete-heading">
          <h2 id="delete-heading">Delete this fast?</h2>
          <p>It will be removed from your history and your streaks. This cannot be undone.</p>
          <div className="notice__actions">
            <button
              type="button"
              className="button button--danger"
              onClick={onDelete}
              disabled={busy}
            >
              Delete
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setConfirmingDelete(false)}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="button button--link"
          onClick={() => setConfirmingDelete(true)}
        >
          Delete this fast
        </button>
      )}
    </form>
  );
}

/**
 * An ISO instant as `datetime-local` wants it: `YYYY-MM-DDTHH:mm`, in local time, no zone.
 *
 * Built from the date parts rather than by slicing `toISOString()`, which would hand the control a UTC time
 * and shift every edit by the device's offset.
 */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
