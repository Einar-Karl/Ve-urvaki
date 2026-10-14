# Making Veðurvaki real for Arctic Adventures

Everything that can be done in code is done and tested. What remains needs **accounts, keys, Arctic's
own data, and a server**, which only you and Arctic can provide. This guide lists every step in order,
who does it, and how to know it worked.

> **Honest status.** The build environment could not reach any of the data providers, so the live
> calls (Open-Meteo and its models, MET Norway, IMO, NOAA, Bókun, Vegagerðin, Twilio, Resend) have **not been run against the real
> services yet**. Parsing, signing, fusion, fallback, learning, auth, the guest flow and messaging requests are covered by 43 automated
> tests using documented response shapes. **Step 7 (`check`) is where reality gets tested.**
> Anything marked ⚠ below may need a small fix once real responses are seen.

## What works today vs. what is still missing

| Works (tested) | Missing: needs a decision or build |
|---|---|
| Per-tour forecast at each meeting point from **5 sources** (ECMWF, ICON, GFS via Open-Meteo, plus MET Norway and Open-Meteo best-match; disagreement widens uncertainty) | **Writing back to Bókun** (moving bookings, promo codes, refunds): a person does it from the admin *To do* list |
| Bookings from Bókun (⚠ field names unverified) or from CSV/API pushes | **Guest replies by SMS**, calendar invites, delivery receipts |
| One-click duty-manager decisions, saved with the forecast on screen | **Individual user accounts.** One dashboard password and one admin password |
| Learning each tour's cancel threshold from those decisions (nightly) | **Revenue-recovery numbers** (64% rebook, 92%, 35%) are placeholder assumptions: replace with Arctic's real rates |
| Accuracy report for the shadow period (`npm run report`) | Other factors beyond wind gusts in the *learned* model (rain, waves, road closures are shown but only gust is fitted) |
| **Guest flow** (warning → rebook / other tour / voucher / refund / keep) in EN/DE/IS, **SMS (Twilio) + email (Resend)** with a dry-run default, seat holds | Push/SMS alerts to *staff* when a departure turns red |
| **Admin page** (tours, guests, requests, notifications, connections, model, policy, API keys) · **Partner API** for other programs | Several operators in one instance (one deployment per operator) |
| **Vegagerðin roads and stations** (no key needed); a closed access road forces "cancel" | Native-speaker review of German and Icelandic guest text |
| Password protection, health endpoint, Docker, CI | |
| Demo fallback so a presentation never goes blank | Forecast-at-decision-time archive for old seasons (imported history is matched to reanalysis weather instead) |

---

## The checklist

| # | Step | Who | Needs |
|---|---|---|---|
| 1 | Decide where it runs | You | A small Linux server or container host |
| 2 | Open-Meteo commercial key | You | Credit card / company details |
| 3 | Bókun API keys + product IDs | Arctic admin | Bókun admin login |
| 4 | Vegagerðin DATEX II URL | You | Web page / possibly an email |
| 5 | Fill in the real tour list | You + Arctic ops | Tour data, ~10 min per tour |
| 6 | Deploy | You | Terminal access to the server |
| 7 | Run the connection check and fix what it shows | You (+ me) | Output of `npm run check` |
| 8 | Backfill past decisions | Arctic ops | Excel sheet of past seasons |
| 9 | Shadow period: 4–8 weeks of recording decisions | Arctic duty managers | 2 minutes per decision |
| 10 | Go-live review | You + Arctic ops lead | `npm run report` |

