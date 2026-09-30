import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';
import { renderApp } from '../test/render.js';
import {
  clearSupabaseStub,
  installSupabaseStub,
  makeSession,
  profileRow,
} from '../test/supabaseStub.js';

afterEach(clearSupabaseStub);

/** The app with a signed-in user whose health notice is already acknowledged. */
function signedIn(overrides: Record<string, unknown> = {}) {
  return installSupabaseStub({
    session: makeSession(),
    tables: { profiles: [profileRow(overrides)] },
  });
}

describe('the route guard (Req 2.1)', () => {
  it('sends a signed-out visitor to sign in', async () => {
    installSupabaseStub({ session: null });
    renderApp(<App />, { route: '/' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Sign in' })).toBeInTheDocument();
  });

  it('keeps a signed-out visitor out of every protected screen', async () => {
    installSupabaseStub({ session: null });
    renderApp(<App />, { route: '/history' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'History' })).not.toBeInTheDocument();
  });

  it('lets a signed-in user through', async () => {
    signedIn();
    renderApp(<App />, { route: '/' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Timer' })).toBeInTheDocument();
  });

  it('does not flash sign-in while the stored session is being read', () => {
    // The reason `status` has a loading value. Without it the guard sees a null session on the first
    // render and redirects, so every reload blinks the sign-in screen.
    signedIn();
    renderApp(<App />, { route: '/' });
    expect(screen.queryByRole('heading', { level: 2, name: 'Sign in' })).not.toBeInTheDocument();
  });
});

describe('signing in', () => {
  it('signs in and lands on the timer', async () => {
    const stub = installSupabaseStub({ session: null, tables: { profiles: [profileRow()] } });
    renderApp(<App />, { route: '/' });

    await userEvent.type(await screen.findByLabelText('Email'), 'ada@fastr.test');
    await userEvent.type(screen.getByLabelText('Password'), 'fastr-local-dev');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(stub.calls.signInWithPassword).toHaveBeenCalledWith({
      email: 'ada@fastr.test',
      password: 'fastr-local-dev',
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Timer' })).toBeInTheDocument();
  });

  it('trims a stray space from the email', async () => {
    // Autofill and copy-paste both do this, and Auth treats the address as literal.
    const stub = installSupabaseStub({ session: null, tables: { profiles: [profileRow()] } });
    renderApp(<App />, { route: '/' });

    await userEvent.type(await screen.findByLabelText('Email'), ' ada@fastr.test ');
    await userEvent.type(screen.getByLabelText('Password'), 'fastr-local-dev');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(stub.calls.signInWithPassword.mock.calls[0]?.[0].email).toBe('ada@fastr.test');
  });

  it('returns the user to the screen they asked for (Req 2.1)', async () => {
    // Without this, a bookmark to /history signs you in and dumps you on the timer, every time the
    // session expires.
    installSupabaseStub({ session: null, tables: { profiles: [profileRow()] } });
    renderApp(<App />, { route: '/history' });

    await userEvent.type(await screen.findByLabelText('Email'), 'ada@fastr.test');
    await userEvent.type(screen.getByLabelText('Password'), 'fastr-local-dev');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'History' })).toBeInTheDocument();
  });

  it('gives one generic message for a wrong password (Req 2.2)', async () => {
    installSupabaseStub({
      session: null,
      authErrors: { signInWithPassword: { message: 'Invalid login credentials', status: 400 } },
    });
    renderApp(<App />, { route: '/' });

    await userEvent.type(await screen.findByLabelText('Email'), 'ada@fastr.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email or password is incorrect.',
    );
  });

  it('gives the same message for an unknown email, revealing nothing (Req 2.2)', async () => {
    // Supabase distinguishes the two; passing that through would turn this form into an account checker.
    installSupabaseStub({
      session: null,
      authErrors: { signInWithPassword: { message: 'Invalid login credentials', status: 400 } },
    });
    renderApp(<App />, { route: '/' });

    await userEvent.type(await screen.findByLabelText('Email'), 'nobody@fastr.test');
    await userEvent.type(screen.getByLabelText('Password'), 'fastr-local-dev');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email or password is incorrect.',
    );
  });

  it('distinguishes a server failure from a bad password', async () => {
    // Telling someone their password is wrong when the database is down sends them off changing a
    // password that was never the problem.
    installSupabaseStub({
      session: null,
      authErrors: { signInWithPassword: { message: 'Database error', status: 500 } },
    });
    renderApp(<App />, { route: '/' });

    await userEvent.type(await screen.findByLabelText('Email'), 'ada@fastr.test');
    await userEvent.type(screen.getByLabelText('Password'), 'fastr-local-dev');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach its server/i);
  });

  it('names rate limiting, which reveals nothing about the account (Req 2.3)', async () => {
    installSupabaseStub({
      session: null,
      authErrors: { signInWithPassword: { message: 'Too many requests', status: 429 } },
    });
    renderApp(<App />, { route: '/' });

    await userEvent.type(await screen.findByLabelText('Email'), 'ada@fastr.test');
    await userEvent.type(screen.getByLabelText('Password'), 'fastr-local-dev');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('offers no way to sign up (Req 1.1)', async () => {
    installSupabaseStub({ session: null });
    renderApp(<App />, { route: '/' });
    await screen.findByRole('heading', { level: 2, name: 'Sign in' });

    expect(
      screen.queryByRole('button', { name: /sign up|create account|register/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/invite-only/i)).toBeInTheDocument();
  });
});

describe('password reset (Req 2.8)', () => {
  it('sends a link and says so without confirming the address exists', async () => {
    const stub = installSupabaseStub({ session: null });
    renderApp(<App />, { route: '/' });

    await userEvent.click(await screen.findByRole('button', { name: /forgotten your password/i }));
    await userEvent.type(screen.getByLabelText('Email'), 'ada@fastr.test');
    await userEvent.click(screen.getByRole('button', { name: /email me a link/i }));

    expect(stub.calls.resetPasswordForEmail).toHaveBeenCalled();
    // "If that address has an account" — the wording is the security property.
    expect(await screen.findByRole('status')).toHaveTextContent(/has an account/i);
  });

  it('points the link at the callback route', async () => {
    // Anywhere else and Supabase refuses the redirect, so the email arrives with a link to nowhere.
    const stub = installSupabaseStub({ session: null });
    renderApp(<App />, { route: '/' });

    await userEvent.click(await screen.findByRole('button', { name: /forgotten your password/i }));
    await userEvent.type(screen.getByLabelText('Email'), 'ada@fastr.test');
    await userEvent.click(screen.getByRole('button', { name: /email me a link/i }));

    const options = stub.calls.resetPasswordForEmail.mock.calls[0]?.[1] as { redirectTo: string };
    expect(options.redirectTo).toMatch(/\/auth\/callback$/);
  });
});

describe('signing out (Req 2.5, 2.6)', () => {
  it('revokes the session on the server rather than only clearing storage', async () => {
    const stub = signedIn();
    renderApp(<App />, { route: '/settings' });

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(stub.calls.signOut).toHaveBeenCalled();
    // A global scope, not 'local': a local sign-out leaves the refresh token usable.
    expect(stub.calls.signOut.mock.calls[0]?.[0]?.scope).toBeUndefined();
    expect(await screen.findByRole('heading', { level: 2, name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs out other devices without signing out this one', async () => {
    const stub = signedIn();
    renderApp(<App />, { route: '/settings' });

    await userEvent.click(await screen.findByRole('button', { name: /other devices/i }));

    expect(stub.calls.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(await screen.findByText(/every other device has been signed out/i)).toBeInTheDocument();
    // Still here.
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });

  it('reflects a sign-out that happened in another tab', async () => {
    const stub = signedIn();
    renderApp(<App />, { route: '/' });
    await screen.findByRole('heading', { level: 1, name: 'Timer' });

    stub.emitAuthChange('SIGNED_OUT', null);

    expect(await screen.findByRole('heading', { level: 2, name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('the health notice (Req 1.5, 17.1)', () => {
  it('gates the app until it is acknowledged', async () => {
    signedIn({ health_notice_at: null });
    renderApp(<App />, { route: '/' });

    expect(
      await screen.findByRole('heading', { level: 1, name: /before you start/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Timer' })).not.toBeInTheDocument();
  });

  it('says plainly who should not fast', async () => {
    signedIn({ health_notice_at: null });
    renderApp(<App />, { route: '/' });

    const notice = await screen.findByText(/does not suit everyone/i);
    expect(notice).toHaveTextContent(/pregnant/i);
    expect(notice).toHaveTextContent(/under 18/i);
    expect(notice).toHaveTextContent(/diabetic/i);
    expect(notice).toHaveTextContent(/eating disorder/i);
  });

  it('records the acknowledgement against the account, not the device', async () => {
    // Stored on the profile so a second phone does not ask again — and so it cannot be skipped by
    // clearing storage.
    const stub = signedIn({ health_notice_at: null });
    renderApp(<App />, { route: '/' });

    await userEvent.click(await screen.findByRole('button', { name: /i understand/i }));

    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith(
        'profiles',
        expect.objectContaining({ health_notice_at: expect.any(String) }),
      );
    });
  });

  it('stays out of the way once acknowledged', async () => {
    signedIn();
    renderApp(<App />, { route: '/' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Timer' })).toBeInTheDocument();
  });

  it('does not gate the app when the profile cannot be read', async () => {
    // Shown when we know it has not been acknowledged, not when we cannot tell. Otherwise a network blip
    // locks a returning user behind a notice they already accepted.
    installSupabaseStub({
      session: makeSession(),
      tableErrors: { profiles: { message: 'network down' } },
    });
    renderApp(<App />, { route: '/' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Timer' })).toBeInTheDocument();
  });

  it('remains readable in settings afterwards (Req 17.1)', async () => {
    signedIn();
    renderApp(<App />, { route: '/settings' });
    expect(
      await screen.findByRole('heading', { level: 2, name: /health notice/i }),
    ).toBeInTheDocument();
  });
});

describe('a mistyped URL while signed in', () => {
  it('says not found rather than showing the health notice', async () => {
    signedIn({ health_notice_at: null });
    renderApp(<App />, { route: '/nonsense' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument();
  });
});
