import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import Timer from './routes/Timer.js';
import Plans from './routes/Plans.js';
import History from './routes/History.js';
import Stats from './routes/Stats.js';
import Settings from './routes/Settings.js';
import SignIn from './routes/SignIn.js';
import NotFound from './routes/NotFound.js';

/**
 * The route table.
 *
 * `/signin` sits outside `AppShell` deliberately: a signed-out visitor has no use for a tab bar
 * pointing at five screens they cannot open, and rendering the shell around it would put those links in
 * the tab order before the password field.
 *
 * The route guard that sends a signed-out visitor here, preserving where they were going, is task 10.
 * Adding it now would mean writing it against an auth layer that does not exist yet and rewriting it
 * when it does.
 */
export function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />

      <Route element={<AppShell />}>
        <Route index element={<Timer />} />
        <Route path="plans" element={<Plans />} />
        <Route path="history" element={<History />} />
        <Route path="stats" element={<Stats />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
