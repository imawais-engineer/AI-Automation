import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';

import { db, newId, nowIso, readBrand } from './db.ts';
import { parseOps, trace, validate } from './algorithms/stack.ts';
import {
  buildScenes,
  lessonIssues,
  runConcept,
  safeJson,
  type ConceptInput,
  type LessonInput,
  type Scene
} from './scenes.ts';
import { createJob, lessonBundle, PRESETS, resumeOnBoot, retryJob, scenesFor, thumbnail, type Preset, type RenderJob } from './render/jobs.ts';

const PORT = Number(process.env.PORT || 3000);
const app = express();
app.use(express.json({ limit: '3mb' }));

const CONCEPT_FIELDS = [
  'name', 'category', 'summary', 'objectives', 'prerequisites', 'plain_explanation',
  'technical_explanation', 'pseudocode', 'reference_language', 'reference_code',
  'complexity_time', 'complexity_space', 'example_input', 'expected_output',
  'status'
] as const;

const LESSON_FIELDS = [
  'title', 'audience', 'objective', 'duration_seconds', 'hook', 'narration',
  'on_screen_text', 'key_takeaway', 'cta', 'sources', 'review_status'
] as const;

const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube'] as const;

function pick<T extends object>(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in source) out[field] = source[field];
  }
  return out;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || `concept-${Date.now()}`;
}

function requireLesson(id: string): (LessonInput & { scenes: string }) | null {
  return (db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as LessonInput & { scenes: string }) || null;
}

function requireConcept(id: string): ConceptInput | null {
  return (db.prepare('SELECT * FROM concepts WHERE id = ?').get(id) as ConceptInput) || null;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'visual-cs-lab', time: nowIso() });
});

app.get('/api/overview', (_req, res) => {
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const recentLessons = db
    .prepare(
      `SELECT lessons.id, lessons.title, lessons.review_status, lessons.updated_at, concepts.name AS concept
       FROM lessons JOIN concepts ON concepts.id = lessons.concept_id
       ORDER BY lessons.updated_at DESC LIMIT 5`
    )
    .all();
  const recentJobs = db
    .prepare(
      `SELECT render_jobs.id, render_jobs.state, render_jobs.preset, render_jobs.progress,
              render_jobs.created_at, lessons.title
       FROM render_jobs JOIN lessons ON lessons.id = render_jobs.lesson_id
       ORDER BY render_jobs.created_at DESC LIMIT 5`
    )
    .all();

  res.json({
    concepts: one('SELECT COUNT(*) AS n FROM concepts WHERE archived = 0'),
    lessons: one('SELECT COUNT(*) AS n FROM lessons'),
    lessonsInProgress: one("SELECT COUNT(*) AS n FROM lessons WHERE review_status IN ('draft','in_review')"),
    rendersDone: one("SELECT COUNT(*) AS n FROM render_jobs WHERE state = 'done'"),
    rendersFailed: one("SELECT COUNT(*) AS n FROM render_jobs WHERE state = 'error'"),
    rendersActive: one("SELECT COUNT(*) AS n FROM render_jobs WHERE state IN ('queued','rendering','encoding','validating')"),
    awaitingReview: one("SELECT COUNT(*) AS n FROM lessons WHERE review_status = 'in_review'"),
    readyToPublish: one(
      `SELECT COUNT(*) AS n FROM lessons
       WHERE review_status = 'approved'
         AND EXISTS (SELECT 1 FROM render_jobs r WHERE r.lesson_id = lessons.id AND r.state = 'done')
         AND NOT EXISTS (SELECT 1 FROM publish_jobs p WHERE p.lesson_id = lessons.id AND p.status = 'published')`
    ),
    published: one("SELECT COUNT(*) AS n FROM publish_jobs WHERE status = 'published'"),
    recentLessons,
    recentJobs,
    environment: {
      renderer: 'canvas + ffmpeg (local worker in this service)',
      presets: Object.entries(PRESETS).map(([key, value]) => ({ key, label: value.label })),
      persistent: Boolean(process.env.DATA_DIR)
    }
  });
});

/* ------------------------------------------------------------------ concepts */

app.get('/api/concepts', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim();
  const archived = req.query.archived === '1';
  const rows = db
    .prepare(
      `SELECT * FROM concepts WHERE archived = ?
       AND (? = '' OR lower(name) LIKE ? OR lower(summary) LIKE ? OR lower(pseudocode) LIKE ?)
       AND (? = '' OR category = ?)
       ORDER BY category, name`
    )
    .all(archived ? 1 : 0, q, `%${q}%`, `%${q}%`, `%${q}%`, category, category);
  res.json({ concepts: rows });
});

