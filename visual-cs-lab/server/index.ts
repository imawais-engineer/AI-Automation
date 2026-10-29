import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';

import { db, newId, nowIso, readBrand, readBranding } from './db.ts';
import { brandingFrom } from './branding.ts';
import { ensureThumbnail, saveManualThumbnail, thumbnailStatus } from './render/thumbnails.ts';
import { parseOps, trace, validate } from './algorithms/stack.ts';
import { traceBinarySearch } from './algorithms/binary-search.ts';
import {
  buildScenes,
  lessonIssues,
  runConcept,
  safeJson,
  storyboardHash,
  type ConceptInput,
  type LessonInput,
  type Scene
} from './scenes.ts';
import { lessonPipeline } from './pipeline.ts';
import { inspectPlan } from './anim/inspect.ts';
import { motionForLesson } from './motion.ts';
import { formatVoiceover } from './voiceover.ts';
import { generateVoiceoverFor, saveVoiceoverEdits, voiceoverState } from './voiceover-store.ts';
import { parseValidation } from './render/quality.ts';
import { assertFontsLoaded, fontStatus } from './render/typography.ts';
import {
  cancelJob,
  createJob,
  lessonBundle,
  PRESETS,
  resumeOnBoot,
  retryJob,
  sceneClip,
  scenesFor,
  thumbnail,
  type Preset,
  type RenderJob
} from './render/jobs.ts';

import { attachUser, requireAction } from './auth.ts';
import { adminApi } from './admin-api.ts';
import { publicApi } from './public-api.ts';

const PORT = Number(process.env.PORT || 3000);
const app = express();
app.use(express.json({ limit: '3mb' }));
// Every request knows who is asking; each protected route then decides.
app.use(attachUser);
// Public learning platform: published content only, learner writes gated.
app.use('/api', publicApi);
// Admin Studio: role-gated per route.
app.use('/api/admin', adminApi);

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
  const fonts = fontStatus();
  res.json({ ok: true, service: 'visual-cs-lab', fonts: fonts.ok, time: nowIso() });
});

app.get('/api/overview', requireAction('content:read'), (_req, res) => {
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
    // Ready to publish means: approved by a human AND a render that passed every
    // automated quality check. A finished job alone is not enough.
    readyToPublish: new Set(
      (
        db
          .prepare(
            `SELECT r.lesson_id, r.validation FROM render_jobs r
             JOIN lessons l ON l.id = r.lesson_id
             WHERE l.review_status = 'approved' AND r.state = 'done'`
          )
          .all() as { lesson_id: string; validation: string | null }[]
      )
        .filter((row) => parseValidation(row.validation)?.ok)
        .map((row) => row.lesson_id)
    ).size,
    qualityCheckedRenders: (
      db.prepare("SELECT validation FROM render_jobs WHERE state = 'done'").all() as { validation: string | null }[]
    ).filter((row) => parseValidation(row.validation)?.ok).length,
    published: one("SELECT COUNT(*) AS n FROM publish_jobs WHERE status = 'published'"),
    recentLessons,
    recentJobs,
    environment: {
      renderer: 'in-process worker: Skia frames → ffmpeg H.264, validated on the encoded file',
      presets: Object.entries(PRESETS).map(([key, value]) => ({
        key,
        label: value.label,
        width: value.width,
        height: value.height,
        fps: value.fps
      })),
      persistent: Boolean(process.env.DATA_DIR)
    }
  });
});

/* ------------------------------------------------------------------ concepts */

