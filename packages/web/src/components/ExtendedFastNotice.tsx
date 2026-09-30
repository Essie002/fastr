/**
 * The notice shown before a fast of 24 hours or more. Requirements 4.3 and 17.2.
 *
 * Deliberately a blocking step rather than a line of small print. A 36-hour fast is a different
 * proposition from 16:8, and the difference between them on a catalog screen is otherwise two characters.
 *
 * `role="alertdialog"` with a live region: this appears in response to a tap and asks a question, so
 * interrupting a screen reader is correct here in a way it is not for the offline banner.
 */
export function ExtendedFastNotice({
  hours,
  onConfirm,
  onCancel,
  confirmLabel = 'I understand, use this plan',
}: {
  hours: number;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
}) {
  return (
    <div className="notice notice--warn" role="alertdialog" aria-labelledby="extended-heading">
      <h2 id="extended-heading">That is an extended fast</h2>
      <p>
        {hours} hours without food is well beyond everyday intermittent fasting. Most guidance
        suggests not going past a day without speaking to a doctor first, particularly if you take
        any medication.
      </p>
      <p>Stop if you feel faint, unwell or unusually weak. Keep drinking water throughout.</p>
      <div className="notice__actions">
        <button type="button" className="button button--primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="button button--secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
