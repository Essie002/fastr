import { useId } from 'react';
import type { ReactNode } from 'react';

/**
 * Form primitives.
 *
 * The hint sits **outside** the `<label>`, tied to the control with `aria-describedby`. That distinction is
 * not cosmetic: anything inside the label becomes part of the control's accessible *name*, so a wrapped
 * hint turns the name into "Time zoneUsed for your streaks, your daily water total, and when reminders
 * arrive" — read out in full every time the control gains focus. A name identifies; a description explains.
 *
 * That also means `htmlFor` and an id rather than wrapping, which is the one thing wrapping was avoiding.
 * `useId` supplies both ends, so they cannot come apart.
 */

export function TextField({
  label,
  value,
  onChange,
  hint,
  type = 'text',
  maxLength,
  disabled,
  autoComplete,
  inputMode,
  min,
  max,
  step,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  type?: string;
  maxLength?: number;
  disabled?: boolean;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  min?: number;
  max?: number;
  step?: number;
  onBlur?: () => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input"
        type={type}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        autoComplete={autoComplete}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="field__input"
        value={value}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A labelled checkbox.
 *
 * A real `<input type="checkbox">` rather than a styled div with `role="switch"`: it arrives keyboard
 * operable, announces its own state, and works inside a form, none of which a div gets without being
 * rebuilt.
 */
export function ToggleField({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="toggle">
      <input
        id={id}
        className="toggle__input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={description ? hintId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <label className="toggle__label" htmlFor={id}>
          {label}
        </label>
        {description && (
          <span className="field__hint" id={hintId}>
            {description}
          </span>
        )}
      </span>
    </div>
  );
}