app.get('/api/concepts', requireAction('content:read'), (req, res) => {
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

app.post('/api/concepts', requireAction('content:write'), (req, res) => {
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

app.get('/api/concepts/:id', requireAction('content:read'), (req, res) => {
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
      kind: run.kind,
      validation: run.validation,
      eventCount: run.eventCount
    },
    trace: { steps: run.steps, foundIndex: run.foundIndex, summary: run.summary, errors: run.errors }
  });
});

app.patch('/api/concepts/:id', requireAction('content:write'), (req, res) => {
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

app.post('/api/concepts/:id/duplicate', requireAction('content:write'), (req, res) => {
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

app.post('/api/concepts/:id/archive', requireAction('content:write'), (req, res) => {
  const archived = req.body?.archived === false ? 0 : 1;
  const result = db
    .prepare('UPDATE concepts SET archived = ?, updated_at = ? WHERE id = ?')
    .run(archived, nowIso(), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Concept not found.' });
  res.json({ ok: true, archived: Boolean(archived) });
});

app.post('/api/concepts/:id/trace', requireAction('content:write'), (req, res) => {
  const concept = requireConcept(req.params.id);
  if (!concept) return res.status(404).json({ error: 'Concept not found.' });

  // Stack visualizer: an explicit op list from the client overrides the config.
  if (req.body?.ops) {
    const ops = parseOps(req.body.ops);
    const { events, errors } = trace(ops);
    const config = safeJson<{ expect?: Record<string, unknown> }>(concept.animation_config, {});
    const expectation = (config.expect || {}) as Parameters<typeof validate>[1];
    res.json({ kind: 'stack', events, errors, validation: validate(events, expectation), expectation });
    return;
  }

  const run = runConcept(concept);
  const expectation = safeJson<{ expect?: Record<string, unknown> }>(concept.animation_config, {}).expect || {};
  res.json({
    kind: run.kind,
    events: run.events,
    steps: run.steps,
    foundIndex: run.foundIndex,
    summary: run.summary,
    input: run.input,
    target: run.target,
    comparisons: run.comparisons,
    complexity: run.complexity,
    errors: run.errors,
    validation: run.validation,
    expectation
  });
});

/* ------------------------------------------------------------------- lessons */

app.get('/api/lessons', requireAction('content:read'), (req, res) => {
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

app.post('/api/lessons', requireAction('content:write'), (req, res) => {
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

app.get('/api/lessons/:id', requireAction('content:read'), (req, res) => {
  const lesson = requireLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const concept = requireConcept(lesson.concept_id);
  if (!concept) return res.status(404).json({ error: 'Concept not found.' });
  const issues = lessonIssues(lesson, concept, readBranding());
  const scenes = scenesFor(req.params.id) || [];
  const renders = db
    .prepare('SELECT * FROM render_jobs WHERE lesson_id = ? ORDER BY created_at DESC')
    .all(req.params.id) as RenderJob[];
  const voiceover = voiceoverState(req.params.id);
  res.json({
    lesson: { ...lesson, scenes: safeJson<Scene[]>(lesson.scenes, []) },
    concept,
    issues,
    scenes,
    storyboardHash: storyboardHash(scenes),
    renders,
    publishes: db
      .prepare('SELECT * FROM publish_jobs WHERE lesson_id = ? ORDER BY created_at DESC')
      .all(req.params.id),
    voiceover,
    thumbnail: thumbnailStatus(req.params.id),
    pipeline: lessonPipeline({ lesson, concept, scenes, issues, renders, voiceover })
  });
});

app.patch('/api/lessons/:id', requireAction('content:write'), (req, res) => {
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

app.post('/api/lessons/:id/storyboard', requireAction('content:write'), (req, res) => {
  const bundle = lessonBundle(req.params.id);
  if (!bundle) return res.status(404).json({ error: 'Lesson not found.' });
  const branding = readBranding();
  const scenes = buildScenes(bundle.lesson, bundle.concept, branding);
  db.prepare('UPDATE lessons SET scenes = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(scenes),
    nowIso(),
    req.params.id
  );
  // Validate the row we just wrote, not the stale copy loaded before the update.
  const issues = lessonIssues({ ...bundle.lesson, scenes: JSON.stringify(scenes) }, bundle.concept, branding);
  res.json({
    scenes,
    durationMs: scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
    issues,
    renderable: issues.length === 0
  });
});

app.get('/api/lessons/:id/scenes', requireAction('content:read'), (req, res) => {
  const scenes = scenesFor(req.params.id);
  if (!scenes) return res.status(404).json({ error: 'Lesson not found.' });
  res.json({ scenes });
});

/** Edits scene timings and captions; the renderer reads the stored storyboard. */
app.patch('/api/lessons/:id/scenes', requireAction('content:write'), (req, res) => {
  const lesson = requireLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const concept = requireConcept(lesson.concept_id);
  if (!concept) return res.status(404).json({ error: 'Concept not found.' });

  const current = safeJson<Scene[]>(lesson.scenes, []);
  if (current.length === 0) {
    return res.status(400).json({ error: 'Generate the storyboard before editing scene timings.' });
  }
  // A reorder-only save sends `order` and no scene patches.
  const incoming = Array.isArray(req.body?.scenes)
    ? req.body.scenes
    : req.body?.order !== undefined
      ? []
      : null;
  if (!Array.isArray(incoming)) return res.status(400).json({ error: 'Send the edited scenes as an array.' });

  const patches = new Map<string, Record<string, unknown>>();
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id === 'string' && item.id) patches.set(item.id, item);
  }

  let next = current.map((scene) => {
    const patch = patches.get(scene.id);
    if (!patch) return scene;
    const duration = Number(patch.durationMs);
    return {
      ...scene,
      durationMs: Number.isFinite(duration)
        ? Math.max(300, Math.min(30000, Math.round(duration)))
        : scene.durationMs,
      caption: typeof patch.caption === 'string' ? patch.caption.slice(0, 400) : scene.caption,
      subtitle: typeof patch.subtitle === 'string' ? patch.subtitle.slice(0, 400) : scene.subtitle
    };
  });
  const unknownIds = Array.from(patches.keys()).filter((id) => !current.some((scene) => scene.id === id)).length;

  // Reordering: the client sends the full id order, which must be a permutation.
  if (req.body?.order !== undefined) {
    const order: string[] | null = Array.isArray(req.body.order)
      ? (req.body.order as unknown[]).map((value) => String(value))
      : null;
    const known = new Set(next.map((scene) => scene.id));
    if (
      !order ||
      order.length !== next.length ||
      new Set(order).size !== order.length ||
      order.some((id) => !known.has(id))
    ) {
      return res.status(400).json({ error: 'The new scene order must list every scene exactly once.' });
    }
    next = order.map((id) => next.find((scene) => scene.id === id) as Scene);
  }

  db.prepare('UPDATE lessons SET scenes = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(next),
    nowIso(),
    lesson.id
  );
  const updated = { ...lesson, scenes: JSON.stringify(next) };
  res.json({ scenes: next, issues: lessonIssues(updated, concept, readBranding()), unknownIds });
});

/** Duplicates one scene directly after itself, so a beat can be repeated. */
app.post('/api/lessons/:id/scenes/:sceneId/duplicate', requireAction('content:write'), (req, res) => {
  const lesson = requireLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const concept = requireConcept(lesson.concept_id);
  if (!concept) return res.status(404).json({ error: 'Concept not found.' });

  const current = safeJson<Scene[]>(lesson.scenes, []);
  const index = current.findIndex((scene) => scene.id === req.params.sceneId);
  if (index < 0) return res.status(404).json({ error: 'Scene not found in this storyboard.' });

  const source = current[index];
  const copy: Scene = {
    ...source,
    id: `${source.id}-copy-${Date.now().toString(36).slice(-4)}`
  };
  const next = [...current.slice(0, index + 1), copy, ...current.slice(index + 1)];
  db.prepare('UPDATE lessons SET scenes = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(next),
    nowIso(),
    lesson.id
  );
  const updated = { ...lesson, scenes: JSON.stringify(next) };
  res.status(201).json({ scenes: next, issues: lessonIssues(updated, concept, readBranding()) });
});

/* ---------------------------------------------------------------- voice-over */

/** The stored script plus its freshness and accuracy checks. */
app.get('/api/lessons/:id/voiceover', requireAction('content:read'), (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const status = voiceoverState(req.params.id);
  res.json({
    voiceover: status,
    markdown: status.script ? formatVoiceover(status.script) : ''
  });
});

/** Generates or regenerates the script — no video render is needed for this. */
app.post('/api/lessons/:id/voiceover', requireAction('content:write'), (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const result = generateVoiceoverFor(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  const script = result.status?.script ?? null;
  res.status(201).json({
    voiceover: result.status,
    markdown: script ? formatVoiceover(script) : ''
  });
});

/** Saves wording edits to the narration of each scene. */
app.patch('/api/lessons/:id/voiceover', requireAction('content:write'), (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const raw = Array.isArray(req.body?.segments) ? (req.body.segments as unknown[]) : null;
  if (!raw) return res.status(400).json({ error: 'Send the edited segments as an array.' });
  const edits = raw
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.id === 'string')
    .map((item) => ({ id: String(item.id), text: String(item.text ?? '').slice(0, 600) }));
  const result = saveVoiceoverEdits(req.params.id, edits);
  if (result.error) return res.status(400).json({ error: result.error });
  const script = result.status?.script ?? null;
  res.json({
    voiceover: result.status,
    markdown: script ? formatVoiceover(script) : ''
  });
});

/** Layout, pointer and algorithm-state inspection of the stored storyboard. */
app.get('/api/lessons/:id/inspect', requireAction('content:read'), (req, res) => {
  const built = motionForLesson(req.params.id);
  if (!built) return res.status(400).json({ error: 'Build the storyboard first — there is no plan to inspect.' });
  const audit = inspectPlan(built.motion);
  res.json({ audit });
});

app.get('/api/lessons/:id/scene/:index.png', requireAction('content:read'), (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) return res.status(400).end();
  const requested = Number(req.query.w);
  const width = Number.isFinite(requested) ? Math.max(360, Math.min(1080, Math.round(requested))) : 540;
  const png = thumbnail(req.params.id, index, width);
  if (!png) return res.status(404).json({ error: 'Scene not found.' });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.end(png);
});

/** Real motion preview of a single scene, encoded at preview resolution and cached. */
app.get('/api/lessons/:id/scene/:index/clip.mp4', requireAction('content:read'), async (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'Invalid scene index.' });
  const result = await sceneClip(req.params.id, index, 540);
  if (!result.file) return res.status(500).json({ error: result.error || 'Scene preview failed.' });
  res.type('video/mp4');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.sendFile(result.file);
});

/* --------------------------------------------------------------------- brand */

app.get('/api/brand', requireAction('content:read'), (_req, res) => {
  res.json({ brand: readBrand() });
});

app.patch('/api/brand', requireAction('content:write'), (req, res) => {
  const fields = [
    'name', 'accent', 'background', 'panel', 'ink', 'font_family', 'watermark',
    'caption_style', 'code_style', 'default_duration', 'default_resolution', 'intro', 'outro',
    'presenter', 'role', 'closing_line', 'opening_ms', 'ending_ms', 'opening_style', 'auto_thumbnail'
  ];
  const patch = pick(req.body as Record<string, unknown>, fields);
  const entries = Object.entries(patch);
  if (entries.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  db.prepare(`UPDATE brand SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = 1`).run(
    ...entries.map(([, value]) => value as never),
    nowIso()
  );
  res.json({ brand: readBrand(), branding: readBranding() });
});

/**
 * Applies the current branding to videos that already exist: each storyboard is
 * rebuilt on the current opening/ending durations (so every beat, caption and
 * narration timestamp is recalculated) and its thumbnail is recut from the new
 * opening frame. Manual scene timing edits are replaced by this rebuild.
 */
app.post('/api/brand/regenerate', requireAction('render:run'), (req, res) => {
  const branding = readBranding();
  const lessonId = String(req.body?.lessonId || '');
  const rows = db
    .prepare("SELECT * FROM lessons WHERE (? = '' OR id = ?) ORDER BY created_at")
    .all(lessonId, lessonId) as (LessonInput & { scenes: string })[];

  let rebuilt = 0;
  let thumbnails = 0;
  const failures: { lessonId: string; error: string }[] = [];

  for (const lesson of rows) {
    const concept = requireConcept(lesson.concept_id);
    if (!concept) {
      failures.push({ lessonId: lesson.id, error: 'The concept this lesson belongs to no longer exists.' });
      continue;
    }
    try {
      const scenes = buildScenes(lesson, concept, branding);
      db.prepare('UPDATE lessons SET scenes = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(scenes),
        nowIso(),
        lesson.id
      );
      rebuilt++;
    } catch (error) {
      failures.push({ lessonId: lesson.id, error: (error as Error).message });
      continue;
    }
    const thumb = ensureThumbnail(lesson.id, { force: true });
    if (thumb.file) thumbnails++;
  }

  res.json({ rebuilt, thumbnails, failures, branding });
});

/* --------------------------------------------------------------- thumbnails */

/** The poster image for a video, generated from its own opening frame on demand. */
app.get('/api/lessons/:id/thumbnail.png', requireAction('content:read'), (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const result = ensureThumbnail(req.params.id);
  if (!result.file) return res.status(404).json({ error: result.error || 'No thumbnail available.' });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Thumbnail-Source', result.row?.source || 'auto');
  res.sendFile(result.file);
});

/** Replaces the thumbnail without touching the video. */
app.post('/api/lessons/:id/thumbnail', requireAction('content:write'), async (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const result = await saveManualThumbnail(req.params.id, String(req.body?.image || ''));
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ thumbnail: thumbnailStatus(req.params.id) });
});

/** Recuts the automatic thumbnail from the current opening frame. */
app.post('/api/lessons/:id/thumbnail/auto', requireAction('content:write'), (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const result = ensureThumbnail(req.params.id, { force: true });
  if (!result.file) return res.status(400).json({ error: result.error || 'No thumbnail available.' });
  res.json({ thumbnail: thumbnailStatus(req.params.id), capturedAtMs: result.row?.captured_at_ms ?? 0 });
});

/* --------------------------------------------------------------------- create */

function conceptBySlug(slug: string): ConceptInput | null {
  return (db.prepare('SELECT * FROM concepts WHERE slug = ?').get(slug) as ConceptInput) || null;
}

const ALGORITHMS = [
  {
    slug: 'stacks',
    kind: 'stack',
    name: 'Stack',
    blurb: 'PUSH, PEEK and POP on one vertical tower — last in, first out.',
    defaultInput: {
      ops: [
        { op: 'push', value: 10 },
        { op: 'push', value: 20 },
        { op: 'push', value: 30 },
        { op: 'top' },
        { op: 'pop' },
        { op: 'pop' },
        { op: 'push', value: 40 }
      ]
    }
  },
  {
    slug: 'binary-search',
    kind: 'binary-search',
    name: 'Binary Search',
    blurb: 'LOW, HIGH and MID move across a sorted array until the target is found.',
    defaultInput: { array: [1, 3, 5, 7, 9], target: 7 }
  }
];

/** What the Create screen offers: verified algorithms and their default inputs. */
app.get('/api/algorithms', requireAction('content:read'), (_req, res) => {
  const brand = readBrand();
  const algorithms = ALGORITHMS.map((algorithm) => {
    const concept = conceptBySlug(algorithm.slug);
    return {
      ...algorithm,
      available: Boolean(concept),
      complexity: concept ? `${concept.complexity_time} time · ${concept.complexity_space} space` : '',
      summary: concept?.summary || algorithm.blurb
    };
  });
  res.json({
    algorithms,
    defaultSeconds: Number(brand.default_duration) || 45,
    profiles: Object.entries(PRESETS).map(([key, value]) => ({
      key,
      label: value.label,
      width: value.width,
      height: value.height
    }))
  });
});

/**
 * One call for the Create screen: verify the input with the trusted
 * implementation, store the animation input on a new lesson, build its beat
 * windows and report anything that would block a render.
 */
app.post('/api/create', requireAction('content:write'), (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const algorithm = String(body.algorithm || 'stacks');
  const spec = ALGORITHMS.find((item) => item.slug === algorithm || item.kind === algorithm);
  if (!spec) return res.status(400).json({ error: 'Choose an algorithm to animate.' });
  const concept = conceptBySlug(spec.slug);
  if (!concept) return res.status(404).json({ error: 'That algorithm has no concept record yet.' });

  const seconds = Math.max(10, Math.min(60, Number(body.duration) || Number(readBrand().default_duration) || 45));
  let animationInput: Record<string, unknown>;
  let summary = '';

  if (spec.kind === 'stack') {
    const raw = Array.isArray(body.ops) ? (body.ops as Record<string, unknown>[]) : [];
    const ops = raw.slice(0, 10).map((item) => {
      const op = String(item.op || '').toLowerCase();
      if (op === 'push') return { op: 'push' as const, value: Number(item.value) };
      if (op === 'pop') return { op: 'pop' as const };
      return { op: 'top' as const };
    });
    if (ops.length === 0) return res.status(400).json({ error: 'Add at least one PUSH, PEEK or POP.' });

    const run = trace(ops);
    if (run.errors.length > 0) return res.status(400).json({ error: run.errors.join(' ') });
    const last = run.events[run.events.length - 1];
    if (!last) return res.status(400).json({ error: 'That input produced no verified stack state.' });
    const firstPop = run.events.find((event) => event.op === 'pop' && event.returned !== null);
    const expect: Record<string, unknown> = { finalStack: last.items, top: last.top };
    if (firstPop) expect.popReturns = firstPop.returned;
    animationInput = { ops, expect };
    summary = `${run.events.length} verified operations · final stack [${last.items.join(', ')}] · TOP ${String(last.top)}`;
  } else {
    const array = (Array.isArray(body.array) ? (body.array as unknown[]) : spec.defaultInput.array ?? [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    const target = Number(body.target ?? spec.defaultInput.target);
    if (array.length < 2) return res.status(400).json({ error: 'Add at least two numbers to the array.' });
    if (array.length > 8) {
      return res.status(400).json({ error: 'Up to eight values fit the vertical frame — trim the array.' });
    }
    if (!Number.isFinite(target)) return res.status(400).json({ error: 'Add a numeric target value.' });
    for (let i = 1; i < array.length; i++) {
      if (array[i - 1] > array[i]) {
        return res.status(400).json({ error: 'Binary search needs a sorted array — sort the values ascending.' });
      }
    }

    const traceRun = traceBinarySearch(array, target);
    if (traceRun.errors.length > 0) return res.status(400).json({ error: traceRun.errors.join(' ') });
    animationInput = {
      kind: 'binary-search',
      array,
      target,
      expect: {
        foundIndex: traceRun.foundIndex >= 0 ? traceRun.foundIndex : null,
        steps: traceRun.steps.length
      }
    };
    summary =
      traceRun.foundIndex >= 0
        ? `Target ${target} found at index ${traceRun.foundIndex} after ${traceRun.steps.length} comparison${traceRun.steps.length === 1 ? '' : 's'}`
        : `Target ${target} is not in the array — ${traceRun.steps.length} comparison${traceRun.steps.length === 1 ? '' : 's'} exhausted the range`;
  }

  const id = newId();
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO lessons (id, concept_id, title, audience, objective, duration_seconds, hook,
       narration, on_screen_text, key_takeaway, cta, sources, review_status, scenes, animation_input,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'draft', '[]', ?, ?, ?)`
  ).run(
    id,
    concept.id,
    String(body.title || `${concept.name} · ${seconds}s`),
    '',
    concept.objectives,
    seconds,
    String(body.hook || concept.summary),
    concept.plain_explanation,
    concept.example_input,
    concept.expected_output || concept.summary,
    "Understand the algorithm. Don't just memorize it.",
    JSON.stringify(animationInput),
    stamp,
    stamp
  );

  const lesson = requireLesson(id)!;
  const scenes = buildScenes(lesson, concept, readBranding());
  db.prepare('UPDATE lessons SET scenes = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(scenes),
    nowIso(),
    id
  );

  const stored = requireLesson(id)!;
  const issues = lessonIssues(stored, concept, readBranding());
  res.status(201).json({
    lesson: { ...stored, scenes: safeJson<Scene[]>(stored.scenes, []) },
    concept,
    durationSeconds: seconds,
    summary,
    issues,
    renderable: issues.length === 0
  });
});

/* ------------------------------------------------------------------- renders */

app.post('/api/renders', requireAction('render:run'), (req, res) => {
  const lessonId = String(req.body?.lessonId || '');
  const preset = String(req.body?.preset || 'hd') as Preset;
  const result = createJob(lessonId, preset);
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ job: result.job });
});

app.get('/api/renders', requireAction('content:read'), (req, res) => {
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

app.get('/api/renders/:id', requireAction('content:read'), (req, res) => {
  const job = db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(req.params.id) as RenderJob | undefined;
  if (!job) return res.status(404).json({ error: 'Render job not found.' });
  res.json({ job, validation: parseValidation(job.validation) });
});

app.post('/api/renders/:id/retry', requireAction('render:run'), (req, res) => {
  const result = retryJob(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ job: result.job });
});

app.post('/api/renders/:id/cancel', requireAction('render:run'), (req, res) => {
  const result = cancelJob(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ job: result.job });
});

/** Inline playback for the preview player; the download route stays a download. */
app.get('/api/renders/:id/stream', requireAction('content:read'), (req, res) => {
  const job = db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(req.params.id) as RenderJob | undefined;
  if (!job || job.state !== 'done' || !job.output_path) {
    return res.status(404).json({ error: 'This render has no finished MP4 yet.' });
  }
  res.type('video/mp4');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(job.output_path);
});

app.get('/api/renders/:id/video', requireAction('content:read'), (req, res) => {
  const job = db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(req.params.id) as RenderJob | undefined;
  if (!job || job.state !== 'done' || !job.output_path) {
    return res.status(404).json({ error: 'This render has no finished MP4 yet.' });
  }
  // The file is named after the person it is presented by, not the internal app.
  const lesson = db.prepare('SELECT title FROM lessons WHERE id = ?').get(job.lesson_id) as
    | { title: string }
    | undefined;
  const name = `${slugify(readBranding().presenter)}-${slugify(lesson?.title || 'short')}-${job.preset}.mp4`;
  res.download(job.output_path, name);
});

/* ---------------------------------------------------------------- publishing */

app.get('/api/publishes', requireAction('content:read'), (_req, res) => {
  const publishes = db
    .prepare(
      `SELECT publish_jobs.*, lessons.title AS lesson_title
       FROM publish_jobs JOIN lessons ON lessons.id = publish_jobs.lesson_id
       ORDER BY publish_jobs.updated_at DESC`
    )
    .all();
  res.json({ publishes });
});

app.post('/api/publishes', requireAction('content:publish'), (req, res) => {
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

app.patch('/api/publishes/:id', requireAction('content:publish'), (req, res) => {
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

app.delete('/api/publishes/:id', requireAction('content:publish'), (req, res) => {
  const result = db.prepare('DELETE FROM publish_jobs WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Publishing entry not found.' });
  res.json({ ok: true });
});

/* -------------------------------------------------------------------- client */

async function start() {
  // Rendering with a substitute typeface would break every fitted text box, so a
  // missing bundled font stops the server instead of degrading silently.
  assertFontsLoaded();
  // Published lessons get their derived deck/material once, so all three learner
  // modes exist for content that predates the learning model.
  const derived = ensureDerivedContent();
  if (derived.decks || derived.assets) {
    console.log(`derived content: ${derived.decks} deck(s), ${derived.assets} video asset(s)`);
  }
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
