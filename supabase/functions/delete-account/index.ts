/**
 * Deleting an account. Requirement 3.3.
 *
 * Needs the service role, because removing an `auth.users` row is an admin operation, which is why this cannot happen
 * in the browser.
 *
 * The user id comes from the verified token and never from the request body. That one line is the difference between
 * a delete-my-account endpoint and a delete-anyone's-account endpoint, and it is the only thing standing between the
 * two, so it is worth stating plainly.
 *
 * Every table in `public` references `auth.users(id) on delete cascade`, so a single admin delete removes the
 * profile, fasts, weights, water, notes, reminders, push subscriptions and queued notifications with it. No list of
 * tables is maintained here, which means a table added later cannot be forgotten.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authorization = request.headers.get('Authorization');
  if (!authorization) return new Response('Unauthorized', { status: 401 });

  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) return new Response('Unauthorized', { status: 401 });

  const userId = userData.user.id;

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { error } = await service.auth.admin.deleteUser(userId);

  if (error) {
    console.error('account deletion failed', error.message);
    return Response.json({ error: 'That did not work. Try again in a moment.' }, { status: 500 });
  }

  return Response.json({ deleted: true });
});
