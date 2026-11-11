# Integration guide (API v1): connecting an existing system to Veðurvaki

For software companies and in-house teams that want to put weather and road risk into **their own** product:
a booking system, a guide app, a CRM, a dispatch board or a channel manager. The machine-readable contract is
[`openapi.json`](openapi.json) (OpenAPI 3.1, also served at `GET /api/v1/openapi.json`). Load it into Postman,
Insomnia or a code generator.

> **Decision support only.** Every risk answer carries this disclaimer. A person makes the final safety call.
> Integrators must not present a probability as a guarantee to end customers.

## 1. Three ways to integrate

Pick the lightest one that does the job.

| Pattern | You do | You get | Typical client |
|---|---|---|---|
| **A. Ask** (pull) | `GET /conditions`, `POST /risk` when you need an answer | Point forecast, visibility, waves, nearby cameras; go/change/cancel probabilities | Booking engine checkout ("weather risk for this date"), guide app |
| **B. Feed** (push in) | `PUT /tours`, `POST /bookings`, `POST /guests`, `POST /outcomes` | Your departures ranked in the dashboard; the model learns from **your** outcomes | Reservation system, ERP |
| **C. Listen** (push out) | Subscribe a webhook | Signed events when risk changes, a road closes, a guest chooses a new date, a decision is recorded | Ops tools, CRM, Slack/Teams bridges, accounting |

Most real deployments use all three: B keeps Veðurvaki in sync, C pushes changes back, A powers features in your own UI.

```
 Your system ──B: tours, bookings, guests, outcomes──▶ Veðurvaki ◀── weather models, IMO, Vegagerðin, NOAA, cameras
      ▲                                                  │
      └──────────── C: signed webhooks ◀──────────────────┘
      └──────────── A: GET /conditions, POST /risk ──────▶
```

## 2. Authentication and permissions

An administrator creates a key in **Admin → Partners & API**. The key is shown once and stored hashed. Send it as
`Authorization: Bearer vv_…` (preferred) or `x-api-key: vv_…`. Always use HTTPS.

| Scope | Grants |
|---|---|
| `read` | `GET /conditions`, `POST /risk`, `GET /departures`, `/cameras`, `/roads`, `/grid`, `/model` |
| `ingest` | `POST /bookings`, `/guests`, `/outcomes`, `/events` |
| `tours` | `GET` / `PUT /tours` |
| `webhooks` | create, list, test, pause and delete webhook subscriptions |

Give each integration **its own key with the fewest scopes**, so one can be revoked without touching the others.
A missing key returns `401`; a key without the scope returns `403`. No key can read guest personal data back:
that stays in the admin page.

## 3. Endpoints (base `/api/v1`)

| Method & path | Scope | Purpose |
|---|---|---|
| `GET /api/v1` | none | Service index and version |
| `GET /openapi.json` | none | The contract |
| `GET /conditions?lat=&lon=&hours=48` | read | Hourly gusts, wind, direction, rain, cloud, temperature, **visibility (km)**, waves, model spread; latest station reading; cameras within 30 km |
| `POST /risk` | read | Risk for **any point and activity** `{activity, lat, lon, start, durationHours, limits?, marine?}` or for a **configured tour** `{tourId, departure}` |
| `GET /departures?days=3` | read | Your departures with status, cancel probability, decide-by time, booked seats |
| `GET` / `PUT /tours` | tours | Read or upsert tours (meeting point, type, departures, limits, linked roads) |
| `POST /bookings` · `/guests` · `/outcomes` · `/events` | ingest | Push data in (one object or an array; idempotent) |
| `GET /cameras` · `/roads` · `/grid` · `/model` | read | Cameras with positions, road situations, national wind grid, learned thresholds |
| `GET/POST /webhooks`, `DELETE/PUT /webhooks/{id}`, `POST /webhooks/{id}/test`, `GET /webhooks/{id}/deliveries` | webhooks | Manage subscriptions |

`activity` is one of `snow, hike, cave, snork, aurora, whale, jeep, raft, atv`. Coverage is **Iceland only**
(lat 62.8–67.3, lon −25.5 to −12.5). The forecast window is the next ~72 hours.

