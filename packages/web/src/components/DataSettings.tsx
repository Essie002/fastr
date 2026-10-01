import { useRef, useState } from 'react';
import { exportSchema } from '@fastr/shared';
import { getSupabase } from '../data/supabase.js';
import { buildExport, downloadFile, exportFilename, fastsToCsv } from '../data/exportData.js';
import { useAuth } from '../auth/AuthProvider.js';

/**
 * Export, import, and deleting the account. Requirements 16 and 3.3.
 *
 * Grouped together because they are the three things that move or remove everything, and someone looking for one of
 * them is usually looking for another.
 */
export function DataSettings() {
  const { signOut } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function download(format: 'json' | 'csv') {
    setError(null);
    setMessage(null);
    setBusy(format);

    try {
      const data = await buildExport();
      if (format === 'json') {
        downloadFile(exportFilename('json'), JSON.stringify(data, null, 2), 'application/json');
      } else {
        downloadFile(exportFilename('csv'), fastsToCsv(data), 'text/csv');
      }
      setMessage('Your download should be starting.');
    } catch {
      setError('Your data could not be exported. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function importFile(file: File) {
    setError(null);
    setMessage(null);
    setBusy('import');

    try {
      const text = await file.text();

      // Validated here against the shared schema as well as in the function. This catches a wrong file — someone's
      // bank statement, a different app's export — before it travels, and gives a message about the file rather than
      // about a database.
      const parsed = exportSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        setError('That does not look like a Fastr export.');
        return;
      }

      const { data: session } = await getSupabase().auth.getSession();
      const token = session.session?.access_token;
      if (!token) {
        setError('Sign in again and retry.');
        return;
      }

      const response = await getSupabase().functions.invoke('import-data', {
        body: parsed.data,
      });

      if (response.error) {
        setError('That file could not be imported. Nothing was changed.');
        return;
      }

      setMessage('Imported. Reload to see it.');
    } catch {
      setError('That file could not be read.');
    } finally {
      setBusy(null);
      // Cleared so choosing the same file again fires a change event.
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function deleteAccount() {
    setError(null);
    setBusy('delete');

    try {
      const response = await getSupabase().functions.invoke('delete-account', { body: {} });
      if (response.error) {
        setError('That did not work. Try again in a moment.');
        return;
      }
      // The account is gone, so the session is meaningless; signing out clears it locally and returns to sign-in.
      await signOut();
    } catch {
      setError('That did not work. Try again in a moment.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="card stack" aria-labelledby="data-heading">
        <h2 id="data-heading">Your data</h2>
        <p className="field__hint">
          Fastr is hosted on a free plan that pauses after a week of inactivity, so keeping your own
          copy is worth the thirty seconds.
        </p>

        <div className="notice__actions">
          <button
            type="button"
            className="button button--secondary"
            disabled={busy !== null}
            onClick={() => void download('json')}
          >
            {busy === 'json' ? 'Preparing…' : 'Download everything (JSON)'}
          </button>
          <button
            type="button"
            className="button button--secondary"
            disabled={busy !== null}
            onClick={() => void download('csv')}
          >
            {busy === 'csv' ? 'Preparing…' : 'Download fasts (CSV)'}
          </button>
        </div>

        <div>
          <label className="field__label" htmlFor="import-file">
            Import a Fastr export
          </label>
          <input
            ref={fileInput}
            id="import-file"
            className="field__input"
            type="file"
            accept="application/json,.json"
            disabled={busy !== null}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
          <p className="field__hint">
            Only into an empty account, so nothing you already have can be overwritten or
            duplicated.
          </p>
        </div>

        {message && (
          <p className="muted" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="card stack" aria-labelledby="delete-account-heading">
        <h2 id="delete-account-heading">Delete your account</h2>

        {deleting ? (
          <div
            className="notice notice--danger"
            role="alertdialog"
            aria-labelledby="delete-confirm-heading"
          >
            <h3 id="delete-confirm-heading">This cannot be undone</h3>
            <p>
              Every fast, weight, note and reminder will be permanently deleted, along with your
              account. Download your data first if you might want it.
            </p>

            <div className="field">
              <label className="field__label" htmlFor="delete-confirm">
                Type <strong>delete my account</strong> to confirm
              </label>
              <input
                id="delete-confirm"
                className="field__input"
                type="text"
                autoComplete="off"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>

            <div className="notice__actions">
              <button
                type="button"
                className="button button--danger"
                // A typed phrase rather than a second button: this is irreversible, and two taps is not enough
                // friction for something that cannot be undone.
                disabled={
                  confirmation.trim().toLowerCase() !== 'delete my account' || busy !== null
                }
                onClick={() => void deleteAccount()}
              >
                {busy === 'delete' ? 'Deleting…' : 'Delete my account'}
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => {
                  setDeleting(false);
                  setConfirmation('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="button button--link" onClick={() => setDeleting(true)}>
            Delete my account
          </button>
        )}
      </section>
    </>
  );
}
