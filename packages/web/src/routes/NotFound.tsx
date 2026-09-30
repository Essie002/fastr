import { Link } from 'react-router-dom';

/**
 * An unknown route inside the app.
 *
 * Worth distinguishing from GitHub Pages' own 404: because `404.html` is a copy of the app, a mistyped
 * URL loads Fastr and then lands here. Without this route the user would see a blank screen and assume
 * the app was broken rather than the address wrong.
 */
export default function NotFound() {
  return (
    <div className="stack">
      <h1>Not found</h1>
      <div className="card">
        <p>That page does not exist.</p>
        <Link to="/">Back to your timer</Link>
      </div>
    </div>
  );
}
