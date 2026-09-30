import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';
import { setSupabase } from '../data/supabase.js';

/**
 * A stand-in for the Supabase client, for the component suites.
 *
 * The real client is exercised against a real local Supabase in `supabase/tests`, which is where the
 * policies and constraints are proved. What the component suites need is the opposite: control over what
 * the server said, so the screens can be driven through failures that are awkward to produce for real —
 * wrong credentials, an expired link, a profile that will not save.
 *
 * Only the surface the app actually uses is implemented. A fuller fake would be a second implementation of
 * Supabase to keep correct, and it would still not be the thing that runs in production.
 */

export interface StubOptions {
  session?: Session | null;
  /** Errors, keyed by the auth method that should fail. */
  authErrors?: Partial<
    Record<
      'signInWithPassword' | 'setSession' | 'updateUser' | 'resetPasswordForEmail' | 'signOut',
      { message: string; status?: number }
    >
  >;
  /** Rows returned by `from(table).select()`, keyed by table. */
  tables?: Record<string, unknown[]>;
  /** Tables whose writes should fail. */
  tableErrors?: Record<string, { message: string; code?: string }>;
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'ada@fastr.test',
      created_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: { display_name: 'Ada' },
    },
    ...overrides,
  } as Session;
}

export function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    display_name: 'Ada',
    time_zone: 'Africa/Nairobi',
    weight_unit: 'kg',
    volume_unit: 'ml',
    theme: 'system',
    default_plan_id: '16:8',
    custom_goal_minutes: null,
    water_goal_ml: 2000,
    notify_goal: true,
    notify_stages: false,
    notify_hour_before: false,
    health_notice_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export interface Stub {
  client: SupabaseClient;
  /** Pushes a new auth state to every subscriber, as a real sign-in or sign-out would. */
  emitAuthChange: (event: string, session: Session | null) => void;
  calls: {
    signInWithPassword: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    setSession: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>;
    resetPasswordForEmail: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

export function installSupabaseStub(options: StubOptions = {}): Stub {
  let session = options.session ?? null;
  const listeners = new Set<(event: string, session: Session | null) => void>();
  const authErrors = options.authErrors ?? {};
  const tables = options.tables ?? {};
  const tableErrors = options.tableErrors ?? {};

  const fail = (key: keyof NonNullable<StubOptions['authErrors']>) =>
    authErrors[key] ? { error: authErrors[key] } : null;

  const calls = {
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    setSession: vi.fn(),
    updateUser: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    update: vi.fn(),
  };

  /**
   * A chainable query builder. Every method returns `this`, and awaiting it resolves — which is how the
   * real builder behaves, and what lets the app write `.select().eq().maybeSingle()` in any order.
   */
  function builder(table: string) {
    const rows = tables[table] ?? [];
    const error = tableErrors[table] ?? null;
    let single = false;

    const result = () => {
      if (error) return { data: null, error };
      if (single) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: () => chain,
      delete: () => chain,
      update: (patch: unknown) => {
        calls.update(table, patch);
        return chain;
      },
      single: () => {
        single = true;
        return chain;
      },
      maybeSingle: () => {
        single = true;
        return chain;
      },
      // Awaiting the builder is what actually runs it.
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };

    return chain;
  }

  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: session?.user ?? null }, error: null }),
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        listeners.add(callback);
        return {
          data: { subscription: { unsubscribe: () => listeners.delete(callback) } },
        };
      },
      signInWithPassword: async (credentials: { email: string; password: string }) => {
        calls.signInWithPassword(credentials);
        const failure = fail('signInWithPassword');
        if (failure) return { data: { session: null, user: null }, ...failure };
        session = makeSession({
          user: { ...makeSession().user, email: credentials.email },
        } as never);
        listeners.forEach((listener) => listener('SIGNED_IN', session));
        return { data: { session, user: session.user }, error: null };
      },
      signOut: async (opts?: { scope?: string }) => {
        calls.signOut(opts);
        const failure = fail('signOut');
        if (failure) return failure;
        if (opts?.scope !== 'others') {
          session = null;
          listeners.forEach((listener) => listener('SIGNED_OUT', null));
        }
        return { error: null };
      },
      setSession: async (tokens: { access_token: string; refresh_token: string }) => {
        calls.setSession(tokens);
        const failure = fail('setSession');
        if (failure) return { data: { session: null, user: null }, ...failure };
        session = makeSession();
        listeners.forEach((listener) => listener('SIGNED_IN', session));
        return { data: { session, user: session.user }, error: null };
      },
      updateUser: async (attributes: Record<string, unknown>) => {
        calls.updateUser(attributes);
        const failure = fail('updateUser');
        if (failure) return { data: { user: null }, ...failure };
        return { data: { user: session?.user ?? null }, error: null };
      },
      resetPasswordForEmail: async (email: string, opts?: unknown) => {
        calls.resetPasswordForEmail(email, opts);
        return fail('resetPasswordForEmail') ?? { data: {}, error: null };
      },
    },
    from: (table: string) => builder(table),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  } as unknown as SupabaseClient;

  setSupabase(client);

  return {
    client,
    emitAuthChange: (event, next) => {
      session = next;
      listeners.forEach((listener) => listener(event, next));
    },
    calls,
  };
}

export function clearSupabaseStub(): void {
  setSupabase(null);
}
