# AFSCME13 Lobby Meeting Display System

Clock-driven lobby schedule display for AFSCME Council 13, hosted on GitHub Pages with Supabase (Postgres + Auth + RLS).

## What This Solves
- Replaces timer-dependent PowerPoint slideshow behavior.
- Always computes the correct day/period from Eastern Time (`America/New_York`).
- Separates public display view from authenticated admin editing.
- Supports safe test mode and preview mode without breaking official live logic.

## Project Structure
```text
.
├── admin.html
├── display.html
├── index.html
├── css/
│   ├── admin.css
│   ├── base.css
│   └── display.css
├── js/
│   ├── admin.js
│   ├── auth.js
│   ├── config.js
│   ├── display.js
│   ├── supabaseClient.js
│   └── utils/
│       ├── constants.js
│       ├── dom.js
│       ├── schedule.js
│       └── time.js
└── sql/
    ├── schema.sql
    ├── policies.sql
    ├── rpc.sql
    └── seed.sql
```

## Official Display Logic
- Timezone: `America/New_York`
- Morning: `05:00` (inclusive) to before `17:00`
- Evening: `17:00` (inclusive) to before `05:00` next day
- Overnight edge handling:
  - `04:59 AM Tuesday` resolves to **Monday evening**
  - `05:00 AM Tuesday` resolves to **Tuesday morning**
  - `05:00 PM Tuesday` resolves to **Tuesday evening**

## Admin Features
- Email/password sign-in via Supabase Auth
- Domain-restricted editor access (`@afscme13.org`)
- Edit per day + period block
- Add/remove/reorder-friendly line items (room/time/event/building/notes/visible)
- Save block, clear block, reset full week
- Manual block preview
- Test mode controls:
  - Enable/disable test mode
  - Set test timestamp
  - Optional manual day/period override
  - Optional temporary switch times
- Event log viewer

## Display Features
- Fullscreen/kiosk-friendly layout
- Auto-refresh based on configured interval
- Refreshes on tab visibility/focus
- Detects and logs block changes (`display_block_changed`)
- Graceful empty state when no meetings are scheduled

## Supabase Setup
Run SQL scripts in this order in the Supabase SQL editor:

1. `sql/schema.sql`
2. `sql/policies.sql`
3. `sql/rpc.sql`
4. `sql/seed.sql`

### Auth setup
- Enable Email/Password auth provider.
- Create staff users with `@afscme13.org` addresses.
- In Supabase Auth URL settings, add your GitHub Pages URL(s) for redirects.

### Security model
- Public (`anon`) can read schedule + settings.
- Only authenticated domain-matching editors can write schedule/settings and admin event logs.
- Editor check is enforced in SQL (`public.is_afscme13_editor()`), not just UI.
- No privileged service key is used in frontend code.

## Frontend Configuration
Edit [`js/config.js`](./js/config.js):

```js
export const APP_CONFIG = Object.freeze({
  supabaseUrl: "https://YOUR_PROJECT_ID.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  allowedEditorDomain: "afscme13.org"
});
```

`supabaseAnonKey` is expected in a public frontend app; do not place service-role keys in this repo.

## GitHub Pages Deployment
1. Push this repo to GitHub.
2. Enable GitHub Pages (Deploy from branch).
3. Use root folder as publish source.
4. Open:
   - `https://<org-or-user>.github.io/<repo>/display.html` for lobby monitor
   - `https://<org-or-user>.github.io/<repo>/admin.html` for staff editor UI

## Manual QA Checklist
1. Confirm live mode at normal time:
   - If current ET is between 5:00 AM and 4:59 PM, block resolves to morning.
2. Test mode timestamp:
   - Set `Friday 4:59 PM`, confirm evening has not started yet.
   - Set `Friday 5:00 PM`, confirm switch to Friday evening.
   - Set `Saturday 5:01 AM`, confirm Saturday morning.
3. Manual override:
   - Enable test mode and set override day/period, confirm forced preview behavior.
4. Auth enforcement:
   - Non-domain account cannot edit.
   - Domain account can edit and save.
5. Display resilience:
   - Leave display open across refresh cycle and confirm it stays synced.

## Notes for Future Enhancements
- Invite-only editor onboarding flow via Supabase.
- Additional webhook subscribers from `event_log`.
- Optional room templates and weekly import helpers.
