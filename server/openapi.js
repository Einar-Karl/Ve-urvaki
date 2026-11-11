// OpenAPI 3.1 description of /api/v1, served at /api/v1/openapi.json and written to docs/openapi.json
// (npm run openapi). A test checks that every path listed here is answered by the server.
const P = (description, schema, extra = {}) => ({ description, content: { 'application/json': { schema } }, ...extra });
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const problem = { description: 'Error (RFC 9457 problem details)', content: { 'application/problem+json': { schema: ref('Problem') } } };
const errs = { 400: problem, 401: problem, 403: problem, 404: problem, 422: problem, 429: problem, 502: problem };
const sec = scope => [{ ApiKey: [scope] }, { BearerKey: [scope] }];
const idemHeader = { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', minLength: 8, maxLength: 128 }, description: 'Send the same key to safely retry a POST; the first response is replayed for 24 h.' };

export const spec = () => ({
  openapi: '3.1.0',
  info: {
    title: 'Veðurvaki API', version: '1.0.0',
    description: 'Weather, road and operational risk for outdoor activities in Iceland, plus the data feeds that keep it accurate. Decision support only: a person makes the final safety decision.',
    license: { name: 'Proprietary' },
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: {
      ApiKey: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'Create keys in Admin → Partners & API. Scopes: read, ingest, tours, webhooks.' },
      BearerKey: { type: 'http', scheme: 'bearer', description: 'Same key as "Authorization: Bearer vv_…".' },
    },
    schemas: {
      Problem: { type: 'object', required: ['title', 'status'], properties: { type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, detail: { type: 'string' }, requestId: { type: 'string' }, errors: { type: 'array', items: {} } } },
      Activity: { type: 'string', enum: ['snow', 'hike', 'cave', 'snork', 'aurora', 'whale', 'jeep', 'raft', 'atv'], description: 'snowmobile, glacier hike, ice cave, snorkelling, northern lights, whale watching, super jeep, rafting, ATV' },
      Limits: { type: 'object', description: '[risk starts, usually cancelled] per factor. g gust m/s, p rain mm/h, c cloud %, s waves m, t °C', additionalProperties: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } },
      RiskRequestPoint: { type: 'object', required: ['activity', 'lat', 'lon', 'start'], properties: { activity: ref('Activity'), lat: { type: 'number' }, lon: { type: 'number' }, start: { type: 'string', format: 'date-time' }, durationHours: { type: 'number', default: 3, maximum: 12 }, limits: ref('Limits'), marine: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } }, description: 'offshore point for wave data (boat activities)' } } },
      RiskRequestTour: { type: 'object', required: ['tourId', 'departure'], properties: { tourId: { oneOf: [{ type: 'integer' }, { type: 'string' }] }, departure: { type: 'string', format: 'date-time' } } },
      Risk: { type: 'object', properties: { status: { type: 'string', enum: ['go', 'change', 'cancel'] }, probabilities: { type: 'object', properties: { go: { type: 'number' }, change: { type: 'number' }, cancel: { type: 'number' } } }, uncertainty: { type: 'number' },
        drivers: { type: 'array', items: { type: 'object', properties: { factor: { type: 'string' }, maxDuringTrip: { type: 'number' }, unit: { type: 'string' }, riskStartsAt: { type: 'number' }, usuallyCancelledAt: { type: 'number' }, weight: { type: 'number' } } } },
        roadClosed: { type: ['array', 'null'], items: { type: 'string' } }, mode: { type: 'string', enum: ['live', 'demo'] }, thresholds: { type: 'string' }, disclaimer: { type: 'string' } } },
      Conditions: { type: 'object', properties: { location: { type: 'object' }, mode: { type: 'string' }, pointForecast: { type: 'boolean' }, sources: { type: 'array', items: { type: 'object' } },
        hourly: { type: 'array', items: { type: 'object', properties: { time: { type: 'string', format: 'date-time' }, windGust: { type: 'number' }, wind: { type: 'number' }, windDirection: { type: 'number' }, precipitation: { type: 'number' }, cloudCover: { type: 'number' }, temperature: { type: 'number' }, visibilityKm: { type: ['number', 'null'] }, waveHeight: { type: ['number', 'null'] }, sourceSpread: { type: 'number', description: 'max − min gust between forecast models (m/s)' } } } },
        observation: { type: ['object', 'null'], description: 'nearest station reading (IMO / Vegagerðin) within 40 km' }, cameras: { type: 'array', items: ref('Camera') }, attribution: { type: 'array', items: { type: 'string' }, description: 'credits you must display' } } },
      Departure: { type: 'object', properties: { tourId: {}, tourName: { type: 'string' }, departure: { type: 'string', format: 'date-time' }, status: { type: 'string' }, cancelProbability: { type: ['number', 'null'] }, roadClosed: {}, reason: { type: 'object' }, decideBy: { type: 'string', format: 'date-time' }, bookedPax: { type: ['integer', 'null'] }, guestsOnFile: { type: 'integer' } } },
      Tour: { type: 'object', required: ['id', 'name', 'type', 'lat', 'lon', 'departures', 'capacity'], properties: { id: { oneOf: [{ type: 'integer' }, { type: 'string' }] }, name: { type: 'string' }, type: ref('Activity'), lat: { type: 'number' }, lon: { type: 'number' }, region: { type: 'string' }, departures: { type: 'array', items: { type: 'string', pattern: '^\\d{1,2}:\\d\\d$' } }, durationHours: { type: 'number' }, capacity: { type: 'integer' }, priceISK: { type: 'number' }, bokunProductId: { type: ['string', 'null'] }, roads: { type: 'array', items: { type: 'string' } }, limits: ref('Limits'), marine: { type: 'object' } } },
      Guest: { type: 'object', required: ['ref', 'tourId', 'departure', 'pax'], properties: { ref: { type: 'string' }, tourId: {}, departure: { type: 'string', format: 'date-time' }, pax: { type: 'integer', minimum: 1 }, name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string', description: 'international format' }, lang: { type: 'string', enum: ['en', 'de', 'is'] }, paidISK: { type: 'number' } }, description: 'email or phone is required' },
      Booking: { type: 'object', required: ['tourId', 'departure', 'pax'], properties: { tourId: {}, departure: { type: 'string', format: 'date-time' }, pax: { type: 'integer' }, capacity: { type: 'integer' } } },
      Outcome: { type: 'object', required: ['tourId', 'departure', 'outcome'], properties: { tourId: {}, departure: { type: 'string', format: 'date-time' }, outcome: { type: 'string', enum: ['ran', 'cancelled', 'changed'] }, reason: { type: 'string' }, decidedBy: { type: 'string' } } },
      Camera: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string', enum: ['image', 'page'] }, source: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' }, url: { type: 'string', description: 'page cameras only' }, distanceKm: { type: 'number' } } },
      Webhook: { type: 'object', properties: { id: { type: 'string' }, url: { type: 'string' }, events: { type: 'array', items: { type: 'string', enum: ['*', 'departure.risk_changed', 'departure.road_blocked', 'guest.choice_made', 'case.resolved', 'decision.recorded'] } }, active: { type: 'boolean' }, secret: { type: 'string', description: 'returned once, on creation' } } },
      Accepted: { type: 'object', properties: { ok: { type: 'boolean' }, accepted: { type: 'integer' } } },
    },
  },
  paths: {
    '/conditions': { get: { summary: 'Hourly conditions for any point in Iceland', description: 'Fused forecast from several weather models at the exact point, nearest station observation and nearby cameras.', security: sec('read'),
      parameters: [{ name: 'lat', in: 'query', required: true, schema: { type: 'number' } }, { name: 'lon', in: 'query', required: true, schema: { type: 'number' } }, { name: 'hours', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 72, default: 48 } }],
      responses: { 200: P('Conditions', ref('Conditions')), ...errs } } },
    '/risk': { post: { summary: 'Risk that an activity is cancelled', description: 'Either an activity at any point and time (activity defaults or your own limits), or a configured tour and departure (uses learned thresholds and linked roads).', security: sec('read'),
      requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [ref('RiskRequestPoint'), ref('RiskRequestTour')] } } } }, responses: { 200: P('Risk', ref('Risk')), ...errs } } },
    '/departures': { get: { summary: 'Upcoming departures of configured tours, sorted by risk', security: sec('read'), parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 3, default: 3 } }],
      responses: { 200: P('Departures', { type: 'object', properties: { forecastMode: { type: 'string' }, departures: { type: 'array', items: ref('Departure') } } }), ...errs } } },
    '/tours': {
      get: { summary: 'List tours', security: sec('read'), responses: { 200: P('Tours', { type: 'object', properties: { tours: { type: 'array', items: ref('Tour') }, warnings: { type: 'array', items: { type: 'string' } } } }), ...errs } },
      put: { summary: 'Create or update tours (upsert by id)', security: sec('tours'), requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [ref('Tour'), { type: 'array', items: ref('Tour') }] } } } }, responses: { 200: P('Saved', { type: 'object' }), ...errs } },
    },
    '/guests': { post: { summary: 'Add or update guests (upsert by ref + departure)', security: sec('ingest'), parameters: [idemHeader], requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [ref('Guest'), { type: 'array', items: ref('Guest') }] } } } }, responses: { 202: P('Accepted', ref('Accepted')), ...errs } } },
    '/bookings': { post: { summary: 'Seats taken per departure (latest snapshot wins)', security: sec('ingest'), parameters: [idemHeader], requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [ref('Booking'), { type: 'array', items: ref('Booking') }] } } } }, responses: { 202: P('Accepted', ref('Accepted')), ...errs } } },
    '/outcomes': { post: { summary: 'What actually happened (trains the model)', security: sec('ingest'), parameters: [idemHeader], requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [ref('Outcome'), { type: 'array', items: ref('Outcome') }] } } } }, responses: { 202: P('Accepted', ref('Accepted')), ...errs } } },
    '/events': { post: { summary: 'Free-form events to keep (notes, overrides)', security: sec('ingest'), parameters: [idemHeader], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 202: P('Accepted', ref('Accepted')), ...errs } } },
    '/cameras': { get: { summary: 'Cameras (image cameras never expose their source URL)', security: sec('read'), responses: { 200: P('Cameras', { type: 'array', items: ref('Camera') }), ...errs } } },
    '/roads': { get: { summary: 'Road status from Vegagerðin linked to tours', security: sec('read'), responses: { 200: P('Roads', { type: 'object' }), ...errs } } },
    '/grid': { get: { summary: 'Coarse national wind grid (72 h) for maps', security: sec('read'), responses: { 200: P('Grid', { type: 'object' }), ...errs } } },
    '/model': { get: { summary: 'Learned cancellation thresholds per tour', security: sec('read'), responses: { 200: P('Model', { type: 'object' }), ...errs } } },
    '/webhooks': {
      get: { summary: 'List webhook subscriptions', security: sec('webhooks'), responses: { 200: P('Subscriptions', { type: 'array', items: ref('Webhook') }), ...errs } },
      post: { summary: 'Subscribe to events (https only). The response contains the signing secret once.', security: sec('webhooks'), requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, events: { type: 'array', items: { type: 'string' } }, description: { type: 'string' } } } } } }, responses: { 201: P('Created', ref('Webhook')), ...errs } },
    },
    '/webhooks/{id}': { delete: { summary: 'Delete a subscription', security: sec('webhooks'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: P('Deleted', { type: 'object' }), ...errs } } },
    '/webhooks/{id}/test': { post: { summary: 'Send a signed "ping" event now', security: sec('webhooks'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: P('Delivery', { type: 'object' }), ...errs } } },
    '/webhooks/{id}/deliveries': { get: { summary: 'Recent delivery attempts', security: sec('webhooks'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: P('Deliveries', { type: 'array', items: { type: 'object' } }), ...errs } } },
  },
  webhooks: Object.fromEntries(['departure.risk_changed', 'departure.road_blocked', 'guest.choice_made', 'case.resolved', 'decision.recorded'].map(e => [e, { post: {
    summary: `Event ${e}`, description: 'Verify X-Vedurvaki-Signature: t=<unix>,v1=hex(HMAC-SHA256(secret, "<t>.<raw body>")). Reject if |now − t| > 300 s. Answer 2xx within 10 s; retries follow after 1 min, 5 min, 30 min, 2 h and 6 h.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, type: { const: e }, createdAt: { type: 'string', format: 'date-time' }, data: { type: 'object' } } } } } }, responses: { 200: { description: 'Received' } } } }])),
});
