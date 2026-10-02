# Fastr

Intermittent fasting tracker. Pick a plan, start a fast, and get told when it is done, even with the app closed.

A responsive web app that installs to a phone's home screen. Several people can use it, each with their own account and
their own data. It runs as static files on GitHub Pages with [Supabase](https://supabase.com) as the entire back end, so
it costs nothing to host.

## What it does

Choose from twelve plans, from 12:12 to a 72-hour fast, or set your own length. Start a fast and a live timer shows how
long you have been going, how long is left, and which fasting stage you have reached — "fat burning typically begins
around 12h" and so on. When you reach your goal, a notification arrives on your phone. Past fasts build a history with a
calendar, streaks and some simple statistics. Alongside that you can log your weight, your water, and how each fast felt.

It also has a daily reminder to start, dark mode, and a way to download everything you have recorded.

**Fastr is not medical advice.** It is a timer that knows nothing about your health. Fasting does not suit everyone, and
anything beyond a day needs a doctor's opinion first.

## Running it locally

You need Node 22 and a container runtime. Then:

```bash
npm install
npm run setup     # starts Supabase in containers, applies migrations, seeds data
npm run dev       # http://localhost:5173/fastr/
```

Sign in as `a@fastr.test` or `b@fastr.test`, password `fastr-local-dev`.

`npm run setup` does everything the first run needs: finds your container runtime, starts a Podman machine if that is
what you have, applies every migration, seeds two test users with a little history, and writes the local credentials into
`packages/web/.env.local` and `supabase/functions/.env`. It pulls about a dozen images the first time, so expect a few
minutes.

### Which container runtime

**Either Docker or Podman.** Podman is not a footnote here: Docker Desktop is blocked by policy on one of the machines
this was built on, which makes the choice the difference between having a local stack and not having one.

Podman needs one thing that is already configured in `supabase/config.toml`: `[analytics]` is off. Its log collector
mounts the container runtime's own socket, and under Podman on macOS that socket lives in a temp directory the virtual
machine cannot share, so the whole stack dies with `making volume mountpoint ... operation not supported`. Nothing in
Fastr reads those logs. `[storage]` is off for a similar reason — Fastr stores no files, so those containers would idle.

If neither runtime is permitted at all, you can still work: create a second Supabase project to develop against and use
`npx supabase db push` instead of the local stack. You lose working offline and the fast `db reset`, which is a real loss
rather than a trivial one.

### Useful commands

```bash
npm run verify            # typecheck, lint, format check, and the whole suite
npm test                  # tests only
npm run db:reset          # rebuild the local database from migrations and seed
npm run db:psql -- -c "select count(*) from fasts"
npm run db:stop           # stop the local stack when you are done
npm run send:notifications  # run the notification sender once, by hand
npm run gen:vapid         # generate Web Push keys
npm run gen:icons         # regenerate the PWA icons
npm run gen:stages        # regenerate the stage list for SQL and Deno
npm run check:rls         # fail if any table is missing Row Level Security
```

A note on the tests: **running them empties the app.** The suites under `supabase/tests` run against the same local
database the dev server uses, and they delete every row belonging to the two seed users between tests — otherwise one
suite's leftovers decide whether the next one passes. So after `npm test` or `npm run verify`, signing in as
`a@fastr.test` shows no history, no streaks and no weight. Nothing is broken; run `npm run db:reset` to get the demo
data back.

A note on `send:notifications`: **`pg_cron` does not fire reliably in the local stack.** The extension is installed and
the job is scheduled, but its background worker does not run dependably in the CLI's container, so during development you
trigger the sender yourself. Its scheduling is verified against the hosted project. This is written down so "my
notification never arrived locally" does not look like a bug in the sender.

To serve the function locally first:

```bash
npx supabase functions serve send-notifications --env-file ./supabase/functions/.env --no-verify-jwt
```

## Layout

```
packages/shared        Domain types, the plan catalog, the fasting stages, Zod schemas, and
                       streaks and stats as pure functions. Imported by the web app and, in
                       generated form, by the Edge Functions.
packages/web           The React app. The only thing deployed.
supabase/migrations    Every schema change, in order. The database rebuilds from these alone.
supabase/functions     Edge Functions: the notification sender, account deletion, data import.
supabase/tests         Database tests, including the two-user Row Level Security suite.
scripts/               Setup, generators, and the checks CI runs.
docker/                nginx config for the optional container image.
.kiro/specs/           Requirements, design, and the task plan.
```

There is no server package. GitHub Pages cannot run code, so **the database is the application**: Row Level Security
decides who sees what, constraints decide what a valid fast is, and triggers keep the notification queue in step with the
fasts. The design document explains why, and what that costs.

## Environment

Nothing in this table is secret except where it says so.

| Variable                    | Where it lives                      | Purpose                                                   |
| --------------------------- | ----------------------------------- | --------------------------------------------------------- |
| `VITE_SUPABASE_URL`         | repository variable, `.env.local`   | The Supabase project. Public.                             |
| `VITE_SUPABASE_ANON_KEY`    | repository variable, `.env.local`   | Identifies the project. **Public by design** — see below. |
| `VITE_VAPID_PUBLIC_KEY`     | repository variable, `.env.local`   | Web Push public key. Public.                              |
| `VAPID_PUBLIC_KEY`          | Supabase function secret            | The same key, for the sender.                             |
| `VAPID_PRIVATE_KEY`         | Supabase function secret            | **Secret.** Signs push messages. Never reaches a browser. |
| `VAPID_SUBJECT`             | Supabase function secret            | A `mailto:` a push service can contact.                   |
| `CRON_SECRET`               | Supabase function secret            | **Secret.** Proves a call to the sender came from cron.   |
| `SUPABASE_SERVICE_ROLE_KEY` | provided to functions automatically | **Secret.** Bypasses Row Level Security entirely.         |
| `SUPABASE_ACCESS_TOKEN`     | GitHub secret, `production`         | **Secret.** Lets the deploy workflow push migrations.     |
| `SUPABASE_PROJECT_REF`      | repository variable                 | Which project to deploy to.                               |
| `FASTR_REQUIRE_DB`          | set to `1` in CI                    | Makes a skipped database suite a failure.                 |
| `DOCKER_HOST`               | written to `.docker-host` by setup  | Which container socket the Supabase CLI should use.       |

**Why the anon key is published.** It identifies the project and carries no authority of its own. Every table has Row
Level Security, so a request with that key and no session sees nothing, and a request with a session sees exactly one
user's rows. Treating it as a secret would hide it from whoever maintains the project while shipping it to every visitor
in the bundle anyway. The key that does matter is the service role key, which exists only inside Edge Functions.

## Deploying

### Once, to set the project up

1. **Create a Supabase project.** Note its reference and its anon key.

2. **Check the sign-up setting.** Authentication → Sign In / Up. Leave "allow new users to sign up" **on** — that is what
   lets people create their own accounts, and it is what the app's sign-up form needs. Leave the email provider itself
   enabled too: turning that off disables email sign-_in_, and every login fails with "Email logins are disabled".

   Leave "confirm email" **off** unless you have configured real SMTP. Supabase's built-in mailer sends two messages an
   hour, so with confirmations on the third person to sign up in an hour cannot get in. The app handles both settings; see
   [Who can sign up](#who-can-sign-up).

3. **Enable the extensions** the notification schedule needs: `pg_cron` and `pg_net`, under Database → Extensions.

4. **Generate Web Push keys** and set the function secrets:

   ```bash
   npm run gen:vapid        # prints both halves and where each one goes
   npx supabase secrets set \
     VAPID_PUBLIC_KEY='...' VAPID_PRIVATE_KEY='...' \
     VAPID_SUBJECT='mailto:you@example.com' \
     CRON_SECRET="$(openssl rand -hex 32)"
   ```

5. **Tell the database where the functions are**, and give it the same cron secret, in the SQL editor:

   ```sql
   insert into private.app_settings (id, functions_url, cron_secret)
   values (true, 'https://<ref>.supabase.co/functions/v1', '<the same CRON_SECRET>')
   on conflict (id) do update
     set functions_url = excluded.functions_url,
         cron_secret   = excluded.cron_secret,
         updated_at    = now();
   ```

   This used to be two `alter database postgres set app.settings.…` statements, and they no longer work: a hosted
   project refuses to set custom parameters even as `postgres`, at database or role level, through the SQL editor or
   the pooler. The failure is quiet — `cron.schedule` succeeds, the job runs every minute, and `current_setting`
   returns null, so the sender's own guard turns it into a no-op. A healthy-looking schedule that sends nothing. The
   settings live in a table now; `private` is not served by PostgREST, so the secret has no HTTP surface.

6. **Set the repository variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`,
   `SUPABASE_PROJECT_REF`. And, only if you want the manual **Deploy to Supabase** workflow, one secret,
   `SUPABASE_ACCESS_TOKEN`, in a `production` environment. That token is your whole Supabase account, so skip it if
   you would rather run `npx supabase db push` from your machine.

7. **Enable Pages**, with GitHub Actions as the source.

   On a free plan this requires a **public** repository — Pages for private repos needs GitHub Pro or above. Public is
   the intended setup here: nothing secret is committed, and the anon key in the bundle is public by design because
   row-level security, not the key, is what separates users. If the repo must stay private, serve the built site
   somewhere else; Netlify and Cloudflare Pages are both free for private repos and can set real HTTP headers, which
   Pages cannot — the reason the CSP currently travels in a meta tag.

8. **Make yourself an account.** Open the deployed app and use the sign-up form. Or, if you would rather not have sign-up
   open at all, see [Who can sign up](#who-can-sign-up) below and invite yourself instead.

### Who can sign up

By default, anyone. The sign-in screen links to a sign-up form, and submitting it creates the account and signs the person
straight in.

That is safe here for a specific reason rather than by luck: every row in the database is owned by one user and is reachable
only through that user's own JWT, enforced by row-level security in Postgres rather than by the app. A stranger who signs up
gets an empty account of their own and no way to see anyone else's. The thing open sign-up costs you is rows, not privacy.

**To close it again**, with no code change: Authentication → Sign In / Up → turn off "allow new users to sign up", and set
`enable_signup = false` under `[auth]` in `supabase/config.toml` so local development matches. The form stays shipped and
says "New accounts are closed at the moment" when someone tries, because the form cannot know the setting — only the server's
answer can tell it.

**To add people yourself** once it is closed: Authentication → Users → Invite. The link lands on `/fastr/auth/callback`,
which is the only route that will turn a URL into a session, and from there the invited person sets a name and a password.
This route keeps working whether sign-up is open or closed.

**To require a confirmed email address**, first configure real SMTP under `[auth.email.smtp]`, then turn on "confirm email".
The app already handles it: sign-up then shows a check-your-inbox screen instead of signing the person in, and the
confirmation link lands on the same callback route.

### Afterwards

The web app deploys itself: push to `main`, CI passes, and the Pages workflow publishes. Database changes are deliberate —
run the **Deploy to Supabase** workflow by hand and type `deploy` to confirm. A migration cannot be undone by re-running
the previous workflow, which is why it is not automatic.

### Running it as a container instead

Not how Fastr is deployed, but supported, and it is the only way the app gets HTTP headers that a `<meta>` tag cannot
carry:

```bash
docker build -t fastr-web . \
  --build-arg VITE_SUPABASE_URL=https://<ref>.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=<anon key>
docker run -p 8080:8080 fastr-web   # http://localhost:8080/fastr/
```

Podman works the same way. The image is about 52 MB, runs as a non-root user, and CI builds it on every run so it cannot
rot unnoticed.

## Cost, and what the free plan costs you

| Item                                                     | Plan | Monthly |
| -------------------------------------------------------- | ---- | ------- |
| GitHub Pages and Actions, public repository              | Free | $0      |
| Supabase: Postgres, Auth, Realtime, Edge Functions, Cron | Free | $0      |
| **Total**                                                |      | **$0**  |

What that costs in reliability:

| Limit                                                                                                 | Effect                                                                  | What is done about it                                                                           |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A free project [pauses after a week idle](https://supabase.com/docs/guides/platform/compute-and-disk) | While paused, nobody can sign in and no notifications are sent          | `keep-alive.yml` pings every three days; export exists regardless                               |
| 500 MB database                                                                                       | Not a constraint. A decade of fasts for a few people is a few megabytes | Nothing needed                                                                                  |
| Built-in email is rate-limited                                                                        | Two messages an hour: password resets and invites                       | Sign-up needs no email, so this is rarely hit; attach real SMTP before turning confirmations on |
| Pages on a private repository needs GitHub Pro                                                        | This repository is public                                               | Nothing secret is committed                                                                     |

Supabase Pro at $25 a month removes the pause, and nothing here depends on free-plan behaviour, so that upgrade is a
dashboard click and no code change.

The keep-alive has a limit of its own: **GitHub disables scheduled workflows in a repository with no commits for 60
days.** It keeps the project alive only while the repository is alive. And whether the notification cron already counts as
activity is unconfirmed — if it does, the keep-alive is redundant. Both are cheap, so both are there.

## Accessibility, and what the tests do not cover

The suite runs `axe` over every screen in its empty, loaded, error and offline states, walks the keyboard order, and
checks every colour pair in both themes against WCAG 2.1 AA arithmetically. That last one exists because `axe` derives
contrast from rendered pixels and jsdom paints nothing, so axe's contrast rules are off and this would otherwise be the
criterion most easily broken by a design tweak and the only one nothing verifies.

**A green run does not mean Fastr is accessible.** Four things still need a person:

- **Listening to it.** Whether the stage announcement arrives at a useful moment, rather than over the top of something
  else, is not a judgement a tool can make. The timer is deliberately hidden from screen readers and only two things
  announce — a new stage, and the goal — because a live region carrying a number that changes every second talks
  continuously and never finishes a sentence.
- **A real screen reader on a real phone.** VoiceOver and TalkBack, on the installed app, with a fast actually running.
- **Contrast on a real screen**, with the axe browser extension against the running app. The arithmetic covers the
  tokens; it cannot know what ends up behind an element after layout.
- **Whether the numbers are legible to someone who is tired and hungry**, which is the state this app is used in.

## What else the tests cannot tell us

- **Whether a push notification actually arrives.** The sender is tested against a real database, including claiming
  under concurrency and the staleness rule, but browser push services cannot be exercised in CI. This needs a phone,
  once per browser.
- **The iOS install-then-permission flow.** Simulators do not reproduce it faithfully. On iPhone, Web Push works only
  from an app added to the home screen (iOS 16.4+), and in a Safari tab it does not work at all — the app says so rather
  than offering a button that cannot work.
- **Whether `pg_cron` fires on schedule in the hosted project.** It does not locally, so this is checked by hand after the
  first deploy.

## Two known gaps

**Fastr can be framed by another site.** `frame-ancestors` is ignored in a `<meta>` tag and `X-Frame-Options` is a header
only, and GitHub Pages sets no headers. The container image sets both, so running it there closes the gap. Nothing in the
app hides a destructive action behind a single click, which is what makes this tolerable rather than fine.

**`style-src` allows `'unsafe-inline'`.** React writes inline styles for the progress ring's rotation. Moving the ring to
CSS custom properties would remove the need; it is a worthwhile follow-up rather than a launch blocker.

## Where the design lives

`.kiro/specs/fasting-tracker/` holds the requirements, the design, and the task plan — including the reasoning behind the
decisions that are not obvious from the code: why there is no application server, why validation is deliberately written
twice, why one exclusion constraint carries two requirements, and what the free tier actually costs.
