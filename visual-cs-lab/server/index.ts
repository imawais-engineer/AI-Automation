// First import on purpose: it reads a local .env before any module below asks
// process.env for a port, data directory or media directory.
import './env.ts';

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';

import { assertFontsLoaded } from './render/typography.ts';
import { resumeOnBoot, startWatchdog } from './render/jobs.ts';
import { ensureDerivedContent } from './content-bootstrap.ts';
import { createApiApp } from './app.ts';

const PORT = Number(process.env.PORT || 3000);
// Middleware order and every API router live in `app.ts`, so the route contract
// tests exercise exactly the application that is served here.
const app = createApiApp();

/* -------------------------------------------------------------------- client */

async function start() {
  // Rendering with a substitute typeface would break every fitted text box, so a
  // missing bundled font stops the server instead of degrading silently.
  assertFontsLoaded();
  // Content maintenance: media-style lesson titles become the concept name,
  // lessons without complexity prose get it, and finished renders become assets.
  const derived = ensureDerivedContent();
  if (derived.titles || derived.sections || derived.assets) {
    console.log(
      `content upkeep: ${derived.titles} title(s), ${derived.sections} section(s), ${derived.assets} video asset(s)`
    );
  }
  const server = createServer(app);

  // A deployed build serves the compiled client from `dist`; development keeps
  // the Vite dev server mounted in-process so edits hot-reload on one origin.
  if (process.env.NODE_ENV === 'production') {
    const dist = path.resolve(process.cwd(), 'dist');
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.use('*', (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      configFile: path.resolve(process.cwd(), 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { server } },
      appType: 'custom'
    });

    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      try {
        const template = await readFile(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (error) {
        next(error);
      }
    });
  }

  resumeOnBoot();
  // The queue is one sequential worker; the watchdog is what notices when that
  // one worker stops making progress and frees the queue behind it.
  startWatchdog();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Visual CS Lab listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Failed to start Visual CS Lab', error);
  process.exit(1);
});
