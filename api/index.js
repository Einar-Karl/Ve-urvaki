// Vercel entry point: every request (pages, API, guest links) is routed here by vercel.json.
// The environment must be prepared BEFORE the server modules load, because some read paths at import time.
import { prepareRuntime } from '../server/lib/vercel-runtime.js';

prepareRuntime();
const { handler } = await import('../server/index.js');

export default handler;
