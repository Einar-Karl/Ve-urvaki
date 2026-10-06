# Veðurvaki

Weather-risk operations dashboard prototype for tour operators (demo client: *Arctic Adventures*).
It forecasts the chance that each departure in the next 72 hours will be cancelled or changed,
ranks a decision queue by deadline and risk, and suggests recovery actions (rebooking, alternative
tours, guest messaging) with the revenue impact.

> **Prototype.** All weather, booking and price figures are synthetic demo data generated in
> `src/data.js` and `src/model.js`. The UI is in Icelandic.

## Run

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
npm start        # python3 -m http.server 8080 → http://localhost:8080
```

## Structure

```
index.html        page markup
src/styles.css    design tokens (light/dark) and component styles
src/data.js       regions, tour types, tours, departures, map geometry
src/model.js      formatting helpers, synthetic forecast (wx), risk model (risk), wind field (idw)
src/views.js      renderers: map, decision queue, risk matrix, KPIs, departure detail, season chart
src/main.js       state, render loop, event wiring
```

Scripts are plain classic `<script>` files loaded in the order above so the project also works
from `file://`.