### Example: risk for a glacier hike in your checkout

```sh
curl -s https://YOUR-HOST/api/v1/risk \
  -H "Authorization: Bearer $VV_KEY" -H "Content-Type: application/json" \
  -d '{"activity":"hike","lat":63.53,"lon":-19.37,"start":"2026-11-12T09:00:00Z","durationHours":4}'
```

```json
{ "status": "change", "probabilities": { "go": 0.58, "change": 0.27, "cancel": 0.15 }, "uncertainty": 0.12,
  "drivers": [{ "factor": "wind_gust", "maxDuringTrip": 21.4, "unit": "m/s", "riskStartsAt": 15, "usuallyCancelledAt": 25, "weight": 0.64 }],
  "roadClosed": null, "mode": "live", "disclaimer": "Decision support only. A person must make the final safety decision." }
```

### Example: push bookings from your system

```sh
curl -s https://YOUR-HOST/api/v1/bookings -H "Authorization: Bearer $VV_KEY" \
  -H "Content-Type: application/json" -H "Idempotency-Key: bokun-sync-2026-11-11T10:00" \
  -d '[{"tourId":2,"departure":"2026-11-12T09:00:00Z","pax":14,"capacity":20}]'
```

## 4. Webhooks (Veðurvaki → your system)

| Event | When |
|---|---|
| `departure.risk_changed` | Status changes (go/change/cancel) or the cancel probability moves by ≥ 15 points |
| `departure.road_blocked` | Vegagerðin reports a linked road closed or impassable |
| `guest.choice_made` | A guest picked a new date, another tour, a voucher or a refund on their private page |
| `case.resolved` | Staff completed the guest's choice (e.g. moved the booking in Bókun) |
| `decision.recorded` | A duty manager recorded ran / cancelled / changed |
| `ping` | Sent by the "test" button |

Body: `{"id":"evt_…","type":"…","createdAt":"…","data":{…}}`. Headers: `X-Vedurvaki-Event`, `X-Vedurvaki-Delivery`,
`X-Vedurvaki-Signature: t=<unix>,v1=<hex>`. The `v1` value is `HMAC-SHA256(secret, "<t>.<raw body>")`.

**Verify every delivery**: use the raw body, compare in constant time, and reject anything older than 5 minutes.

```js
// Node.js
import crypto from 'node:crypto';
export function verify(secret, header, rawBody) {
  const m = /t=(\d+),v1=([0-9a-f]{64})/.exec(header || ''); if (!m) return false;
  if (Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const want = crypto.createHmac('sha256', secret).update(`${m[1]}.${rawBody}`).digest();
  const got = Buffer.from(m[2], 'hex');
  return got.length === want.length && crypto.timingSafeEqual(want, got);
}
```

```python
# Python
import hmac, hashlib, re, time
def verify(secret: str, header: str, raw_body: bytes) -> bool:
    m = re.match(r"t=(\d+),v1=([0-9a-f]{64})", header or "")
    if not m or abs(time.time() - int(m[1])) > 300: return False
    want = hmac.new(secret.encode(), f"{m[1]}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, m[2])
```

```csharp
// C# (.NET)
static bool Verify(string secret, string header, string rawBody) {
  var m = System.Text.RegularExpressions.Regex.Match(header ?? "", @"t=(\d+),v1=([0-9a-f]{64})");
  if (!m.Success || Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - long.Parse(m.Groups[1].Value)) > 300) return false;
  using var h = new System.Security.Cryptography.HMACSHA256(System.Text.Encoding.UTF8.GetBytes(secret));
  var want = Convert.ToHexString(h.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"{m.Groups[1].Value}.{rawBody}"))).ToLowerInvariant();
  return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
    System.Text.Encoding.ASCII.GetBytes(want), System.Text.Encoding.ASCII.GetBytes(m.Groups[2].Value));
}
```

