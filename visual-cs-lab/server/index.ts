// First import on purpose: it reads a local .env before any module below asks
// process.env for a port, data directory or media directory.
import './env.ts';

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';

import { assertFontsLoaded } from './render/typography.ts';
import { resumeOnBoot } from './render/jobs.ts';
import { ensureDerivedContent } from './content-bootstrap.ts';

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

const PORT = Number(process.env.PORT || 3000);
const app = express();
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
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Visual CS Lab listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Failed to start Visual CS Lab', error);
  process.exit(1);
});
