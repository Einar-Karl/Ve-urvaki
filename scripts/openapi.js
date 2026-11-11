// `npm run openapi` — writes docs/openapi.json from server/openapi.js (import it into Postman, Stoplight, or a code generator).
import { writeFileSync } from 'node:fs';
import { spec } from '../server/openapi.js';
writeFileSync(new URL('../docs/openapi.json', import.meta.url), JSON.stringify(spec(), null, 2) + '\n');
console.log('wrote docs/openapi.json');
