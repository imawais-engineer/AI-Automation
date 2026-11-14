/**
 * Content authoring: concepts and lessons, their storyboards and scene edits.
 *
 * The rendering engine reads what these routes store; nothing here paints a
 * frame, so content work stays independent of the animation and render layers.
 */
import { Router } from 'express';

import { db, newId, nowIso, readBrand, readBranding } from '../db.ts';
import { brandingFrom } from '../branding.ts';
import { parseOps, trace, validate } from '../algorithms/stack.ts';
import {
  buildScenes,
  lessonDurationMs,
  lessonIssues,
  runConcept,
  safeJson,
  storyboardHash,
  type ConceptInput,
  type LessonInput,
  type Scene
} from '../scenes.ts';
import { lessonPipeline } from '../pipeline.ts';
import { lessonBundle, scenesFor, type RenderJob } from '../render/jobs.ts';
import { thumbnailStatus } from '../render/thumbnails.ts';
import { voiceoverState } from '../voiceover-store.ts';
import { requireAction } from '../auth.ts';
import {
  CONCEPT_FIELDS,
  LESSON_FIELDS,
  pick,
  requireConcept,
  requireLesson,
  slugify
} from './shared.ts';

export const contentRouter = Router();

/* ------------------------------------------------------------------ concepts */

contentRouter.get('/concepts', requireAction('content:read'), (req, res) => {
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

contentRouter.post('/concepts', requireAction('content:write'), (req, res) => {
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

contentRouter.get('/concepts/:id', requireAction('content:read'), (req, res) => {
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

contentRouter.patch('/concepts/:id', requireAction('content:write'), (req, res) => {
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

contentRouter.post('/concepts/:id/duplicate', requireAction('content:write'), (req, res) => {
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

contentRouter.post('/concepts/:id/archive', requireAction('content:write'), (req, res) => {
  const archived = req.body?.archived === false ? 0 : 1;
  const result = db
    .prepare('UPDATE concepts SET archived = ?, updated_at = ? WHERE id = ?')
    .run(archived, nowIso(), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Concept not found.' });
  res.json({ ok: true, archived: Boolean(archived) });
});

contentRouter.post('/concepts/:id/trace', requireAction('content:write'), (req, res) => {
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

contentRouter.get('/lessons', requireAction('content:read'), (req, res) => {
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

contentRouter.post('/lessons', requireAction('content:write'), (req, res) => {
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
    String(body.title || concept.name),
    concept.objectives,
    0,
    stamp,
    stamp
  );
  const created = requireLesson(id)!;
  const seconds = Math.round(lessonDurationMs(created, concept, brandingFrom(brand)) / 1000);
  db.prepare('UPDATE lessons SET duration_seconds = ?, updated_at = ? WHERE id = ?').run(seconds, nowIso(), id);
  res.status(201).json({ lesson: requireLesson(id) });
});

contentRouter.get('/lessons/:id', requireAction('content:read'), (req, res) => {
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

contentRouter.patch('/lessons/:id', requireAction('content:write'), (req, res) => {
  const lesson = requireLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const patch = pick(req.body as Record<string, unknown>, LESSON_FIELDS);
  const entries = Object.entries(patch);
  if (entries.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  db.prepare(
    `UPDATE lessons SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...entries.map(([, value]) => value as never), nowIso(), req.params.id);
  res.json({ lesson: requireLesson(req.params.id) });
});

contentRouter.post('/lessons/:id/storyboard', requireAction('content:write'), (req, res) => {
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

contentRouter.get('/lessons/:id/scenes', requireAction('content:read'), (req, res) => {
  const scenes = scenesFor(req.params.id);
  if (!scenes) return res.status(404).json({ error: 'Lesson not found.' });
  res.json({ scenes });
});

/** Edits scene timings and captions; the renderer reads the stored storyboard. */
contentRouter.patch('/lessons/:id/scenes', requireAction('content:write'), (req, res) => {
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
contentRouter.post('/lessons/:id/scenes/:sceneId/duplicate', requireAction('content:write'), (req, res) => {
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

export type { ConceptInput, LessonInput };
