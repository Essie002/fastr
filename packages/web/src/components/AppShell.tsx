import { NavLink, Outlet } from 'react-router-dom';
import { useOnline } from '../hooks/useOnline.js';
import { OfflineBanner } from './Banner.js';
import { useAuth } from '../auth/AuthProvider.js';
import { useRealtimeFasts } from '../data/useRealtimeFasts.js';

/**
 * The frame every signed-in screen sits in. Requirement 15.1.
 *
 * One navigation list, restyled by a media query into a bottom tab bar on a phone and a side rail on a
 * laptop. Rendering two different trees and hiding one would mean two sets of links in the
 * accessibility tree, two places to fix a focus bug, and a screen reader reading the menu twice.
 *
 * The icons are text glyphs rather than an icon font or SVG set. They are `aria-hidden`, so they carry
 * no meaning a screen reader needs, and this keeps the first working version dependency-free. Replacing
 * them with real icons later touches only this file.
 */

const TABS = [
  { to: '/', label: 'Timer', icon: '◐', end: true },
  { to: '/plans', label: 'Plans', icon: '☰', end: false },
  { to: '/history', label: 'History', icon: '▤', end: false },
  { to: '/stats', label: 'Stats', icon: '◈', end: false },
  { to: '/settings', label: 'Settings', icon: '⚙', end: false },
] as const;

export function AppShell() {
  const online = useOnline();
  const { userId } = useAuth();

  // Subscribed once here rather than per screen, so navigating between tabs does not tear the channel down
  // and build it again. Requirement 5.6.
  const realtime = useRealtimeFasts(userId);

  return (
    <div className="shell">
      {/* Requirement 19.1. First thing in the tab order, so a keyboard user is not walked through
          five navigation links on every page before reaching the content. */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <nav className="shell__nav" aria-label="Main">
        <ul className="nav__list">
          {TABS.map((tab) => (
            <li className="nav__item" key={tab.to}>
              {/* NavLink sets aria-current="page" itself, which is what a screen reader announces and
                  what the stylesheet hooks the highlight onto, so the current page is never signalled
                  by colour alone. Requirement 19.3. */}
              <NavLink to={tab.to} end={tab.end} className="nav__link">
                <span className="nav__icon" aria-hidden="true">
                  {tab.icon}
                </span>
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* tabIndex -1 so the skip link can move focus here; without it the jump moves the viewport and
          leaves focus behind in the navigation. */}
      <main className="shell__main" id="main" tabIndex={-1}>
        {!online && <OfflineBanner />}

        {/*
          Only while online. Offline the banner above already explains it, and two messages about the same
          thing reads like two separate faults. Worded as a limitation rather than a failure, because the app
          still works: it just will not notice a change made elsewhere until this one is reopened.
        */}
        {online && realtime === 'down' && (
          <p className="muted shell__realtime" role="status">
            Live updates are unavailable. Changes made on another device will appear when you come
            back to this one.
          </p>
        )}

        <Outlet />
      </main>
    </div>
  );
}
