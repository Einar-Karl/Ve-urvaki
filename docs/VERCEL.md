# Deploying on Vercel

`vercel.json` + `api/index.js` run the whole app (dashboard, admin, guest pages, API) as one Vercel Function in the Dublin region.
Every path is rewritten to the function, which does its own routing and login, exactly as it does locally.

## Read this first: storage is temporary

A Vercel Function has no durable disk. Veðurvaki writes guests, decisions, vouchers, API keys, tours, settings and camera config to files,
and on Vercel those files live in `/tmp`, private to one function instance and **lost when the instance is recycled** (minutes to hours, or when it scales out to a second instance).

| Works well on Vercel | Does not survive there |
|---|---|
| Dashboard with live weather, roads, bookings (Bókun), history | Guests, cases, vouchers, outbox, audit log |
| Guest page rendering and the risk model | Decisions recorded by duty managers (so learning cannot work) |
| Admin page (to look around and demo) | Edits to tours, settings, policy, cameras, API keys |
| Weather/road connectors, sending messages (if configured) | Nightly training and the retention job (no background timers on Vercel) |

**Use Vercel for a demo or preview. For Arctic Adventures' real use run the Docker setup** (`docker compose up -d`) on a host with a disk, or
add a database adapter for `server/lib/store.js` (Vercel Postgres/Blob/Supabase). The admin page shows a red "Temporary storage" banner while on Vercel.

## Deploy

1. In Vercel: **Add New → Project → import the GitHub repository** (`Einar-Karl/Ve-urvaki`). Framework preset: *Other*. No build command, no output directory.
2. **Environment variables** (Project → Settings → Environment Variables). On Vercel the app refuses to serve the dashboard or admin until a password exists:
   * `DASHBOARD_PASSWORD` (required), `ADMIN_PASSWORD` (recommended)
   * `VEDURVAKI_UA` e.g. `Vedurvaki/0.4 you@example.com` (MET Norway requires it)
   * `OPENMETEO_API_KEY` for commercial use; `DATA_MODE=demo` to force demo data
   * `MESSAGING_MODE`, `TWILIO_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `BOKUN_*` as in `.env.example`
   * `PUBLIC_BASE_URL` is optional: guest links fall back to the project's production URL
3. Deploy. Check `/healthz` (open) and log in at `/` with user `arctic` (or `DASHBOARD_USER`).

## Limits
* Function duration is capped at 30 s (the forecast fetches several sources in parallel with 8–15 s timeouts, and results are cached per instance for 10 minutes).
* The first request after idle is a cold start (a few seconds).
* Camera snapshots on a private network (VPN) cannot be reached from Vercel; use cameras with a public HTTPS address behind a login, or the Docker setup.
