# Connecting other programs

Veðurvaki has two ways to take in information from other systems:

1. **Connectors** — pull data from an API on a schedule (weather, roads, bookings…).
2. **Ingest API** — other programs *push* data to Veðurvaki (outcomes, bookings, notes).

## 1. Write a connector

Drop a file into `server/connectors/` (or into any folder named by `CONNECTORS_DIR`). It is picked
up on restart. A connector default-exports an object; implement only the kinds you provide:

```js
export default {
  id: 'mybooking',                       // unique
  label: 'My booking system',
  kinds: ['bookings'],                   // forecast | marine | history | observation | aurora | road | …
  license: 'Vendor terms',
  attribution: 'Bookings: Vendor',       // shown in the page footer when the data is used
  configured: () => !!process.env.MYBOOKING_TOKEN,   // optional; false → shown as "Ekki stillt"
  async bookings() { /* return data */ },
  async ping() { return 'ok: 120 departures'; },     // used by the Tengingar panel and `npm run check`
};
```

Kinds the app already consumes:

| kind | method | returns |
|---|---|---|
| `forecast` | `forecast({ sites })` | `{ siteId: { 'YYYY-MM-DDTHH': { g, w, dir, p, c, t } } }` (gust m/s, wind m/s, from-direction °, mm/h, cloud %, °C; UTC hours) |
| `marine` | `marine({ sites })` | `{ siteId: { 'YYYY-MM-DDTHH': { s } } }` (wave height m) |
| `history` | `history({start,end,sites})` | same shape as `forecast`, with `g` and `p` |
| `observation` | `observation({ sites })` | `{ regions: { siteId: { station, name, km, g, w, dir, t, p, time } } }` |
| `bookings` | `bookings({ tours, start, end })` | `{ departures: [ { tourId, departure: ISO, pax, capacity, soldOut } ], errors: [] }` |
| `aurora` | `aurora()` | `[ { t: ISO, kp } ]` |
| `road` | `road()` | `{ sections: [ { id, name, short, state: 'open' or 'closed', code, desc, note, updated } ] }` (tours link to sections by name via `roads` in `tours.json`) |
| `sms` | `sms({ to, text })` | `{ providerId, status }`. Only called when `MESSAGING_MODE=live` |
| `email` | `email({ to, subject, text, html, replyTo })` | `{ providerId, status }` |

Several `forecast` connectors can run side by side: values are averaged and the disagreement
between them widens the cancellation-uncertainty figure. Adding a second weather provider is just
adding a file.

A *site* is one of the 7 regions in `server/lib/regions.js` (mirror of `REG` in `src/data.js`) or a tour
meeting point (`tour:<id>`, from `config/tours.json`).

## 2. Push data in

```sh
# a departure's real result: this is the training label for the risk model
curl -X POST localhost:8080/api/ingest/outcomes -H 'content-type: application/json' \
  -d '{"tourId":2,"departure":"2026-10-07T09:00:00Z","outcome":"cancelled","reason":"wind","decidedAt":"2026-10-06T16:30:00Z"}'

# booking snapshot
curl -X POST localhost:8080/api/ingest/bookings -H 'content-type: application/json' \
  -d '[{"tourId":2,"departure":"2026-10-07T13:00:00Z","pax":48,"capacity":64}]'
```

* `outcome` is one of `ran`, `cancelled`, `changed`. Arrays are accepted. Invalid records are
  rejected with `422` and a per-record error list; nothing is half-written.
* Data is appended to `data/ingest/<kind>.jsonl` (git-ignored).
* `GET /api/ingest/outcomes` returns the latest rows; `GET /api/ingest/outcomes.csv` exports
  European-Excel CSV (`;` separator, `,` decimal mark, UTF-8 BOM).
* Set `INGEST_TOKEN` and send it as `x-api-key` to require authentication.

Connect Zapier/Make/Power Automate/n8n or a nightly script to these URLs to feed in
Excel sheets or anything else without touching the code. The dashboard itself posts decisions here.

## Configuration

| variable | purpose |
|---|---|
| `PORT` | HTTP port (default 8080) |
| `DATA_MODE` | `auto` (live, fall back to demo), `live` (never fall back), `demo` |
| `VEDURVAKI_UA` | User-Agent sent to providers. **Set this to include your email**: MET Norway requires it |
| `OPENMETEO_API_KEY` | Paid Open-Meteo key; switches to the `customer-` hosts. Required for commercial use |
| `VEGAGERDIN_DATEX_URL` / `VEGAGERDIN_AUTH` | Vegagerðin DATEX II service URL (and optional Authorization header) |
| `IMO_OBS_URL` | Override the IMO observations endpoint |
| `DASHBOARD_PASSWORD`, `DASHBOARD_USER` | HTTP Basic login for the dashboard and API (set this in production) |
| `INGEST_TOKEN`, `INGEST_DIR` | `x-api-key` for external programs posting to `/api/ingest/*`; relocate the store |
| `BOKUN_ACCESS_KEY`, `BOKUN_SECRET_KEY`, `BOKUN_BASE` | Bókun API credentials / host override |
| `TOURS_FILE`, `MODEL_FILE` | Alternative paths for `tours.json` / `thresholds.json` |
| `AUTO_TRAIN` | `1` = retrain thresholds nightly at 03:30 UTC |
| `CONNECTORS_DIR` | Extra folder of connector files |

`config/stations.json` pins IMO station ids to regions when the feed has no coordinates.

## Status of each connector

| connector | verified how | notes |
|---|---|---|
| Open-Meteo | request/response shapes from public docs; parsing unit-tested | Not yet run against the live API from the build sandbox (egress blocked) |
| MET Norway | same | Requires identifying User-Agent and visible credit |
| NOAA Kp | same | Public domain |
| Bókun bookings | HMAC signing unit-tested against the documented scheme; response fields **unverified** | Needs `BOKUN_ACCESS_KEY` / `BOKUN_SECRET_KEY` and `bokunProductId` per tour |
| IMO observations | endpoint URL from an open-source client; field names **unverified** | Run `npm run check` once: it prints a sample record so `ALIAS` in `connectors/imo.js` can be confirmed |
| Vegagerðin DATEX II | parser unit-tested on a hand-written sample; **URL not set** | Set `VEGAGERDIN_DATEX_URL` from vegagerdin.is |

Run `npm run check` on any machine with internet access to get the real answer for each.
Full go-live steps: [SETUP-ARCTIC.md](SETUP-ARCTIC.md).