app.post('/api/concepts', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'A concept needs a name.' });
  const id = newId();
  const stamp = nowIso();
  let slug = slugify(name);
  if (db.prepare('SELECT 1 FROM concepts WHERE slug = ?').get(slug)) slug = `${slug}-${id.slice(0, 4)}`;
  db.prepare(
    `INSERT INTO concepts (id, slug, name, category, summary, objectives, prerequisites,
       plain_explanation, technical_explanation, pseudocode, reference_language, reference_code,
       complexity_time, complexity_space, example_input, expected_output, animation_config,
       related, status, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', '', '', '', '', '', '', '', '', '', '', '{}', '[]', 'draft', 0, ?, ?)`
  ).run(
    id,
    slug,
    name,
    String(body.category || 'Data Structures'),
    String(body.summary || ''),
    stamp,
    stamp
  );
  res.status(201).json({ concept: db.prepare('SELECT * FROM concepts WHERE id = ?').get(id) });
});

app.get('/api/concepts/:id', (req, res) => {
  const concept = requireConcept(req.params.id);
  if (!concept) return res.status(404).json({ error: 'Concept not found.' });
  const lessons = db
    .prepare('SELECT id, title, review_status, duration_seconds, updated_at FROM lessons WHERE concept_id = ? ORDER BY updated_at DESC')
    .all(req.params.id);
  const run = runConcept(concept);
  const related = (db.prepare('SELECT related FROM concepts WHERE id = ?').get(req.params.id) as { related: string })
    .related;
  res.json({
    concept,
    relatedSlugs: safeJson<string[]>(related, []),
    lessons,
    animation: {
      supported: run.supported,
      validation: run.validation,
      eventCount: run.events.length
    }
  });
});

