// Reads a local .env before any module below asks process.env for a port or a
// data directory; importing it twice is harmless (the loader only fills gaps).
import './env.ts';

import express, { type NextFunction, type Request, type Response } from 'express';

import { attachUser } from './auth.ts';
import { adminApi } from './admin-api.ts';
import { publicApi } from './public-api.ts';
import { systemRouter } from './routes/system.ts';
import { contentRouter } from './routes/content.ts';
import { previewRouter } from './routes/preview.ts';
import { narrationRouter } from './routes/narration.ts';
import { brandRouter } from './routes/brand.ts';
import { createRouter } from './routes/create.ts';
import { rendersRouter } from './routes/renders.ts';

/**
 * The API application on its own: middleware order, then every router in the
 * order it was mounted. `index.ts` adds the client bundle and the listener; the
 * route contract tests build this directly, so the published API can be checked
 * without starting a dev server.
 *
 * Mount order is part of the contract:
 *   1. express.json — a malformed body is rejected before any route runs.
 *   2. attachUser  — every route sees the same resolved session user.
 *   3. /api        — the public learning API (mounted first, so it also answers
 *                    anything the admin API does not claim).
 *   4. /api/admin  — the Studio API, role-gated per route.
 *   5. the domain routers, each owning its own paths under /api.
 *   6. the /api 404 and error handlers, so API failures are always JSON.
 */
export function createApiApp(): express.Express {
  const app = express();
  // Do not advertise the framework version on every response.
  app.disable('x-powered-by');
  app.use(express.json({ limit: '3mb' }));
  // Every request knows who is asking; each protected route then decides.
  app.use(attachUser);
  // Public learning platform: published content only, learner writes gated.
  app.use('/api', publicApi);
  // Admin Studio: role-gated per route.
  app.use('/api/admin', adminApi);
  // Studio domains, one router each: metadata, content, previews, narration,
  // branding and thumbnails, the Create flow, then renders and publishing.
  app.use('/api', systemRouter);
  app.use('/api', contentRouter);
  app.use('/api', previewRouter);
  app.use('/api', narrationRouter);
  app.use('/api', brandRouter);
  app.use('/api', createRouter);
  app.use('/api', rendersRouter);

  // An unknown API path answers JSON, never the client's HTML shell.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Unknown API route.' });
  });

  // A thrown handler answers with the same JSON error shape, without a stack
  // trace (development's HTML error page would leak the server's internals).
  // A client error the middleware itself raised (an oversized or malformed body)
  // keeps its own 4xx status and can say what was wrong.
  app.use('/api', (error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    const status = Number((error as { status?: number; statusCode?: number })?.status ?? (error as { statusCode?: number })?.statusCode);
    const message = error instanceof Error ? error.message : String(error);
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      res.status(status).json({ error: message || 'That request could not be read.' });
      return;
    }
    console.error(`api error: ${req.method} ${req.originalUrl} — ${message}`);
    res.status(500).json({ error: 'That request could not be completed.' });
  });

  return app;
}
