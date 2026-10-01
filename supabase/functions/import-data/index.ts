/**
 * Importing a Fastr export. Requirement 16.3.
 *
 * Server-side because it has to be all-or-nothing. A half-imported history, with some fasts in and others rejected
 * by the overlap constraint, is worse than a failed import: the user cannot tell what landed, and running it again
 * would collide with whatever did.
 *
 * Verifies the caller's JWT and takes the user id from the verified token, never from the body. That distinction is
 * the difference between importing into your own account and importing into anyone's.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface ExportShape {
  version: number;
  profile?: Record<string, unknown>;
  fasts?: {
    planId: string;
    goalMinutes: number;
    startAt: string;
    endedAt: string | null;
    status: string;
    mood: number | null;
    energy: number | null;
    note: string | null;
  }[];
  weightEntries?: { measuredOn: string; grams: number }[];
  waterEntries?: { loggedAt: string; ml: number }[];
  dayNotes?: { day: string; mood: number | null; energy: number | null; note: string | null }[];
  reminders?: { localTime: string; weekdays: number[]; enabled: boolean }[];
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authorization = request.headers.get('Authorization');
  if (!authorization) return new Response('Unauthorized', { status: 401 });

  // A client bound to the caller's token, used only to establish who they are. The service client below does the
  // writing, because the import has to run as one transaction through an RPC.
  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) return new Response('Unauthorized', { status: 401 });

  // From the verified token. Never from the body, which the caller controls.
  const userId = userData.user.id;

  let payload: ExportShape;
  try {
    payload = (await request.json()) as ExportShape;
  } catch {
    return badRequest('That file is not valid JSON.');
  }

  if (payload.version !== 1) {
    return badRequest('That file was made by a different version of Fastr.');
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Requirement 16.3 says an empty account. Checked here for a clear message, and again inside the transaction so
  // two imports racing cannot both pass this.
  const { count } = await service
    .from('fasts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if ((count ?? 0) > 0) {
    return badRequest(
      'Import only works into an empty account. Delete your fasts first, or use a new account.',
    );
  }

  const { data, error } = await service.rpc('import_fastr_export', {
    target_user: userId,
    payload,
  });

  if (error) {
    // The overlap constraint is the likely failure, and its native message names a gist constraint and prints two
    // tstzranges.
    const message = /fasts_no_overlap/.test(error.message)
      ? 'That file contains fasts that overlap each other, so none of it was imported.'
      : /already has/.test(error.message)
        ? 'Import only works into an empty account.'
        : 'That file could not be imported. Nothing was changed.';
    return Response.json({ error: message }, { status: 400 });
  }

  return Response.json({ imported: data });
});