app.patch('/api/concepts/:id', (req, res) => {
  const concept = requireConcept(req.params.id);
  if (!concept) return res.status(404).json({ error: 'Concept not found.' });
  const patch = pick(req.body as Record<string, unknown>, CONCEPT_FIELDS);
  const entries = Object.entries(patch);
  if (entries.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  db.prepare(
    `UPDATE concepts SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...entries.map(([, value]) => value as never), nowIso(), req.params.id);
  res.json({ concept: db.prepare('SELECT * FROM concepts WHERE id = ?').get(req.params.id) });
});

app.post('/api/concepts/:id/duplicate', (req, res) => {
  const concept = requireConcept(req.params.id);
  if (!concept) return res.status(404).json({ error: 'Concept not found.' });
  const source = db.prepare('SELECT * FROM concepts WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  const id = newId();
  const stamp = nowIso();
  const copy: Record<string, unknown> = {
    ...source,
    id,
    slug: `${String(source.slug)}-copy-${id.slice(0, 4)}`,
    name: `${String(source.name)} (copy)`,
    status: 'draft',
    archived: 0,
    created_at: stamp,
    updated_at: stamp
  };
  const columns = Object.keys(copy);
  db.prepare(
    `INSERT INTO concepts (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).run(...columns.map((column) => copy[column] as never));
  res.status(201).json({ concept: db.prepare('SELECT * FROM concepts WHERE id = ?').get(id) });
});

app.post('/api/concepts/:id/archive', (req, res) => {
  const archived = req.body?.archived === false ? 0 : 1;
  const result = db
    .prepare('UPDATE concepts SET archived = ?, updated_at = ? WHERE id = ?')
    .run(archived, nowIso(), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Concept not found.' });
  res.json({ ok: true, archived: Boolean(archived) });
});

app.post('/api/concepts/:id/trace', (req, res) => {
  const concept = requireConcept(req.params.id);
  if (!concept) return res.status(404).json({ error: 'Concept not found.' });
  const config = safeJson<{ ops?: unknown; expect?: Record<string, unknown> }>(concept.animation_config, {});
  const ops = req.body?.ops ? parseOps(req.body.ops) : parseOps(config.ops || []);
  const { events, errors } = trace(ops);
  const expectation = (config.expect || {}) as Parameters<typeof validate>[1];
  const validation = validate(events, expectation);
  res.json({ events, errors, validation, expectation });
});

/* ------------------------------------------------------------------- lessons */

app.get('/api/lessons', (req, res) => {
  const conceptId = String(req.query.conceptId || '');
  const rows = db
    .prepare(
      `SELECT lessons.*, concepts.name AS concept_name, concepts.slug AS concept_slug
       FROM lessons JOIN concepts ON concepts.id = lessons.concept_id
       WHERE (? = '' OR lessons.concept_id = ?)
       ORDER BY lessons.updated_at DESC`
    )
    .all(conceptId, conceptId);
  res.json({ lessons: rows });
});

app.post('/api/lessons', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const conceptId = String(body.conceptId || '');
  const concept = requireConcept(conceptId);
  if (!concept) return res.status(400).json({ error: 'Choose a concept for the lesson.' });
  const id = newId();
  const stamp = nowIso();
  const brand = readBrand();
  db.prepare(
    `INSERT INTO lessons (id, concept_id, title, audience, objective, duration_seconds, hook,
       narration, on_screen_text, key_takeaway, cta, sources, review_status, scenes, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?, '', '', '', '', '', '', 'draft', '[]', ?, ?)`
  ).run(
    id,
    conceptId,
    String(body.title || `${concept.name} in ${brand.default_duration} seconds`),
    concept.objectives,
    Number(brand.default_duration) || 20,
    stamp,
    stamp
  );
  res.status(201).json({ lesson: requireLesson(id) });
});

app.get('/api/lessons/:id', (req, res) => {
  const lesson = requireLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const concept = requireConcept(lesson.concept_id);
  if (!concept) return res.status(404).json({ error: 'Concept not found.' });
  const issues = lessonIssues(lesson, concept);
  res.json({
    lesson: { ...lesson, scenes: safeJson<Scene[]>(lesson.scenes, []) },
    concept,
    issues,
    scenes: scenesFor(req.params.id) || [],
    renders: db
      .prepare('SELECT * FROM render_jobs WHERE lesson_id = ? ORDER BY created_at DESC')
      .all(req.params.id),
    publishes: db
      .prepare('SELECT * FROM publish_jobs WHERE lesson_id = ? ORDER BY created_at DESC')
      .all(req.params.id)
  });
});

app.patch('/api/lessons/:id', (req, res) => {
  const lesson = requireLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const patch = pick(req.body as Record<string, unknown>, LESSON_FIELDS);
  if ('duration_seconds' in patch) {
    const seconds = Number(patch.duration_seconds);
    patch.duration_seconds = Math.max(10, Math.min(60, Number.isFinite(seconds) ? seconds : 20));
  }
  const entries = Object.entries(patch);
  if (entries.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  db.prepare(
    `UPDATE lessons SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...entries.map(([, value]) => value as never), nowIso(), req.params.id);
  res.json({ lesson: requireLesson(req.params.id) });
});

app.post('/api/lessons/:id/storyboard', (req, res) => {
  const bundle = lessonBundle(req.params.id);
  if (!bundle) return res.status(404).json({ error: 'Lesson not found.' });
  const scenes = buildScenes(bundle.lesson, bundle.concept);
  db.prepare('UPDATE lessons SET scenes = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(scenes),
    nowIso(),
    req.params.id
  );
  const issues = lessonIssues(bundle.lesson, bundle.concept);
  res.json({
    scenes,
    durationMs: scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
    issues,
    renderable: issues.length === 0
  });
});

app.get('/api/lessons/:id/scenes', (req, res) => {
  const scenes = scenesFor(req.params.id);
  if (!scenes) return res.status(404).json({ error: 'Lesson not found.' });
  res.json({ scenes });
});

app.get('/api/lessons/:id/scene/:index.png', (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) return res.status(400).end();
  const png = thumbnail(req.params.id, index, 540);
  if (!png) return res.status(404).json({ error: 'Scene not found.' });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.end(png);
});

/* --------------------------------------------------------------------- brand */

app.get('/api/brand', (_req, res) => {
  res.json({ brand: readBrand() });
});

app.patch('/api/brand', (req, res) => {
  const fields = [
    'name', 'accent', 'background', 'panel', 'ink', 'font_family', 'watermark',
    'caption_style', 'code_style', 'default_duration', 'default_resolution', 'intro', 'outro'
  ];
  const patch = pick(req.body as Record<string, unknown>, fields);
  const entries = Object.entries(patch);
  if (entries.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  db.prepare(`UPDATE brand SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = 1`).run(
    ...entries.map(([, value]) => value as never),
    nowIso()
  );
  res.json({ brand: readBrand() });
});

/* ------------------------------------------------------------------- renders */

app.post('/api/renders', (req, res) => {
  const lessonId = String(req.body?.lessonId || '');
  const preset = String(req.body?.preset || 'hd') as Preset;
  const result = createJob(lessonId, preset);
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ job: result.job });
});

app.get('/api/renders', (req, res) => {
  const lessonId = String(req.query.lessonId || '');
  const jobs = db
    .prepare(
      `SELECT render_jobs.*, lessons.title AS lesson_title
       FROM render_jobs JOIN lessons ON lessons.id = render_jobs.lesson_id
       WHERE (? = '' OR render_jobs.lesson_id = ?)
       ORDER BY render_jobs.created_at DESC LIMIT 40`
    )
    .all(lessonId, lessonId);
  res.json({ renders: jobs });
});

app.get('/api/renders/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(req.params.id) as RenderJob | undefined;
  if (!job) return res.status(404).json({ error: 'Render job not found.' });
  res.json({ job });
});

app.post('/api/renders/:id/retry', (req, res) => {
  const result = retryJob(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ job: result.job });
});

app.get('/api/renders/:id/video', (req, res) => {
  const job = db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(req.params.id) as RenderJob | undefined;
  if (!job || job.state !== 'done' || !job.output_path) {
    return res.status(404).json({ error: 'This render has no finished MP4 yet.' });
  }
  res.download(job.output_path, `visual-cs-lab-${job.preset}.mp4`);
});

/* ---------------------------------------------------------------- publishing */

app.get('/api/publishes', (_req, res) => {
  const publishes = db
    .prepare(
      `SELECT publish_jobs.*, lessons.title AS lesson_title
       FROM publish_jobs JOIN lessons ON lessons.id = publish_jobs.lesson_id
       ORDER BY publish_jobs.updated_at DESC`
    )
    .all();
  res.json({ publishes });
});

app.post('/api/publishes', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const lessonId = String(body.lessonId || '');
  const platform = String(body.platform || '');
  if (!requireLesson(lessonId)) return res.status(404).json({ error: 'Lesson not found.' });
  if (!PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
    return res.status(400).json({ error: 'Choose instagram, facebook, tiktok or youtube.' });
  }
  const existing = db
    .prepare('SELECT id FROM publish_jobs WHERE lesson_id = ? AND platform = ?')
    .get(lessonId, platform) as { id: string } | undefined;
  if (existing) {
    return res.status(409).json({ error: `A ${platform} publishing entry already exists for this lesson.` });
  }
  const id = newId();
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO publish_jobs (id, lesson_id, platform, title, caption, hashtags, cta, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'drafted', ?, ?)`
  ).run(
    id,
    lessonId,
    platform,
    String(body.title || ''),
    String(body.caption || ''),
    String(body.hashtags || ''),
    String(body.cta || ''),
    stamp,
    stamp
  );
  res.status(201).json({ publish: db.prepare('SELECT * FROM publish_jobs WHERE id = ?').get(id) });
});

app.patch('/api/publishes/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM publish_jobs WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Publishing entry not found.' });
  const status = req.body?.status === undefined ? undefined : String(req.body.status);
  const allowed = ['drafted', 'ready', 'scheduled', 'published', 'failed'];
  if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Unknown publishing status.' });
  if (status === 'published' && !String(req.body?.published_url || existing.published_url || '').trim()) {
    return res.status(400).json({ error: 'Add the published URL before marking a video as published.' });
  }
  const fields: Record<string, unknown> = {};
  for (const key of ['title', 'caption', 'hashtags', 'cta', 'scheduled_at', 'published_url', 'external_id', 'error']) {
    if (key in (req.body || {})) fields[key] = req.body[key];
  }
  if (status) fields.status = status;
  const entries = Object.entries(fields);
  if (entries.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  db.prepare(
    `UPDATE publish_jobs SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...entries.map(([, value]) => value as never), nowIso(), req.params.id);
  res.json({ publish: db.prepare('SELECT * FROM publish_jobs WHERE id = ?').get(req.params.id) });
});

app.delete('/api/publishes/:id', (req, res) => {
  const result = db.prepare('DELETE FROM publish_jobs WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Publishing entry not found.' });
  res.json({ ok: true });
});

/* -------------------------------------------------------------------- client */

async function start() {
  const server = createServer(app);
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

  resumeOnBoot();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Visual CS Lab listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Failed to start Visual CS Lab', error);
  process.exit(1);
});
