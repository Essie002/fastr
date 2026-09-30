import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';
import { renderApp } from './test/render.js';
import { setOnline } from './test/setup.js';

describe('routing', () => {
  it('shows the timer at the root', () => {
    renderApp(<App />, { route: '/' });
    expect(screen.getByRole('heading', { level: 1, name: 'Timer' })).toBeInTheDocument();
  });

  it.each([
    ['/plans', 'Plans'],
    ['/history', 'History'],
    ['/stats', 'Stats'],
    ['/settings', 'Settings'],
  ])('renders %s', (route, heading) => {
    renderApp(<App />, { route });
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('opens a deep link directly, not only by navigation', () => {
    // This is the case GitHub Pages breaks without the 404.html copy: a bookmark or a refresh on a
    // sub-path. The copy is a build step, so what is testable here is that the router resolves the
    // path on a cold start rather than needing a click to get there.
    renderApp(<App />, { route: '/stats' });
    expect(screen.getByRole('heading', { level: 1, name: 'Stats' })).toBeInTheDocument();
  });

  it('shows its own not-found page for an unknown path', () => {
    // Because 404.html is the app, a mistyped URL loads Fastr rather than a Pages error page. Without
    // this route the user would get a blank screen and assume the app was broken.
    renderApp(<App />, { route: '/nonsense' });
    expect(screen.getByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument();
  });

  it('renders sign-in without the app navigation', () => {
    // A signed-out visitor has no use for links to five screens they cannot open, and putting them in
    // the tab order ahead of the password field would be worse than useless.
    renderApp(<App />, { route: '/signin' });
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });
});

describe('the app shell', () => {
  it('offers one navigation list, not one per breakpoint', () => {
    // Two trees, one hidden by CSS, would put every link in the accessibility tree twice.
    renderApp(<App />, { route: '/' });
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(
      screen.getAllByRole('link', { name: /timer|plans|history|stats|settings/i }),
    ).toHaveLength(5);
  });

  it('marks the current page for assistive technology, not only in colour', () => {
    renderApp(<App />, { route: '/history' });
    const current = screen.getByRole('link', { current: 'page' });
    expect(current).toHaveAccessibleName(/history/i);
  });

  it('does not mark the timer as current when elsewhere', () => {
    // The index route needs `end`, or its link stays highlighted on every page.
    renderApp(<App />, { route: '/plans' });
    expect(screen.getByRole('link', { current: 'page' })).toHaveAccessibleName(/plans/i);
  });

  it('puts a skip link first in the tab order', async () => {
    renderApp(<App />, { route: '/' });
    await userEvent.tab();
    expect(screen.getByRole('link', { name: /skip to content/i })).toHaveFocus();
  });

  it('points the skip link at a focusable main landmark', () => {
    // Without tabIndex on <main>, the jump moves the viewport and leaves focus in the navigation.
    renderApp(<App />, { route: '/' });
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(main).toHaveAttribute('tabindex', '-1');
  });
});

describe('offline banner', () => {
  it('stays hidden while online', () => {
    renderApp(<App />, { route: '/' });
    expect(screen.queryByText(/you are offline/i)).not.toBeInTheDocument();
  });

  it('appears when the network goes away', async () => {
    renderApp(<App />, { route: '/' });
    setOnline(false);
    expect(await screen.findByText(/you are offline/i)).toBeInTheDocument();
  });

  it('announces politely rather than interrupting', async () => {
    // role="alert" would cut across whatever a screen reader is reading, which is wrong for a
    // connection blip appearing while someone reads their history.
    renderApp(<App />, { route: '/' });
    setOnline(false);
    const banner = await screen.findByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('goes away when the network returns', async () => {
    renderApp(<App />, { route: '/' });
    setOnline(false);
    expect(await screen.findByText(/you are offline/i)).toBeInTheDocument();
    setOnline(true);
    await vi.waitFor(() => {
      expect(screen.queryByText(/you are offline/i)).not.toBeInTheDocument();
    });
  });
});
