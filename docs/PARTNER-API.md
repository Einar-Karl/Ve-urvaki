# Partner API: send your tours, bookings and guests

For other programs (a booking tool, Zapier/Make, a spreadsheet script) or another operator's system to put
their data into Veðurvaki.

> **One deployment = one operator.** Data is not separated between companies inside one instance. A second operator
> should run their own instance (the Docker setup takes minutes). The API below is how any system feeds *that* instance.

## Authentication

Create a key in **Admin → Partners & API**. It is shown once. Send it in the `x-api-key` header. Keys are stored hashed, can be
revoked at any time, and carry permissions:

| Permission | Allows |
|---|---|
| *send data* (`ingest`) | `POST /api/ingest/guests`, `/bookings`, `/outcomes`, `/events` |
| *edit tours* (`tours`) | `GET` / `PUT /api/partner/tours` |

A key cannot read guest records back, cannot use the admin page, and cannot call any other endpoint. Always send
`Content-Type: application/json` and use HTTPS.

## Endpoints

All accept one object or an array. A bad record rejects the whole request with `422` and a per-record error list, so nothing is half-saved.

### `PUT /api/partner/tours`: create or update tours (upsert by `id`)
```json
{ "id": 7, "name": "Glacier hike", "type": "hike", "lat": 63.53, "lon": -19.35,
  "departures": ["09:00", "13:00"], "durationHours": 3, "capacity": 40, "priceISK": 16900,
  "bokunProductId": "123456", "roads": ["Hringvegur"], "limits": { "g": [16, 27] } }
```
`type`: `snow hike cave snork aurora whale jeep raft atv`. `lat/lon` is the meeting point (used for the forecast). `roads` are Vegagerðin
section names/ids that must be open. `limits.g` is your own `[risk starts, usually cancelled]` gust rule in m/s (optional).
Optional: `region`, `marine {lat,lon}` for boat tours. `GET /api/partner/tours` returns the list.

### `POST /api/ingest/guests`: people on a booking (upsert by `ref` + `departure`)
```json
{ "ref": "AB-123", "tourId": 7, "departure": "2026-10-20T09:00:00Z", "pax": 4, "name": "Anna Schmidt",
  "email": "anna@example.com", "phone": "+4915112345678", "lang": "de", "paidISK": 67600 }
```
Required: `ref`, `tourId`, `departure`, `pax`, and `email` or `phone`. `lang`: `en`, `de`, `is`. Phones: international (`+…`); 7-digit Icelandic numbers get `+354`.
Times are UTC (Iceland local time). Sending the same `ref` + `departure` again updates the record.

### `POST /api/ingest/bookings`: seats taken per departure (latest snapshot wins)
```json
{ "tourId": 7, "departure": "2026-10-20T09:00:00Z", "pax": 31, "capacity": 40 }
```
Used when Bókun is not connected. The dashboard and the guest page's "seats left" use it.

### `POST /api/ingest/outcomes`: what really happened (teaches the model)
```json
{ "tourId": 7, "departure": "2026-10-20T09:00:00Z", "outcome": "cancelled", "reason": "wind", "decidedBy": "Anna" }
```
`outcome`: `ran`, `cancelled` or `changed`. Past seasons can be loaded in bulk: `npm run import:outcomes file.csv`.

### `POST /api/ingest/events`: anything else worth keeping (notes, overrides). Stored as written.

## Example (curl)
```sh
curl -X POST https://vedur.example.is/api/ingest/guests \
  -H 'x-api-key: vv_…' -H 'content-type: application/json' \
  -d '[{"ref":"AB-123","tourId":7,"departure":"2026-10-20T09:00:00Z","pax":4,"name":"Anna","email":"anna@example.com","lang":"de"}]'
# → 202 {"ok":true,"accepted":1}
# → 422 {"ok":false,"errors":[{"index":0,"error":"pax must be a number ≥ 1"}]}
```

## CSV instead of an API
Everything above can also be imported from Excel exports (semicolon delimited, comma decimals):
Admin → *Tours* / *Guests* → **Import CSV** (check first, then import), or on the server `npm run import:outcomes` / `import:bookings`.
Dates may be `2026-10-20 09:00`, `20.10.2026 09:00` or ISO.

## Reliability notes
* Pushes are idempotent (upserts), so retrying is safe.
* Guest personal data is erased automatically after the retention period; do not treat Veðurvaki as your system of record for guests.
* There is no per-key rate limit yet. Keep batches reasonable (hundreds, not millions, per request).