### 1. Decide where it runs
It needs an always-on Node/Docker host with outbound internet. Any small Linux VM or container
service works (Docker Compose files are included). You also need a hostname such as
`vedur.arcticadventures.is` (ask whoever manages Arctic's DNS) and HTTPS in front of it. A simple way
is Caddy, which gets certificates automatically:

```
vedur.arcticadventures.is {
    reverse_proxy localhost:8080
}
```

**Why not just a laptop?** The learning data in `data/` accumulates over weeks, and the dashboard must
be reachable by every duty manager. Do not expose it without step 6's password.

### 2. Open-Meteo key (required for commercial use)
The free API is **non-commercial only**. Arctic is a company, so subscribe at
<https://open-meteo.com/en/pricing> (check current prices there) and put the key in `OPENMETEO_API_KEY`.
⚠ The paid hosts are assumed to be the same names with a `customer-` prefix, as Open-Meteo documents;
`npm run check` will show immediately if not.

MET Norway needs no key, only a contact address in `VEDURVAKI_UA`, e.g.
`Vedurvaki/0.3 ops@arcticadventures.is`. They block anonymous clients.

### 3. Bókun keys and product IDs (Arctic admin)
1. In Bókun, create an **API key pair** (an *access key* and a *secret key*). Bókun documents this under
   *"Configuring the platform for API usage and authentication"* at <https://bokun.dev>. If API access
   isn't visible in your Bókun settings, ask Bókun support to enable it for Arctic's account. Ask for
   **read-only** access if the option exists; Veðurvaki only reads availability.
2. For each tour, find its **Bókun activity/product ID** (the number in the product's URL in the Bókun
   extranet).
3. Put the keys in `.env` as `BOKUN_ACCESS_KEY` / `BOKUN_SECRET_KEY`. **Never** commit them or paste
   them into chat; `.env` is git-ignored.
4. Put each product ID into `bokunProductId` in `config/tours.json` (step 5).

Signing follows Bókun's documented scheme (HMAC-SHA1 over date + access key + method + path).
⚠ Unverified: the base URL (`https://api.bokun.io`; override with `BOKUN_BASE`) and the exact field
names in the availability response. After step 7, `check` prints the real field names. If they differ
from what `server/connectors/bokun.js` expects, that's a ten-minute fix.

**Alternative with no API access:** export the day's departures to a spreadsheet and push them with
`npm run import:bookings` (template: `docs/bookings-template.csv`), or POST them from Zapier/Make to
`/api/ingest/bookings`. The dashboard uses them automatically.

### 4. Vegagerðin road data (no key needed)
Vegagerðin's open road-conditions feed (`gagnaveita.vegagerdin.is/api/faerd2017_1`) and road-weather stations feed (`…/vedur2014_1`) are
used automatically. Nothing to configure. The road feed has no coordinates, so you tell each tour which road sections matter:
Admin → Tours → *Edit* → **Road sections that must be open** (search "Hringvegur", "Þórsmerkurvegur" …; typing without Icelandic letters works).
If any linked section is closed or impassable, that tour's departures within 24 hours are treated as very likely cancelled and flagged "Vegur lokaður".
⚠ The road feed's field names were confirmed from open-source clients; the *stations* feed's wind field names were not.
`npm run check` prints a sample of both so any mismatch is a five-minute fix.

### 5. Fill in the real tour list: `config/tours.json`
The file ships with **12 example tours and `"demo": true`**. Replace them with Arctic's tours and set
`"demo": false`. One entry per tour:

| field | meaning |
|---|---|
| `id` | any unique number; keep it stable (decisions are stored against it) |
| `name` | shown in the dashboard |
| `type` | `snow`, `hike`, `cave`, `snork`, `aurora`, `whale`, `jeep`, `raft`, `atv`: picks which weather factors matter |
| `lat`, `lon` | the **meeting/activity point**, not the office. Right-click in Google Maps to copy |
| `region` | `rvk`, `rnes`, `west`, `hl`, `south`, `se`, `north`: nearest area (used for the map wind field) |
| `departures` | local times, e.g. `["09:00","13:00"]` (Iceland time = UTC) |
| `durationHours` | trip length including loading |
| `capacity`, `priceISK` | seats and price per guest |
| `bokunProductId` | from step 3 |
| `marine` | boat tours only: `{ "lat":…, "lon":… }` an **offshore** point for wave data |
| `limits` | **optional, recommended:** Arctic's own rules of thumb, e.g. `{"g":[16,27]}` = "we start worrying at 16 m/s gusts, we cancel around 27". Keys: `g` gust m/s, `p` rain mm/h, `c` cloud %, `s` waves m, `t` °C |

**Ask the guides and duty managers for `limits`.** Without them the app uses generic defaults per tour
type until it has learned from real decisions (step 9). The dashboard shows a yellow box listing any
mistakes in this file (Tengingar section).

Optional: `config/stations.json` pins a Met Office weather station to a tour site (e.g. the station
nearest a glacier tongue). `check` lists station IDs.

### 6. Deploy
```sh
git clone https://github.com/Einar-Karl/Ve-urvaki.git && cd Ve-urvaki
git checkout claude/brave-hypatia-ty7qrx        # or main, once merged
cp .env.example .env && nano .env               # fill in: DASHBOARD_PASSWORD, VEDURVAKI_UA, keys…
docker compose up -d --build
docker compose logs -f                           # expect: "Veðurvaki → http://localhost:8080"
```

**Set `DASHBOARD_PASSWORD`** (the server prints a warning if you don't). Everyone logs in with user
`arctic` (or `DASHBOARD_USER`) and that password. `INGEST_TOKEN` lets other systems POST data.
Without Docker: `npm run start:env` (Node 20+).

`data/` (recorded decisions and pushed bookings) is the training data: **back it up**.
It holds guest *counts* only, no names or contact details.

### 7. Run the connection check, and fix what it shows
```sh
docker compose exec vedurvaki node scripts/check-connections.js
```
You want ✔ for Open-Meteo, MET Norway, NOAA, IMO, Bókun. Vegagerðin shows "not configured" until
step 4. For each ✘ the message says what failed (`HTTP 403` = firewall or bad key, `timeout` = network).
The command also prints a **sample IMO record** and the **Bókun field names**. **Send me that
output** and I will correct any mismatch in the parsers. Then open the dashboard: the badge top-right
should read **"Beint · veðurgögn"** and the status line should say **"Bókanir: Bókun · sótt …"**.
If it says "Sýnigögn", the Tengingar panel at the bottom says exactly why.

### 8. Backfill past decisions (Arctic ops)
This gives the model a head start. Build one spreadsheet of **every departure whose cancel/run decision
was recorded**, for as many seasons as exist (template `docs/outcomes-template.csv`):

```
tourId;departure;outcome;reason
2;14.02.2025 09:00;cancelled;wind
2;15.02.2025 09:00;ran;
```
`outcome` is `ran`, `cancelled` or `changed`. Save as *CSV (semicolon delimited)*, copy it into `data/`,
then:
```sh
docker compose exec vedurvaki node scripts/import-csv.js outcomes /app/data/outcomes.csv
docker compose exec vedurvaki npm run train
```
**Include the departures that ran, not only the cancellations.** A threshold can't be learned from one
side. A tour needs **at least 30 decisions with at least 8 cancelled and 8 ran** before its limits are
replaced by learned ones; the training output says what each tour still lacks. Imported history is
matched to ERA5 reanalysis weather (not the forecast people actually saw then), so treat it as a
starting point. Decisions recorded live (step 9) are better and take over as they accumulate.

### 9. Shadow period: 4 to 8 weeks
Duty managers keep deciding exactly as they do today. For each departure they also click
**Staðfesta aflýsingu / Staðfesta brottför / Breyting** in the dashboard (they type their name once).
Each click saves their decision **plus the forecast on screen at that moment**: the best training
data available. Nightly at 03:30 UTC the model re-learns (`AUTO_TRAIN=1`).

Weekly, look at the scorecard:
```sh
docker compose exec vedurvaki npm run report
```
It shows how often the model agreed with the duty manager, how many cancellations it missed, and
whether its percentages are honest (e.g. "when it says 80%, did they cancel ~80% of the time?").

### 10. Go-live review
Meet with Arctic's operations lead and agree the bar **before** looking at the numbers. A reasonable
starting point (a suggestion, not a standard): high agreement over the last few weeks, **no or very few
"model said go, they cancelled" misses** on safety-critical tours, and probabilities that roughly match
outcomes. Then start using the queue to *prioritise* attention. The system always recommends and a
person always decides; every decision is logged with who and when.

---

## Phase 2: guest messaging, admin and other programs

Full detail in [GUEST-FLOW.md](GUEST-FLOW.md) and [PARTNER-API.md](PARTNER-API.md). In short:

| # | Step | Who | Needs |
|---|---|---|---|
| 11 | Set `PUBLIC_BASE_URL`, `ADMIN_PASSWORD`; restart | You | server access |
| 12 | Resend account + verified domain → `RESEND_API_KEY`, `EMAIL_FROM` | You | DNS access for the domain |
| 13 | Twilio account + sender → `TWILIO_*` | You | credit card; check sender rules for Iceland and guests' countries |
| 14 | Admin → Settings: brand, contact phone/email, what guests are offered | You + Arctic ops | decisions on voucher bonus and refunds, checked against your terms |
| 15 | Get guests into the system (CSV or API) | Arctic ops / booking tool | booking exports with email or phone |
| 16 | **Dry-run rehearsal:** prepare and send to yourself and colleagues; read the outbox | You + ops | none; messages are not sent in dry-run |
| 17 | Native-speaker read of German and Icelandic guest text; privacy notice and processor agreements | Arctic | a colleague/translator; whoever handles GDPR |
| 18 | `MESSAGING_MODE=live` | You | the above |

**Admin page** (`/admin`): Overview (setup checklist), Notifications, Guest requests, Tours, Guests, Connections, Model, Settings,
Partners & API keys, Activity. Give other programs their own key under *Partners & API*.

## Operating it

* **Update:** `git pull && docker compose up -d --build`
* **Health:** `GET /healthz` (no login) for an uptime monitor; the *Tengingar* panel for provider status
* **Logs:** `docker compose logs -f`
* **Add another system** (accounting, ops tool, spreadsheet): see [ADDONS.md](ADDONS.md)
* **Attribution:** MET Norway and Open-Meteo credits are shown in the footer automatically. Keep them.

## Licences and data protection

* Open-Meteo: CC BY 4.0; commercial use needs the paid plan (step 2). MET Norway: CC BY 4.0 + NLOD,
  credit required. NOAA: public domain. Met Office and Vegagerðin: check their current terms before
  commercial use. ⚠ not verified in the build environment.
* Bókun: use of the API is governed by Bókun's API terms (<https://www.bokun.io/api-terms>).
  Check them for what Arctic may do with the data.
* Veðurvaki stores no guest personal data today. If you later add guest messaging, you will handle
  names, phone numbers and emails: that needs a data-processing agreement with the SMS/email provider
  and a GDPR review. That is why messaging is deliberately not built yet.

## Troubleshooting

| You see | Likely cause |
|---|---|
| Badge says **Sýnigögn** | No weather source reachable: server firewall, or invalid Open-Meteo key. See Tengingar |
| Open-Meteo ✘ `HTTP 401/403` | Key missing/wrong, or still using the free host for commercial traffic |
| MET Norway ✘ `HTTP 403` | `VEDURVAKI_UA` missing or generic |
| Guests don't get messages | Admin header says "dry-run": set `MESSAGING_MODE=live`. Or the provider shows an error in Activity (wrong key, unverified domain, invalid number) |
| Guest link says "not valid or has expired" | Link older than `linkValidDays` after departure, or the booking was erased; prepare a new message |
| Bókun ✘ or "Bókanir: sýnigögn" | Wrong keys, API access not enabled, no `bokunProductId`, or ⚠ field names differ (send me the `check` output) |
| Yellow box in Tengingar | A mistake in `config/tours.json`; the message names the tour and field |
| "Þarf fleiri til að læra" on a tour | Fewer than 30 decisions or fewer than 8 of either kind. Keep recording |
| Everything asks for a password | `DASHBOARD_PASSWORD` is set (intended): user `arctic` |
