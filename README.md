# Veðurvaki

Weather-risk operations dashboard for tour operators in Iceland (demo client: *Arctic Adventures*).
It estimates the chance that each departure in the next 72 hours is cancelled or changed, ranks a
decision queue by deadline and risk, suggests recovery actions with the revenue impact, and shows
the last 30 days of weather against each tour's cancellation thresholds.

Built to be an **add-on to other programs**: weather, road and booking data come in through
pluggable connectors and an ingest API ([docs/ADDONS.md](docs/ADDONS.md)).

## Run

Node 20+, no dependencies.

```sh
npm start             # http://localhost:8080 (live data, falls back to labelled demo data if offline)
npm run demo          # force demo data (presenting without internet)
npm run check         # ping every data source and print the result
npm run train         # learn per-tour cancellation thresholds from recorded decisions
npm run report        # shadow-mode scorecard: model vs. duty managers
npm test              # 49 tests
docker compose up -d --build   # production-style run (see .env.example)
```

**Making it real for Arctic Adventures: follow [docs/SETUP-ARCTIC.md](docs/SETUP-ARCTIC.md).**
Pages: dashboard `/`, **admin `/admin`**, guest page `/g/<private link>`. Guest flow: [docs/GUEST-FLOW.md](docs/GUEST-FLOW.md). Other programs: [docs/PARTNER-API.md](docs/PARTNER-API.md).
Opening `index.html` directly (no server) still works with the built-in synthetic model.

## What is real and what is not

| | |
|---|---|
| Weather forecast | **Live** from Open-Meteo + MET Norway when reachable, per tour meeting point; badge shows "Beint" |
| Waves, history (30 d), aurora Kp, station readings | Live (Open-Meteo Marine/ERA5, NOAA, Icelandic Met Office, Vegagerðin stations) |
| Road closures | Live from Vegagerðin (no key); a closed linked road forces "cancel" |
| Guest flow (rebook / other tour / voucher / refund) | Built; EN/DE/IS; SMS via Twilio, email via Resend; **dry-run until `MESSAGING_MODE=live`** |
| Admin page, partner API keys | Built |
| Cameras | Built: link-outs to public cameras (Vegagerðin, Met Office) and a safe snapshot relay for **your own** cameras ([docs/CAMERAS.md](docs/CAMERAS.md)). No open-licence Icelandic camera feed was found to embed |
| Bookings | **Live from Bókun** when keys are set; else pushed CSV/API snapshots; else demo numbers |
| Tour list | `config/tours.json`: ships with example tours (`"demo": true`) |
| Decisions | Duty managers record them in the dashboard with the forecast on screen |
| Cancellation thresholds | Manual `limits` per tour, then **learned nightly** from recorded decisions |
| Bókun write-back (moving bookings, promo codes, refunds), revenue-recovery rates | **Not built / placeholder.** A person acts on the admin "To do" list |

If no weather provider is reachable the server serves clearly labelled demo data (`Sýnigögn`);
`?mode=live` disables the fallback.

> Built in a sandbox with no outbound access to these providers. Parsing, signing, fusion, fallback,
> learning and auth are covered by tests, but **the live calls have not yet been exercised**.
> `npm run check` on the real server is step 7 of the setup guide.

## Structure

```
index.html            dashboard · admin.html admin · guest.html guest page
src/                  front end (classic scripts: data → model → live → views → main) + styles.css
server/index.js       static files + JSON API
server/services/cameras.js  camera registry + SSRF-safe snapshot relay
server/connectors/    one file per data source (openmeteo + models, metno, openweather, imo, vegagerdin, noaa, bokun, twilio, resend)
server/services/      forecast fusion, history, bookings, roads, observations, learning, cases (guest flow), messaging, guests, policy, keys, health, ingest, demo
server/lib/           http client, cache (stale-on-error), regions, tour sites, time helpers
config/               tours.json, cameras.json (edit), thresholds.json (written by training), stations.json
Dockerfile, docker-compose.yml, .env.example   deployment
fixtures/             synthetic demo data (npm run fixtures regenerates)
scripts/              check-connections, train, report, import-csv, make-fixtures
test/                 node:test suite
docs/SETUP-ARCTIC.md  step-by-step go-live guide
docs/GUEST-FLOW.md    guest messaging, rebooking, vouchers, refunds
docs/PARTNER-API.md   API for other programs and operators
docs/CAMERAS.md       public cameras, own cameras with open-source tools, privacy
docs/ADDONS.md        how to add connectors
```

## Data sources and licences

Open-Meteo (CC BY 4.0; free for non-commercial use only, commercial use needs a paid key) ·
MET Norway Locationforecast (CC BY 4.0 + NLOD, credit required) · NOAA SWPC (public domain) ·
Icelandic Met Office open observations API · Vegagerðin DATEX II · Bókun API (terms at bokun.io/api-terms). Required attributions are
shown in the page footer automatically.
