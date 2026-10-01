import { MAX_NOTE_LENGTH } from '@fastr/shared';

/**
 * Mood, energy and a note. Requirement 13.
 *
 * Each scale is a radio group, which is what it is: five mutually exclusive options. Radios arrive keyboard
 * operable with arrow keys and announce "3 of 5" without any work, where a row of buttons would need
 * `aria-pressed`, its own key handling, and a roving tab index to match.
 *
 * Both scales allow being cleared. A fast nobody rated should not silently read as the middle value.
 */
export function MoodPicker({
  mood,
  energy,
  note,
  onMoodChange,
  onEnergyChange,
  onNoteChange,
  disabled,
}: {
  mood: number | null;
  energy: number | null;
  note: string;
  onMoodChange: (value: number | null) => void;
  onEnergyChange: (value: number | null) => void;
  onNoteChange: (value: string) => void;
  // `| undefined` spelled out because `exactOptionalPropertyTypes` is on: without it, forwarding an optional
  // prop to a child that also declares it optional is an error.
  disabled?: boolean | undefined;
}) {
  return (
    <>
      <Scale
        name="mood"
        legend="How did you feel?"
        lowLabel="Rough"
        highLabel="Great"
        value={mood}
        onChange={onMoodChange}
        disabled={disabled}
      />
      <Scale
        name="energy"
        legend="Energy"
        lowLabel="Drained"
        highLabel="Energetic"
        value={energy}
        onChange={onEnergyChange}
        disabled={disabled}
      />

      <div className="field">
        <label className="field__label" htmlFor="fast-note">
          Notes
        </label>
        <textarea
          id="fast-note"
          className="field__input"
          rows={3}
          maxLength={MAX_NOTE_LENGTH}
          value={note}
          disabled={disabled}
          onChange={(event) => onNoteChange(event.target.value)}
        />
        {/*
          Rendered as text by React, always. Requirement 13.3 — and the lint rule banning innerHTML and
          dangerouslySetInnerHTML is what keeps that true as this file changes.
        */}
        <p className="field__hint">
          {note.length} of {MAX_NOTE_LENGTH} characters.
        </p>
      </div>
    </>
  );
}

function Scale({
  name,
  legend,
  lowLabel,
  highLabel,
  value,
  onChange,
  disabled,
}: {
  name: string;
  legend: string;
  lowLabel: string;
  highLabel: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <fieldset className="scale">
      <legend className="field__label">{legend}</legend>

      <div className="scale__options">
        <span className="scale__end" aria-hidden="true">
          {lowLabel}
        </span>

        {[1, 2, 3, 4, 5].map((option) => (
          <label className="scale__option" key={option}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              disabled={disabled}
              onChange={() => onChange(option)}
            />
            {/*
              The number is the visible label; the end labels are repeated into the first and last options'
              names. Built as one string, because separate expressions become separate text nodes and a
              screen reader may read them with pauses between.
            */}
            <span aria-hidden="true">{option}</span>
            <span className="sr-only">
              {`${option} of 5${option === 1 ? `, ${lowLabel}` : option === 5 ? `, ${highLabel}` : ''}`}
            </span>
          </label>
        ))}

        <span className="scale__end" aria-hidden="true">
          {highLabel}
        </span>
      </div>

      {value !== null && (
        <button
          type="button"
          className="button button--link"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Clear {legend.toLowerCase().replace('?', '')}
        </button>
      )}
    </fieldset>
  );
}
