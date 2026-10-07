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
npm start          # http://localhost:8080  (live data, falls back to demo data if offline)
npm run demo       # force demo data (for presenting without internet)
npm run check      # ping every data source and print the result
npm test           # unit + server tests
```

Set `VEDURVAKI_UA="Vedurvaki/0.2 you@example.com"` before `npm start`: MET Norway requires it.
Opening `index.html` directly (no server) still works with the built-in synthetic model.

## What is real and what is not

| | |
|---|---|
| Weather forecast | **Live** from Open-Meteo + MET Norway when reachable; badge shows "Beint" |
| Waves | Live (Open-Meteo Marine) for coastal regions |
| History (30 days) | Live ERA5 reanalysis via Open-Meteo archive |
| Station observations | Live from the Icelandic Met Office (field mapping to be confirmed with `npm run check`) |
| Aurora (Kp) | Live from NOAA SWPC |
| Road closures | Needs `VEGAGERDIN_DATEX_URL` |
| Bookings, prices, revenue, recovery rates | **Demo data** until a booking system is connected |
| Cancellation thresholds | Defaults per tour type; learned from outcomes pushed to `/api/ingest/outcomes` (not yet automated) |

If no provider is reachable the server serves clearly labelled demo data (`Sýnigögn`) so a
presentation never shows an empty screen; `?mode=live` disables the fallback.

> The code was built in a sandbox with no outbound access to these providers. Parsing, fusion,
> fallback and ingest are covered by tests with documented response shapes, but **the live calls
> have not yet been exercised**. Run `npm run check` on a networked machine first.

## Structure

```
index.html            dashboard markup
src/                  front end (classic scripts: data → model → live → views → main) + styles.css
server/index.js       static files + JSON API
server/connectors/    one file per data source (openmeteo, metno, imo, vegagerdin, noaa)
server/services/      forecast fusion, history, health, ingest, demo fallback
server/lib/           http client, cache (stale-on-error), regions, time helpers
fixtures/             synthetic demo data (npm run fixtures regenerates)
scripts/              check-connections, make-fixtures
test/                 node:test suite
docs/ADDONS.md        how to add connectors / push data in
```

## Data sources and licences

Open-Meteo (CC BY 4.0; free for non-commercial use only, commercial use needs a paid key) ·
MET Norway Locationforecast (CC BY 4.0 + NLOD, credit required) · NOAA SWPC (public domain) ·
Icelandic Met Office open observations API · Vegagerðin DATEX II. Required attributions are
shown in the page footer automatically.
