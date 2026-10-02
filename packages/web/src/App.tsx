import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { RequireAuth } from './auth/RequireAuth.js';
import { HealthNoticeGate } from './auth/HealthNotice.js';
import Timer from './routes/Timer.js';
import Plans from './routes/Plans.js';
import History from './routes/History.js';
import Stats from './routes/Stats.js';
import Activities from './routes/Activities.js';
import Settings from './routes/Settings.js';
import SignIn from './routes/SignIn.js';
import SignUp from './routes/SignUp.js';
import AuthCallback from './routes/AuthCallback.js';
import AcceptInvite from './routes/AcceptInvite.js';
import ResetPassword from './routes/ResetPassword.js';
import NotFound from './routes/NotFound.js';

/**
 * The route table, in three tiers.
 *
 * **Public**, outside the app shell: sign-in, sign-up, the emailed-link callback, and the two screens that
 * finish setting up a password. None of them get navigation, because a visitor who cannot open those
 * screens has no use for links to them, and putting those links ahead of the password field in the tab
 * order would be worse than useless.
 *
 * Note that the invite and reset screens sit here despite requiring a session. They do have one — an
 * emailed link signs you in — but it is a session whose only purpose is to set a password, so the app
 * proper is not open to them yet.
 *
 * **Guarded**: everything else, behind `RequireAuth`.
 *
 * **Gated**: inside that, `HealthNoticeGate` holds the app until the notice is acknowledged. It sits
 * inside the guard rather than outside because it needs the profile, which needs a session.
 */
export function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route element={<HealthNoticeGate />}>
            <Route index element={<Timer />} />
            <Route path="plans" element={<Plans />} />
            <Route path="history" element={<History />} />
            <Route path="stats" element={<Stats />} />
            <Route path="activities" element={<Activities />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          {/* Outside the gate: a mistyped URL should say so rather than show the health notice. */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
