/**
 * app.ts — production entry point.
 *
 * `npm run build` compiles to dist/, and Railway (or any Node host) starts the
 * app with `node dist/app.js`. Locally, `npm run app` runs the same server via
 * tsx. server.ts loads .env itself (via env.ts) and then boots.
 */

import "./server.js";
