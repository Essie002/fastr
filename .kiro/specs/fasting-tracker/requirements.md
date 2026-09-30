# Requirements Document

## Introduction

This spec covers **Fastr**, a multi-user intermittent fasting tracker that runs as a responsive web app and installs to a
phone's home screen as a Progressive Web App (PWA).

A **user** signs in with an email and password, picks a fasting plan from a catalog page, and starts a fast. A live timer
shows how long they have been fasting, how long is left, and which **fasting stage** they are in (for example "fat burning
typically begins around 12h"). When the goal is reached, Fastr sends a notification to their phone or browser. Past fasts
build a history, streaks and simple stats. Alongside fasting, users can log weight, water intake, and mood or energy notes.

### What this spec covers

Accounts and login, the plan catalog, the fast lifecycle and timer, fasting stages, notifications and reminders, history,
streaks and stats, weight, water and mood logging, theming, the PWA shell, data export, the local container setup,
deployment to GitHub Pages and Supabase, and CI.

### What this spec explicitly excludes

- Native iOS or Android apps. The PWA is the phone experience.
- Meal logging, calorie counting, and nutrition data.
- Social features: friends, sharing, leaderboards, groups.
- Social login (Google, Apple). Email and password only in v1.
- Any AWS resource.
- A custom Node server. Supabase provides the back end.
- The 5:2 plan. It is a weekly calorie pattern, not a timed fast, so it does not fit the timer.
- Medical advice. Fastr describes commonly cited fasting stages as general information, not as a claim about any
  individual's body.

### Architecture in one paragraph

GitHub Pages can only serve static files, so it hosts the built React app and nothing else. Everything that needs a server
comes from **Supabase**: Postgres for data, Supabase Auth for accounts, Row Level Security so each user can only reach their
own rows, Edge Functions for the few things the browser must not do itself (sending push notifications, deleting an
account), and Supabase Cron to run the notification sender every minute. The browser talks to Supabase directly with the
public "anon" key. That key is safe to publish **only because** Row Level Security is on for every table, which is why
Requirement 18 treats RLS as the security boundary.

### Key context and constraints

- **Users:** multiple people, each with their own account. A user only ever sees their own data.
- **Devices:** phones first, then laptops. Every screen is usable from 320 px wide upwards.
- **Access anywhere:**
  1. **Hosted:** open the GitHub Pages URL on any device and sign in. Data follows the account.
  2. **Develop anywhere:** on any machine with Docker, `git clone`, then one command starts a full local Supabase in
     containers, and the app runs against it. A dev container definition makes the whole toolchain portable too.
- **Stack:** the Rally stack where it still applies. TypeScript, npm workspaces (`packages/shared`, `packages/web`), React +
  Vite, Vitest, ESLint and Prettier, GitHub Actions. Supabase replaces Rally's server package, Redis and DynamoDB. Supabase
  SQL migrations and Edge Functions live in a top-level `supabase/` folder, which is the layout the Supabase CLI expects.
- **Repository:** its own git repo, pushed to a GitHub repo under `Essie002`.

### Platform limits that shape these requirements

Checked against current sources in September 2026:

- **Supabase free plan:** 2 active projects, 500 MB database, 50,000 monthly active users, and **free projects pause after
  one week of inactivity** ([Supabase changelog](https://supabase.com/changelog/33121-relaxing-database-size-limit-on-free-plan-0-5-gb-database-size-per-project),
  [summary of the pricing page](https://www.ssdnodes.com/learn/is-supabase-free-cloud-vs-self-hosted)). A paused project
  serves nothing and sends no notifications until it is restored. Pro is $25 a month per project.
- **Notifications need something awake.** Supabase Cron calls an Edge Function on a schedule, which sends the push
  ([Supabase docs](https://supabase.com/docs/guides/functions/schedule-functions)). This works on the free plan while the
  project is active. Whether the cron job's own traffic counts as "activity" and prevents the pause is **not confirmed**;
  the design must not rely on it.
- **GitHub Pages on a private repo** needs a paid GitHub plan (Pro or above). On a free account the repo must be public for
  Pages to work. Nothing secret lives in the repo, so a public repo is safe, but it is a decision for the owner.
- **GitHub Pages cannot set HTTP headers** and has no server-side routing. Security headers must be delivered another way,
  and deep links must still load the app.
- **iPhone:** Web Push only works once the PWA has been added to the home screen (iOS 16.4 or later). In a Safari tab it
  does not work at all. The app has to say so rather than fail silently.
- **Supabase's built-in email** is rate-limited and intended for testing. Confirmation and password-reset emails work, but
  only a handful per hour, which is fine for a personal app and is documented rather than worked around.

## Requirements

### Requirement 1: Invite-only accounts

**User Story:** As the owner, I want only people I invite to be able to create an account, so that a personal app on the
public internet does not fill up with strangers.

#### Acceptance Criteria

1. Public sign-up SHALL be disabled in Supabase Auth. New accounts SHALL be created by the owner inviting an email address
   from the Supabase dashboard or CLI.
2. WHEN an invited person opens their invite link THEN the app SHALL let them set a display name and a password, and SHALL
   sign them in.
3. The system SHALL require a password of at least 10 characters, and SHALL enable Supabase Auth's leaked-password check if
   the project's plan provides it.
4. Passwords SHALL be handled only by Supabase Auth. The app SHALL never store, log or send a password anywhere else.
5. Before the account is usable, the app SHALL require the user to acknowledge the health notice (Requirement 17).
6. The system SHALL record the user's time zone from the browser on first sign-in, editable later in settings.
7. The README SHALL give step-by-step instructions for inviting a user, locally and in the hosted project.

### Requirement 2: Sign in, sessions and sign out

**User Story:** As a returning user, I want to sign in once on each device and stay signed in, so that checking my fast takes
one tap.

#### Acceptance Criteria

1. WHEN a user submits a correct email and password THEN the app SHALL sign them in through Supabase Auth.
2. WHEN credentials are wrong THEN the app SHALL show one generic "email or password is incorrect" message, whether or not
   the email exists.
3. Sign-in attempts SHALL be rate-limited by Supabase Auth's built-in limits, and the README SHALL state them.
4. Sessions SHALL refresh automatically, so a user who opens the app at least once a month stays signed in.
5. WHEN a user signs out THEN the app SHALL revoke the session in Supabase, not only clear local storage.
6. The settings page SHALL let a user sign out of all other devices.
7. WHEN a user changes their password THEN the system SHALL sign out every other session for that account.
8. A user SHALL be able to request a password-reset email from the sign-in page.

### Requirement 3: Account settings and deletion

**User Story:** As a user, I want to manage my account and be able to delete it, so that I stay in control of my data.

#### Acceptance Criteria

1. The settings page SHALL let a user change their display name, password, time zone, units (kg or lb, ml or fl oz), theme,
   and notification preferences.
2. Changing a password SHALL require the user to have signed in within the last few minutes, and SHALL otherwise ask them
   to sign in again.
3. WHEN a user deletes their account and confirms by typing a phrase THEN an Edge Function SHALL permanently delete the auth
   user and every row belonging to them, including push subscriptions, and the app SHALL sign them out.
4. Every table holding user data SHALL reference the auth user with `ON DELETE CASCADE`, so deleting the user cannot leave
   orphaned rows.

### Requirement 4: Fasting plan catalog

**User Story:** As a user, I want a page that shows the fasting plans side by side, so that I can choose the one that suits
me without already knowing the jargon.

#### Acceptance Criteria

1. The system SHALL provide a plan catalog page listing at least: 12:12, 14:10, 16:8, 18:6, 20:4, OMAD (23:1), 24-hour,
   36-hour, and Custom.
2. Each plan SHALL show its fasting hours, eating window hours, a difficulty level (beginner, intermediate, advanced), and a
   one or two sentence plain-English description.
3. Plans of 24 hours or more SHALL be marked as extended fasts and SHALL show the extended-fast notice from Requirement 17.
4. WHEN a user selects a plan THEN the system SHALL save it as their default plan, used for the next fast they start.
5. The Custom plan SHALL accept a fasting length between 1 and 72 hours in 15-minute steps.
6. A user SHALL be able to change their default plan at any time without affecting a fast already in progress.
7. The catalog SHALL be the first screen after first sign-in, so a new user picks a plan before seeing an empty timer.
8. The plan list SHALL live in `packages/shared` as data, not in the database, so adding a plan is a code change with tests.

### Requirement 5: Starting, running and ending a fast

**User Story:** As a user, I want to start and stop a fast with one tap and see a live timer, so that I always know where I am.

#### Acceptance Criteria

1. WHEN a user taps "Start fast" THEN the system SHALL create an active fast with the current time as its start and the
   user's default plan as its goal.
2. A user SHALL have at most one active fast at a time. The database SHALL enforce this with a constraint, so two devices
   cannot start two fasts.
3. The system SHALL let a user set the start time in the past when starting, for "I stopped eating at 8pm", up to 48 hours
   back and never in the future.
4. While a fast is active, the home screen SHALL show elapsed time, time remaining to the goal, percentage complete as a
   progress ring, the goal end time in the user's local time, and the current fasting stage.
5. The timer SHALL be computed from the stored start time, so it is correct after a reload, after the phone sleeps, and on a
   second device.
6. WHEN a fast is started, edited or ended on one device THEN any other signed-in device with the app open SHALL reflect it
   within a few seconds, using Supabase Realtime or a refetch when the app regains focus.
7. WHEN elapsed time passes the goal THEN the timer SHALL continue counting and SHALL show the time past the goal, rather
   than stopping.
8. WHEN a user taps "End fast" THEN the system SHALL ask for confirmation, record the end time, and mark the fast as
   completed if it reached its goal or ended early if it did not.
9. The system SHALL let a user edit the start time of an active fast, and the start and end time of a finished one, and SHALL
   reject an end before its start or an overlap with another fast. The database SHALL enforce both, not only the form.
10. A user SHALL be able to cancel an active fast, which discards it without adding it to history.
11. Fasts SHALL be stored as `timestamptz` (UTC instants). Display SHALL use the user's configured time zone.

### Requirement 6: Fasting stages on the timer

**User Story:** As a user, I want to see what stage my fast has reached, so that the hours feel like progress rather than
waiting.

#### Acceptance Criteria

1. The system SHALL define a list of stages, each with a start hour, a short name, and a one or two sentence description.
   At least: Blood sugar rising (0h), Blood sugar falling (2h), Blood sugar normal (5h), Fat burning begins (12h), Ketosis
   (18h), Autophagy (24h), Growth hormone rising (48h), Immune reset (72h).
2. The timer SHALL show the current stage, the next stage, and time until the next stage.
3. The progress ring SHALL mark stage boundaries that fall within the fast's goal.
4. Tapping a stage SHALL open its description.
5. Stage descriptions SHALL use hedged language ("typically", "around") and SHALL link to the health notice.
6. The stage list SHALL live in `packages/shared`, so the web app and the notification scheduler use the same data.

### Requirement 7: Notifications

**User Story:** As a user, I want a notification on my phone when my fast is done, so that I do not have to keep checking the
app.

#### Acceptance Criteria

1. The system SHALL support Web Push notifications, using VAPID keys, on every browser that supports them.
2. The app SHALL ask for notification permission only after the user taps an explicit "Turn on notifications" control,
   never on page load.
3. WHEN an active fast reaches its goal THEN the system SHALL send a push notification to every device the user has
   subscribed, with a message such as "16:8 complete. You fasted 16h 02m."
4. A user SHALL be able to opt in to stage notifications, sent when each stage from Requirement 6 is reached.
5. A user SHALL be able to opt in to a "1 hour to go" notification.
6. Due notifications SHALL be stored as rows in the database. WHEN a fast is started, edited, ended or cancelled THEN its
   pending notification rows SHALL be created, rescheduled or cancelled in the same transaction, by a database trigger or
   function rather than by the browser.
7. A Supabase Cron job SHALL call a `send-notifications` Edge Function every minute. The function SHALL send every pending
   notification that is due, mark it sent, and SHALL be safe if two runs overlap, so no notification is sent twice.
8. WHEN the sender finds a notification more than 30 minutes overdue (for example after the project was paused) THEN it SHALL
   mark it skipped rather than send a stale alert.
9. The VAPID private key SHALL exist only as an Edge Function secret. The browser SHALL only ever hold the public key.
10. WHEN the app is open at the moment a fast reaches its goal THEN the app SHALL also show an in-app alert with an optional
    sound, independent of push.
11. WHEN a push service reports a subscription as expired or gone THEN the system SHALL delete that subscription.
12. On iPhone in a Safari tab, the notifications control SHALL explain that the app must be added to the home screen first,
    and SHALL show how.
13. The settings page SHALL provide a "Send test notification" button.

### Requirement 8: Reminders

**User Story:** As a user, I want a reminder to start my fast at my usual time, so that I stay consistent.

#### Acceptance Criteria

1. A user SHALL be able to set a daily "start your fast" reminder at a local time of their choosing, and pick which days of
   the week it applies.
2. The reminder SHALL be sent through the same push path as Requirement 7.
3. WHEN a fast is already active at reminder time THEN the system SHALL NOT send the reminder.
4. Reminders SHALL follow the user's time zone, including across daylight saving changes.

### Requirement 9: History

**User Story:** As a user, I want to see my past fasts, so that I can see how I am doing over time.

#### Acceptance Criteria

1. The history page SHALL list finished fasts newest first, showing date, plan, duration, goal, and whether the goal was
   met.
2. The history page SHALL show a calendar view in which each day with a completed fast is marked.
3. A user SHALL be able to open a past fast to edit its times, add or edit its mood and energy note, or delete it.
4. A user SHALL be able to add a past fast manually, for fasts they forgot to track.
5. History SHALL be paginated, so a user with years of data loads quickly.

### Requirement 10: Streaks and stats

**User Story:** As a user, I want streaks and simple stats, so that I have something to keep going for.

#### Acceptance Criteria

1. The system SHALL show a current streak: the number of consecutive local calendar days, ending today or yesterday, on
   which the user completed at least one fast that met its goal.
2. The system SHALL show the longest streak ever.
3. A fast SHALL count toward the day on which it **ended**, in the user's time zone.
4. The stats page SHALL show: total completed fasts, average fast length over the last 7 and 30 days, longest fast, and
   goal completion rate.
5. Streaks and stats SHALL be derived from the fasts themselves, never stored as a separate counter, so editing history can
   never leave a stale number.
6. Streak calculation SHALL live in `packages/shared` as a pure function and SHALL have property-based tests covering time
   zones and daylight saving boundaries.

### Requirement 11: Weight log

**User Story:** As a user, I want to log my weight, so that I can see it alongside my fasting.

#### Acceptance Criteria

1. A user SHALL be able to log a weight with a date, in kg or lb, and edit or delete any entry.
2. Weight SHALL be stored in one canonical unit (grams) and converted for display.
3. The system SHALL show a weight chart over 30 days, 90 days, 1 year and all time.
4. The system SHALL accept weights between 20 kg and 400 kg and reject anything outside, in the database as well as the
   form.
5. The chart SHALL have a text alternative (a data table) for screen reader users.

### Requirement 12: Water intake

**User Story:** As a user, I want to tap to log water, so that I remember to stay hydrated while fasting.

#### Acceptance Criteria

1. The home screen SHALL offer quick-add buttons (for example +250 ml, +500 ml) and a custom amount.
2. The system SHALL show today's total against a daily goal the user can set, defaulting to 2,000 ml.
3. A user SHALL be able to undo the last entry and edit or delete entries for any day.
4. "Today" SHALL mean the user's local calendar day.

### Requirement 13: Mood and energy notes

**User Story:** As a user, I want to note how I felt during a fast, so that I can spot what works for me.

#### Acceptance Criteria

1. A user SHALL be able to record mood (1 to 5), energy (1 to 5), and a free-text note of up to 1,000 characters, attached
   to a fast or to a day.
2. When ending a fast, the app SHALL offer an optional, skippable "How did it go?" prompt.
3. Free text SHALL be rendered as plain text only, never as HTML.
4. History entries SHALL show the mood and energy recorded for that fast.

### Requirement 14: Theme and dark mode

**User Story:** As a user, I want dark mode, so that checking my timer at night is comfortable.

#### Acceptance Criteria

1. The app SHALL offer Light, Dark, and System themes, defaulting to System.
2. The chosen theme SHALL be saved to the account, cached on the device, and applied before first paint, so there is no
   flash of the wrong theme.
3. Both themes SHALL meet WCAG 2.1 AA contrast for text and interactive elements.

### Requirement 15: Responsive layout and installable PWA

**User Story:** As a user, I want Fastr to feel like an app on my phone and still work well on my laptop.

#### Acceptance Criteria

1. Every screen SHALL be usable from 320 px wide, with a bottom tab bar on phones and a side navigation on wider screens.
2. The app SHALL ship a web app manifest, icons, and a service worker, so it can be installed to the home screen on Android
   and iPhone from the GitHub Pages URL.
3. The service worker SHALL cache the app shell, so the app opens and shows the last known timer state without a network.
4. WHEN the device is offline THEN the app SHALL show that it is offline, SHALL keep the timer running from the cached start
   time, and SHALL disable actions that need Supabase rather than losing them silently.
5. Touch targets SHALL be at least 44 by 44 CSS pixels.
6. Deep links (for example `/fastr/history`) SHALL load the app on GitHub Pages, which has no server-side routing.

### Requirement 16: Data export and import

**User Story:** As a user, I want to download all my data, so that I never lose it if the project is paused or I move.

#### Acceptance Criteria

1. The settings page SHALL let a user download all their data as JSON and their fasts as CSV.
2. The export SHALL include fasts, notes, weight, water, plan and settings, and SHALL exclude auth data and push
   subscriptions.
3. The system SHALL let a user import a Fastr JSON export into an empty account, so data can move between a local and the
   hosted project.

### Requirement 17: Health notice and safety

**User Story:** As a user, I want to be told plainly what Fastr is and is not, so that I fast safely.

#### Acceptance Criteria

1. The system SHALL show a short health notice at first sign-in and in settings: Fastr is not medical advice, fasting is not
   suitable for everyone (including people who are pregnant, under 18, diabetic, or have a history of eating disorders), and
   users should speak to a doctor before fasting.
2. WHEN a user selects or starts a fast of 24 hours or more THEN the system SHALL show an extended-fast notice and require
   confirmation.
3. The system SHALL NOT allow a single fast goal longer than 72 hours, enforced in the database.
4. WHEN an active fast passes 72 hours THEN the app SHALL show a prominent prompt suggesting the user end it.

### Requirement 18: Security and privacy

**User Story:** As a user, I want my account and data to be safe, so that I can trust Fastr with health information.

#### Acceptance Criteria

1. Row Level Security SHALL be enabled on every table in the `public` schema, with policies that limit every read and write
   to rows where `user_id = auth.uid()`.
2. The test suite SHALL include database tests, run against a real local Supabase, that sign in as two users and prove
   neither can read, insert, update or delete the other's rows in any table.
3. A migration check in CI SHALL fail if any table in `public` has RLS disabled.
4. The browser SHALL only ever hold the anon key. The service role key SHALL exist only as an Edge Function secret and SHALL
   never appear in the repo, the web bundle or CI logs.
5. Edge Functions SHALL verify the caller's JWT, except the cron-called sender, which SHALL verify a shared secret.
6. All inputs SHALL be validated against schemas from `packages/shared` in the app, and critical rules (ranges, overlaps,
   one active fast) SHALL also be enforced by database constraints, because the database is reachable directly with the
   anon key.
7. Because GitHub Pages cannot set headers, the app SHALL deliver a Content Security Policy through a `<meta>` tag that
   allows only the app's own origin and the Supabase project, and the README SHALL state which protections a meta tag
   cannot give (for example `frame-ancestors`).
8. Secrets (VAPID private key, service role key, cron secret, Supabase access token) SHALL come from environment variables
   or secret stores and SHALL never be committed. The repo SHALL include a `.env.example` with placeholders only.
9. Logs SHALL NOT contain passwords, tokens, push subscription keys, or free-text notes.
10. The codebase SHALL ban `dangerouslySetInnerHTML`, `innerHTML` and `outerHTML` with a lint rule, as Rally does.

### Requirement 19: Accessibility

**User Story:** As a user who relies on assistive technology, I want to use every part of Fastr.

#### Acceptance Criteria

1. Every screen SHALL be operable by keyboard alone, with a visible focus indicator.
2. The timer SHALL expose elapsed time, remaining time and stage as text to screen readers, and SHALL announce stage changes
   and goal completion through a polite live region, not on every second's tick.
3. The progress ring and charts SHALL NOT convey meaning through colour alone.
4. The app SHALL respect `prefers-reduced-motion`.
5. The test suite SHALL include automated `axe` checks on every screen. The README SHALL state what those checks cannot
   cover and what needs a person with a screen reader.

### Requirement 20: Containers and working on any machine

**User Story:** As the owner, I want to develop Fastr on any machine with as little setup as possible, so that switching
laptops does not cost me an afternoon.

#### Acceptance Criteria

1. The Supabase CLI SHALL be a pinned dev dependency, so `npx supabase start` runs a full local Supabase (Postgres, Auth,
   Realtime, Edge Functions, Studio, and a local email inbox) in containers with no global install.
2. Migrations in `supabase/migrations` and seed data in `supabase/seed.sql` SHALL fully recreate the database, so a fresh
   machine reaches a working state from the repo alone.
3. One command (`npm run setup`) SHALL start local Supabase, apply migrations and seed, and write the local URL and anon key
   into `packages/web/.env.local`.
4. The repo SHALL include a `.devcontainer/` definition with Node, the Supabase CLI and Docker-in-Docker, so the project
   opens ready to run in VS Code, Kiro, or GitHub Codespaces on any machine.
5. The repo SHALL include a `Dockerfile` that builds the web app and serves it with a small static server, so the front end
   can also be run as a container outside GitHub Pages.
6. The project SHALL run its local stack under **either Docker or Podman**, and `npm run setup` SHALL detect which is
   present and configure it, rather than requiring the contributor to export a socket path. Podman is a first-class path,
   not a footnote: Docker Desktop is blocked by policy on at least one machine this project is developed on, so treating it
   as the only option would mean no local stack at all there.
7. Local Supabase SHALL run with the analytics stack disabled, because its log collector bind-mounts the container
   runtime's own socket, which Podman on macOS cannot share into its VM. Nothing in Fastr reads those logs.
8. The README SHALL state what to do when no container runtime is permitted at all: a hosted Supabase project used as a
   development project, which needs no runtime, at the cost of the offline workflow.
7. The seed SHALL create two local test users with known passwords, for local development only.

### Requirement 21: Deployment

**User Story:** As the owner, I want Fastr deployed automatically, so that I can open it from any device.

#### Acceptance Criteria

1. A GitHub Actions workflow SHALL build the web app and publish it to GitHub Pages on every push to `main` that passes CI.
2. The build SHALL set the Vite base path to the repo name, so assets load under `https://essie002.github.io/fastr/`.
3. The Supabase URL and anon key for production SHALL be provided to the build as GitHub repository variables, not secrets,
   since they are public by design.
4. A separate, manually triggered workflow SHALL apply database migrations and deploy Edge Functions to the hosted Supabase
   project, using a Supabase access token stored as a GitHub secret in a protected environment.
5. The README SHALL walk through the one-time setup: creating the Supabase project, enabling Cron and invite-only auth,
   setting Edge Function secrets, generating VAPID keys, setting the GitHub variables and secret, and enabling Pages.
6. The README SHALL state the free-plan limits that affect Fastr (one-week pause, 500 MB, rate-limited email, Pages on
   private repos), their effect on notifications and data, and what Supabase Pro costs.
7. The README SHALL describe a keep-alive option (for example a scheduled GitHub Actions workflow that makes a lightweight
   request) and its own limit: GitHub disables scheduled workflows in repos with no activity for 60 days.

### Requirement 22: Continuous integration

**User Story:** As the owner, I want every change checked automatically, so that `main` is always deployable.

#### Acceptance Criteria

1. A GitHub Actions workflow SHALL run on every push and pull request: install with `npm ci`, typecheck, lint, format check,
   and unit tests.
2. The same workflow SHALL start local Supabase in the runner, apply all migrations from scratch, and run the database and
   RLS tests against it.
3. The workflow SHALL fail, rather than skip, if local Supabase does not start.
4. The workflow SHALL build the web app and the `Dockerfile` on every run, to catch a broken build before it reaches Pages.
5. The workflow SHALL use the built-in `GITHUB_TOKEN` with the least permissions needed. Only the manual Supabase deploy
   workflow may use a long-lived secret, and only inside a protected environment.

### Requirement 23: Documentation

**User Story:** As the owner, or someone new to the project, I want a README that gets me from clone to running app quickly.

#### Acceptance Criteria

1. The README SHALL follow Rally's structure: what it is, running it locally, environment variables table, layout, working
   on it, deployment, cost and limits, accessibility and what the tests do not cover, and where the design lives.
2. The README SHALL give copy-paste commands for: first-time setup, running in development, running tests, inviting a user,
   generating VAPID keys, and deploying.
3. The README SHALL document every environment variable and secret with where it lives, its default, and its purpose.
4. The README SHALL be written in short, plain sentences.

## Open questions

These do not block the design. Each has a default that the design will use unless you say otherwise.

1. **Public or private repo.** GitHub Pages on a private repo needs GitHub Pro ($4 a month). Default: public repo, since
   nothing secret is committed and the anon key is public by design.
2. **Supabase plan.** Free, with the one-week pause documented and a keep-alive workflow, or Pro at $25 a month. Default:
   free plus keep-alive.
3. **Front-end container.** Requirement 20.5 adds a `Dockerfile` for the web app. It is not needed for GitHub Pages; it is
   there so the app can run as a container elsewhere. Default: keep it, since it is small.
