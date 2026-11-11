# Data sources: what is connected, how precise it is, and what remains

Status as of this version. "Built" means the code and tests exist. "Verified live" means it has been called
against the real service. The development sandbox had no outbound access, so **nothing is verified live yet**:
run `npm run check` on the production server first (step 7 of [SETUP-ARCTIC.md](SETUP-ARCTIC.md)).

## 1. Weather and visibility

| Source | What | Resolution | Status | Remaining |
|---|---|---|---|---|
| Open-Meteo: ECMWF IFS 0.25° | Gusts, wind, rain, cloud, temp, visibility | ~25 km, 4–10 days | Built | Paid key for commercial use (`OPENMETEO_API_KEY`) |
| Open-Meteo: ICON, GFS | Same | 11–25 km | Built | Same key |
| **Open-Meteo: DMI HARMONIE-AROME** | Same, including **visibility** | **2 km**, ~2.5 days, covers Iceland | Built (new) | Same key. The best local model for the next 60 h |
| MET Norway Locationforecast | Gusts, wind, rain, cloud, temp | ~2.5 km Nordic / ECMWF beyond | Built | `VEDURVAKI_UA` with a real contact address |
| OpenWeatherMap One Call 3.0 | Extra vote | Global | Built, optional | Subscription |
| Open-Meteo Marine | Wave height (boat and snorkel tours) | ~5–25 km | Built | Same key |
| Open-Meteo ERA5 archive | 30-day history for thresholds | ~25 km | Built | Same key |
| **Veðurstofa Íslands (IMO) forecasts** | Official Icelandic HARMONIE (2.5 km) and text warnings | 2.5 km | **Not built** | Ask IMO for terms and the XML/JSON forecast feed; add as a connector (see [ADDONS.md](ADDONS.md)) |
| IMO warnings (yellow/orange/red, CAP) | Official weather warnings per area | Area | **Not built** | Highest-value next connector: a red or orange warning should force "cancel" the way a closed road does |

**How precision works today.** Every tour is forecast at its **own meeting point** (not the region). Sources are
averaged; their disagreement (`sourceSpread`) widens the stated uncertainty. Visibility is the **lowest**
value any source gives (cautious). For more precision:

1. Put each tour's lat/lon where the activity happens (glacier edge, cave mouth, harbour), to 4 decimals.
2. Keep DMI HARMONIE in `OPENMETEO_MODELS` (default).
3. Add IMO's own HARMONIE forecast and warnings (above).
4. Let the nightly training learn each tour's thresholds from recorded outcomes (`AUTO_TRAIN=1`).
5. **Local bias correction** (roadmap): compare each tour's forecast with the nearest station observation over
   30–90 days and correct systematic errors (e.g. gusts under-forecast at Skógafoss). The data is already stored.

## 2. Observations (what is happening now)

| Source | What | Status | Remaining |
|---|---|---|---|
| IMO open observations | Wind, gusts, temp at ~200 stations, matched to each tour's nearest station | Built | Verify the endpoint on the server; pin stations per tour in `config/stations.json` |
| Vegagerðin road weather stations | Wind, gusts, road temp at ~100 roadside stations | Built | Same |

## 3. Roads

| Source | What | Status | Remaining |
|---|---|---|---|
| Vegagerðin road conditions (`faerd2017_1`) | Passable / slippery / closed per road section | Built | List the road sections each tour depends on (`roads` in `config/tours.json`) |
| Vegagerðin DATEX II | Closures and roadworks with times and coordinates | Built (optional URL) | Ask Vegagerðin for the DATEX endpoint |
| SafeTravel.is alerts | Highland/F-road closures, general alerts | **Not built** | No documented open API found; ask SafeTravel (Landsbjörg) |

## 4. Map

| Layer | Source | Status |
|---|---|---|
| Basemap | **Mapbox** raster tiles (Outdoors, Satellite-streets, Streets, Light, Dark) via Leaflet | Built. Needs `MAPBOX_TOKEN` (**public** `pk.` token restricted to your domain). Falls back to OpenStreetMap with a warning if the token is missing |
| National wind field | ~88-point grid over Iceland from Open-Meteo, one request, cached 30 min | Built. Arrows coloured by gust for the hour on the time slider |
| Tours | Pins coloured by cancel risk; click opens the departure | Built |
| Cameras | Pins for cameras with lat/lon in `config/cameras.json` | Built |
| Official Icelandic basemap (LMÍ / Náttúrufræðistofnun) | WMTS in EPSG:3057 | Not used: needs reprojection and licence confirmation |

Mapbox pricing: raster tiles are billed per 1,000 tile requests after a free monthly allowance. A dashboard used by
a handful of duty managers stays inside the free tier; check the current price list before selling it to many users.

## 5. Cameras

| Source | Status | Remaining |
|---|---|---|
| Vegagerðin road cameras | **Link-outs** (open in a new tab) | Ask Vegagerðin in writing for permission to embed snapshots; then set `snapshotUrl` and the position |
| IMO / other public webcams | Link-outs | Same: permission per owner |
| **Your own cameras** (RTSP/IP cameras at bases, glacier edge) | Built: SSRF-safe snapshot relay, positions on the map | Install cameras; publish snapshots with an open-source tool (go2rtc, MediaMTX, Frigate) as [CAMERAS.md](CAMERAS.md) describes |
| Automatic visibility from images | Not built | Roadmap: estimate visibility/fog from your own camera snapshots |

## 6. Other conditions (not built yet, in priority order)

| Condition | Likely source | Why it matters |
|---|---|---|
| Official weather warnings (CAP) | IMO | Legal and insurance weight; should override the model |
| Avalanche danger | IMO avalanche forecasts (regional danger levels) | Glacier, ice cave and snowmobile tours |
| Earthquakes and volcanic activity | IMO earthquake lists and aviation colour codes | Katla/Mýrdalsjökull tours and the Reykjanes peninsula |
| River discharge and glacial floods (jökulhlaup) | IMO hydrology stations | River crossings (super-jeep, rafting) |
| Sea ice and sea-surface temperature | IMO / Copernicus Marine | Whale watching, snorkelling in Silfra (water temperature is stable) |
| Daylight and twilight | Calculated locally | Winter hikes and aurora tours; no external source needed |
| Aurora cloud cover | Already from the weather models + NOAA Kp | Built |

Each one is a connector file in `server/connectors/` plus a risk factor. Terms of use must be confirmed with each
provider before the data is used in a paid product.

## 7. Licences to settle before selling

| Provider | Commercial use |
|---|---|
| Open-Meteo | **Paid plan required** |
| MET Norway | Free with attribution (CC BY 4.0) and an identifying User-Agent |
| IMO, Vegagerðin | Open data; confirm terms in writing for a resold product |
| NOAA SWPC | Public domain |
| Mapbox | Paid above the free tier; attribution and the "Improve this map" link must stay visible |
| OpenStreetMap tile servers | **Not** for commercial products: use Mapbox or another paid tile provider |
| Bókun | Partner terms at bokun.io/api-terms |