Answer with any `2xx` within 10 seconds and do the work afterwards (queue it). Anything else is retried after
1 min, 5 min, 30 min, 2 h and 6 h, then marked failed (visible in Admin → Partners → Deliveries). Deliveries can
arrive **more than once and out of order**: de-duplicate on `id` and compare `createdAt`.
Webhook URLs must be public `https://` addresses.

## 5. Conventions every client must handle

| Topic | Rule |
|---|---|
| Errors | `application/problem+json` (RFC 9457): `{type, title, status, detail, requestId}`. `400` bad input, `401` no key, `403` scope, `404`, `409` idempotency conflict, `422` valid but outside coverage/window, `429` rate limit, `502` upstream data unavailable |
| Request id | Every response has `X-Request-Id`. Send your own (6–64 chars) to correlate logs; quote it in support tickets |
| Rate limit | Default **120 requests/min per key** (`API_RATE_LIMIT`). Headers `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; on `429` wait `Retry-After` seconds |
| Idempotency | Send `Idempotency-Key` on every `POST`. The same key and body within 24 h replays the first answer; the same key with a different body returns `409` |
| Time | All times are ISO 8601 in **UTC** (Iceland is UTC all year). Departures are rounded to the hour |
| Units | m/s, mm/h, %, °C, km (visibility), m (waves). Decimal point in JSON; CSV exports use `;` and decimal comma |
| Freshness | Forecasts are refreshed every 10 min (models themselves update every 1–6 h), station observations 5 min, roads 2 min, wind grid 30 min. `mode` is `live` or `demo`, so **never show demo data as real** |
| Versioning | `/api/v1` only grows: new fields and endpoints may appear, so ignore unknown fields. Breaking changes go to `/api/v2` with at least 6 months' overlap |
| Attribution | Show the `attribution` strings you receive (Open-Meteo, MET Norway, IMO, Vegagerðin, Mapbox/OSM) wherever you display the data |

## 6. Checklist: connecting an existing system

1. **Map identifiers.** Decide which field in your system is the tour id and departure time. Use stable ids (never names) and send departures in UTC.
2. **Map products to tours.** One Veðurvaki tour = one activity at one meeting point. A product sold in three variants at the same place can share one tour.
3. **Set the meeting point precisely.** Use lat/lon to 4 decimals of where the activity actually happens (the glacier edge, not the office). Forecast precision depends on it.
4. **Initial load:** `PUT /tours`, then `POST /bookings` for the next 3 days.
5. **Keep in sync:** push bookings on every change (or every 5–15 min), always with an `Idempotency-Key`.
6. **Close the loop:** send `POST /outcomes` for every departure (ran / cancelled / changed). This is what makes the thresholds learn your operation.
7. **Subscribe to webhooks** and verify signatures. Build your handler idempotently.
8. **Personal data:** send guests only if you use the guest flow. Send the minimum (name, language, contact) and nothing else. The operator is the data controller; Veðurvaki is the processor (sign a DPA). Guest data is deleted automatically after the retention period.
9. **Test against a staging instance** in demo mode (`DATA_MODE=demo`) before production.
10. **Go live in shadow mode** for 2–4 weeks: the model runs alongside the duty managers, then compare with `npm run report` before anyone relies on it.

## 7. Deployment models

| Model | For | Notes |
|---|---|---|
| **Single-tenant** (one instance per operator) | Now | Docker image or Vercel. Data is isolated by design. Recommended for the first customers |
| **Embedded** | Software vendors | Call `/conditions` and `/risk` from your back end with one key per operator instance; never call from a browser with a key |
| **Multi-tenant SaaS** | Roadmap | Needs a tenant id on every record, a managed database (Postgres/Supabase) instead of file storage, and per-tenant keys and webhooks |

## 8. Security summary

- Keys hashed at rest, scoped, revocable; admin uses a separate password; browser sessions must send JSON (CSRF guard).
- Webhook and camera URLs pass the same SSRF check (public https hosts only, no redirects to private networks).
- Secrets live in environment variables, never in config files or the repository. The Mapbox token must be a **public** `pk.` token restricted to your domain; a secret `sk.` token is refused.
- Every write is logged with the key id; set up log shipping and backups of `data/` (or the database) in production.
