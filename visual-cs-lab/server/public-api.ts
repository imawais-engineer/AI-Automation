/**
 * The public learning API.
 *
 * Everything here reads published content only. Drafts, unapproved revisions,
 * render jobs and internal production records are never reachable from these
 * routes, whatever URL a visitor types.
 *
 * Routes that change a learner's own data (progress, bookmarks, preferences)
 * require a signed-in user; reads are anonymous.
 */

import { Router } from 'express';
import { existsSync } from 'node:fs';

import { db, nowIso } from './db.ts';
import { attachUser, createUser, endSession, needsBootstrapAdmin, publicUser, requireUser, signIn, startSession, type AuthedRequest } from './auth.ts';
import { safeJson } from './scenes.ts';
import { THEMES, themeById } from './themes.ts';
import {
  assetsOf,
  codeOf,
  derivedState,
  preferredAsset,
  quizOf,
  roadmapPositionFor,
  sectionsOf
} from './content.ts';
import { ensureThumbnail } from './render/thumbnails.ts';

export const publicApi = Router();
publicApi.use(attachUser);

type LessonRow = Record<string, unknown>;

function publishedLessons(): LessonRow[] {
  return db
    .prepare(
      `SELECT lessons.*, concepts.name AS concept_name, concepts.slug AS concept_slug, concepts.category AS concept_category,
              concepts.complexity_time, concepts.complexity_space, concepts.summary AS concept_summary
       FROM lessons
       JOIN concepts ON concepts.id = lessons.concept_id
       WHERE lessons.content_status = 'published' AND concepts.archived = 0
       ORDER BY lessons.published_at DESC, lessons.title`
    )
    .all() as LessonRow[];
}

function publishedLessonBySlug(slug: string): LessonRow | undefined {
  return db
    .prepare(
      `SELECT lessons.*, concepts.name AS concept_name, concepts.slug AS concept_slug, concepts.category AS concept_category
       FROM lessons JOIN concepts ON concepts.id = lessons.concept_id
       WHERE lessons.slug = ? AND lessons.content_status = 'published' AND concepts.archived = 0`
    )
    .get(slug) as LessonRow | undefined;
}

function card(lesson: LessonRow) {
  const topics = safeJson<string[]>(String(lesson.topics || '[]'), []);
  return {
    id: lesson.id,
    slug: lesson.slug,
    title: lesson.title,
    summary: lesson.summary,
    difficulty: lesson.difficulty,
    topics,
    minutes: Number(lesson.estimated_minutes || 0),
    concept: lesson.concept_name,
    conceptSlug: lesson.concept_slug,
    category: lesson.concept_category,
    complexity: lesson.complexity_time || '',
    theme: themeById(String(lesson.theme_id || '')).id,
    hasVideo: assetsOf(String(lesson.id)).some((asset) => asset.status === 'ready' && asset.validation_ok)
  };
}

function progressFor(userId: string | undefined, lessonId: string) {
  if (!userId) return null;
  const row = db
    .prepare('SELECT state, last_mode, last_section, updated_at FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
    .get(userId, lessonId) as Record<string, unknown> | undefined;
  return row || null;
}

/* ---------------------------------------------------------------------- auth */

publicApi.get('/auth/me', (req, res) => {
  const user = (req as AuthedRequest).user;
  res.json({ user: user || null, needsAdmin: needsBootstrapAdmin(), themes: THEMES.map(themeCard) });
});

publicApi.post('/auth/bootstrap', (req, res) => {
  if (!needsBootstrapAdmin()) {
    return res.status(409).json({ error: 'An administrator already exists. Ask them to invite you.' });
  }
  const result = createUser({ ...(req.body || {}), role: 'admin' });
  if (!result.user) return res.status(400).json({ error: result.error });
  startSession(req, res, result.user.id);
  res.status(201).json({ user: result.user });
});

publicApi.post('/auth/register', (req, res) => {
  const result = createUser({ ...(req.body || {}), role: 'learner' });
  if (!result.user) return res.status(400).json({ error: result.error });
  startSession(req, res, result.user.id);
  res.status(201).json({ user: result.user });
});

publicApi.post('/auth/login', (req, res) => {
  const result = signIn(req.body?.email, req.body?.password);
  if (!result.user) return res.status(401).json({ error: result.error });
  startSession(req, res, result.user.id);
  res.json({ user: result.user });
});

publicApi.post('/auth/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

publicApi.patch('/auth/me', requireUser, (req, res) => {
  const user = (req as AuthedRequest).user!;
  const fields: Record<string, unknown> = {};
  if (typeof req.body?.name === 'string') fields.name = req.body.name.trim().slice(0, 80);
  if (typeof req.body?.default_language === 'string') fields.default_language = req.body.default_language.slice(0, 24);
  if (typeof req.body?.audio_mode === 'string') fields.audio_mode = req.body.audio_mode.slice(0, 16);
  if (req.body?.captions !== undefined) fields.captions = req.body.captions ? 1 : 0;
  if (req.body?.reduced_motion !== undefined) fields.reduced_motion = req.body.reduced_motion ? 1 : 0;
  const entries = Object.entries(fields);
  if (entries.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  db.prepare(
    `UPDATE users SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...entries.map(([, value]) => value as never), nowIso(), user.id);
  res.json({ user: publicUser(user.id) });
});

/* ---------------------------------------------------------------------- home */

function themeCard(theme: (typeof THEMES)[number]) {
  return {
    id: theme.id,
    name: theme.name,
    tagline: theme.tagline,
    background: theme.background,
    panel: theme.panel,
    ink: theme.ink,
    accent: theme.accent
  };
}

publicApi.get('/learn/home', (req, res) => {
  const user = (req as AuthedRequest).user;
  const lessons = publishedLessons();
  const roadmaps = db
    .prepare('SELECT * FROM roadmaps WHERE published = 1 ORDER BY position, created_at')
    .all() as Record<string, unknown>[];
  const featured = roadmaps[0] || null;
  const topics = Array.from(new Set(lessons.map((lesson) => String(lesson.concept_category || 'General'))));

  const continueLearning = user
    ? (db
        .prepare(
          `SELECT lessons.slug, lessons.title, lesson_progress.state, lesson_progress.updated_at, lesson_progress.last_mode
           FROM lesson_progress
           JOIN lessons ON lessons.id = lesson_progress.lesson_id
           WHERE lesson_progress.user_id = ? AND lessons.content_status = 'published'
           ORDER BY lesson_progress.updated_at DESC LIMIT 4`
        )
        .all(user.id) as Record<string, unknown>[])
    : [];

  res.json({
    user: user || null,
    topics,
    featured: featured
      ? {
          slug: featured.slug,
          title: featured.title,
          description: featured.description,
          lessonCount: countRoadmapLessons(String(featured.id))
        }
      : null,
    recent: lessons.slice(0, 6).map(card),
    recommended: lessons.slice(0, 3).map(card),
    continueLearning,
    stats: {
      lessons: lessons.length,
      roadmaps: roadmaps.length,
      withVideo: lessons.filter((lesson) => assetsOf(String(lesson.id)).some((asset) => asset.status === 'ready')).length
    }
  });
});

/* ------------------------------------------------------------------- explore */

publicApi.get('/learn/concepts', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const topic = String(req.query.topic || '').trim();
  const difficulty = String(req.query.difficulty || '').trim();
  const lessons = publishedLessons();
  const filtered = lessons.filter((lesson) => {
    const haystack = `${lesson.title} ${lesson.summary} ${lesson.concept_name} ${lesson.concept_category}`.toLowerCase();
    if (q && !haystack.includes(q)) return false;
    if (topic && String(lesson.concept_category) !== topic) return false;
    if (difficulty && String(lesson.difficulty) !== difficulty) return false;
    return true;
  });
  res.json({
    lessons: filtered.map(card),
    topics: Array.from(new Set(lessons.map((lesson) => String(lesson.concept_category || 'General')))),
    difficulties: ['beginner', 'intermediate', 'advanced'],
    total: filtered.length
  });
});

publicApi.get('/learn/concepts/:slug', (req, res) => {
  const lesson = db
    .prepare(
      `SELECT lessons.slug FROM lessons JOIN concepts ON concepts.id = lessons.concept_id
       WHERE concepts.slug = ? AND lessons.content_status = 'published' LIMIT 1`
    )
    .get(req.params.slug) as { slug: string } | undefined;
  if (!lesson) return res.status(404).json({ error: 'Concept not found.' });
  res.json({ lessonSlug: lesson.slug });
});

/* ----------------------------------------------------------------- roadmaps */

function countRoadmapLessons(roadmapId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM roadmap_items
       JOIN roadmap_modules ON roadmap_modules.id = roadmap_items.module_id
       WHERE roadmap_modules.roadmap_id = ?`
    )
    .get(roadmapId) as { n: number };
  return row.n;
}

publicApi.get('/learn/roadmaps', (_req, res) => {
  const roadmaps = db
    .prepare('SELECT * FROM roadmaps WHERE published = 1 ORDER BY position, created_at')
    .all() as Record<string, unknown>[];
  res.json({
    roadmaps: roadmaps.map((roadmap) => ({
      id: roadmap.id,
      slug: roadmap.slug,
      title: roadmap.title,
      description: roadmap.description,
      prerequisites: roadmap.prerequisites,
      outcomes: roadmap.outcomes,
      lessonCount: countRoadmapLessons(String(roadmap.id))
    }))
  });
});

function roadmapPayload(slug: string, userId?: string) {
  const roadmap = db.prepare('SELECT * FROM roadmaps WHERE slug = ? AND published = 1').get(slug) as
    | Record<string, unknown>
    | undefined;
  if (!roadmap) return null;
  const modules = db
    .prepare('SELECT * FROM roadmap_modules WHERE roadmap_id = ? ORDER BY position')
    .all(String(roadmap.id)) as Record<string, unknown>[];
  const done = new Set(
    userId
      ? (
          db
            .prepare("SELECT lesson_id FROM lesson_progress WHERE user_id = ? AND state = 'completed'")
            .all(userId) as { lesson_id: string }[]
        ).map((row) => row.lesson_id)
      : []
  );
  const started = new Set(
    userId
      ? (db.prepare('SELECT lesson_id FROM lesson_progress WHERE user_id = ?').all(userId) as { lesson_id: string }[]).map(
          (row) => row.lesson_id
        )
      : []
  );

  let previousComplete = true;
  const shaped = modules.map((module) => {
    const items = db
      .prepare(
        `SELECT lessons.id, lessons.slug, lessons.title, lessons.summary, lessons.difficulty, lessons.estimated_minutes
         FROM roadmap_items JOIN lessons ON lessons.id = roadmap_items.lesson_id
         WHERE roadmap_items.module_id = ? AND lessons.content_status = 'published'
         ORDER BY roadmap_items.position`
      )
      .all(String(module.id)) as Record<string, unknown>[];
    const lessons = items.map((item) => {
      const complete = done.has(String(item.id));
      // Prerequisites are positional: the next lesson unlocks once this one is done.
      const locked = !previousComplete && !complete;
      const state = complete ? 'completed' : locked ? 'locked' : started.has(String(item.id)) ? 'in-progress' : 'available';
      previousComplete = complete;
      return {
        id: item.id,
        slug: item.slug,
        title: item.title,
        summary: item.summary,
        difficulty: item.difficulty,
        minutes: Number(item.estimated_minutes || 0),
        state
      };
    });
    return { id: module.id, title: module.title, summary: module.summary, lessons };
  });

  const flat = shaped.flatMap((module) => module.lessons);
  return {
    roadmap: {
      slug: roadmap.slug,
      title: roadmap.title,
      description: roadmap.description,
      prerequisites: roadmap.prerequisites,
      outcomes: roadmap.outcomes
    },
    modules: shaped,
    total: flat.length,
    completed: flat.filter((lesson) => lesson.state === 'completed').length,
    next: flat.find((lesson) => lesson.state !== 'completed') || null
  };
}

publicApi.get('/learn/roadmaps/:slug', (req, res) => {
  const payload = roadmapPayload(req.params.slug, (req as AuthedRequest).user?.id);
  if (!payload) return res.status(404).json({ error: 'Roadmap not found.' });
  res.json(payload);
});

/* ------------------------------------------------------------------- lesson */

publicApi.get('/learn/lessons/:slug', (req, res) => {
  const lesson = publishedLessonBySlug(req.params.slug);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const user = (req as AuthedRequest).user;
  const lessonId = String(lesson.id);
  const concept = db.prepare('SELECT * FROM concepts WHERE id = ?').get(String(lesson.concept_id)) as Record<
    string,
    unknown
  >;
  const audioMode = String(user?.audio_mode || 'silent');
  const asset = preferredAsset(lessonId, audioMode);
  // One selector per audio variant: re-renders of the same mode are still one variant.
  const variants: { id: string; audioMode: string }[] = [];
  for (const item of assetsOf(lessonId)) {
    if (item.status !== 'ready' || !item.validation_ok) continue;
    if (variants.some((variant) => variant.audioMode === item.audio_mode)) continue;
    variants.push({ id: item.id, audioMode: item.audio_mode });
  }
  const bookmarked = user
    ? Boolean(db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND lesson_id = ?').get(user.id, lessonId))
    : false;
  const derived = derivedState(lessonId);

  res.json({
    lesson: {
      ...card(lesson),
      objectives: safeJson<string[]>(String(lesson.learning_objectives || '[]'), []),
      prerequisites: lesson.prerequisites,
      hook: lesson.hook,
      takeaway: lesson.key_takeaway,
      version: Number(lesson.version || 1),
      publishedAt: lesson.published_at
    },
    concept: {
      name: concept.name,
      category: concept.category,
      plain: concept.plain_explanation,
      technical: concept.technical_explanation,
      pseudocode: concept.pseudocode,
      exampleInput: concept.example_input,
      expectedOutput: concept.expected_output,
      complexityTime: concept.complexity_time,
      complexitySpace: concept.complexity_space
    },
    sections: sectionsOf(lessonId).map((section) => ({
      id: section.id,
      heading: section.heading,
      body: section.body,
      kind: section.kind
    })),
    code: codeOf(lessonId).map((example) => ({
      id: example.id,
      language: example.language,
      label: example.label,
      code: example.code,
      expectedOutput: example.expected_output,
      notes: example.notes
    })),
    video: asset
      ? {
          id: asset.id,
          audioMode: asset.audio_mode,
          durationSeconds: asset.duration_seconds,
          width: asset.width,
          height: asset.height,
          theme: themeById(asset.theme_id).id,
          variants
        }
      : null,
    thumbnailUrl: asset ? `/api/learn/lessons/${lesson.slug}/thumbnail.png` : null,
    quiz: quizOf(lessonId).map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: safeJson<string[]>(question.options, []),
      answerIndex: question.answer_index,
      explanation: question.explanation
    })),
    roadmap: roadmapPositionFor(lessonId),
    // Slides are not part of the learner experience, so the deck is not exposed.
    derived: { videos: derived.videos, narration: derived.narration },
    progress: progressFor(user?.id, lessonId),
    bookmarked,
    guest: !user
  });
});

publicApi.get('/learn/lessons/:slug/thumbnail.png', (req, res) => {
  const lesson = publishedLessonBySlug(req.params.slug);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const result = ensureThumbnail(String(lesson.id));
  if (!result.file) return res.status(404).json({ error: result.error || 'No thumbnail available.' });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(result.file);
});

/** Inline playback of a published lesson's video asset. */
publicApi.get('/learn/videos/:assetId', (req, res) => {
  const asset = db.prepare('SELECT * FROM video_assets WHERE id = ?').get(req.params.assetId) as
    | { file_path: string; status: string; lesson_id: string }
    | undefined;
  if (!asset || asset.status !== 'ready' || !asset.file_path || !existsSync(asset.file_path)) {
    return res.status(404).json({ error: 'That video is not available.' });
  }
  const published = db
    .prepare("SELECT 1 FROM lessons WHERE id = ? AND content_status = 'published'")
    .get(asset.lesson_id);
  if (!published) return res.status(404).json({ error: 'That video is not available.' });
  res.type('video/mp4');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(asset.file_path);
});

/* ---------------------------------------------------------------- my learning */

publicApi.get('/learn/me', requireUser, (req, res) => {
  const user = (req as AuthedRequest).user!;
  const rows = db
    .prepare(
      `SELECT lessons.slug, lessons.title, lessons.summary, lessons.estimated_minutes, lessons.difficulty,
              lesson_progress.state, lesson_progress.last_mode, lesson_progress.updated_at
       FROM lesson_progress JOIN lessons ON lessons.id = lesson_progress.lesson_id
       WHERE lesson_progress.user_id = ? AND lessons.content_status = 'published'
       ORDER BY lesson_progress.updated_at DESC`
    )
    .all(user.id) as Record<string, unknown>[];
  const saved = db
    .prepare(
      `SELECT lessons.slug, lessons.title, lessons.summary, bookmarks.created_at
       FROM bookmarks JOIN lessons ON lessons.id = bookmarks.lesson_id
       WHERE bookmarks.user_id = ? AND lessons.content_status = 'published'
       ORDER BY bookmarks.created_at DESC`
    )
    .all(user.id) as Record<string, unknown>[];

  const roadmaps = (
    db.prepare('SELECT slug FROM roadmaps WHERE published = 1 ORDER BY position').all() as { slug: string }[]
  ).map((row) => {
    const payload = roadmapPayload(row.slug, user.id);
    return payload
      ? {
          slug: payload.roadmap.slug,
          title: payload.roadmap.title,
          total: payload.total,
          completed: payload.completed,
          next: payload.next
        }
      : null;
  }).filter(Boolean);

  res.json({
    user,
    inProgress: rows.filter((row) => row.state !== 'completed'),
    completed: rows.filter((row) => row.state === 'completed'),
    saved,
    roadmaps,
    recent: rows.slice(0, 5)
  });
});

publicApi.post('/learn/progress', requireUser, (req, res) => {
  const user = (req as AuthedRequest).user!;
  const lessonId = String(req.body?.lessonId || '');
  const lesson = db.prepare("SELECT id FROM lessons WHERE id = ? AND content_status = 'published'").get(lessonId);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const state = req.body?.state === 'completed' ? 'completed' : 'started';
  // The lesson is one tutorial; older records keep their historical mode label.
  const mode = ['tutorial', 'video', 'read'].includes(String(req.body?.mode)) ? String(req.body.mode) : 'tutorial';
  const section = String(req.body?.section || '').slice(0, 120);
  db.prepare(
    `INSERT INTO lesson_progress (user_id, lesson_id, state, last_mode, last_section, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, lesson_id) DO UPDATE SET
       state = excluded.state, last_mode = excluded.last_mode, last_section = excluded.last_section, updated_at = excluded.updated_at`
  ).run(user.id, lessonId, state, mode, section, nowIso());
  res.json({ progress: progressFor(user.id, lessonId) });
});

publicApi.post('/learn/bookmarks', requireUser, (req, res) => {
  const user = (req as AuthedRequest).user!;
  const lessonId = String(req.body?.lessonId || '');
  const lesson = db.prepare("SELECT id FROM lessons WHERE id = ? AND content_status = 'published'").get(lessonId);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const existing = db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND lesson_id = ?').get(user.id, lessonId);
  if (existing) {
    db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND lesson_id = ?').run(user.id, lessonId);
    return res.json({ bookmarked: false });
  }
  db.prepare('INSERT INTO bookmarks (user_id, lesson_id, created_at) VALUES (?, ?, ?)').run(user.id, lessonId, nowIso());
  res.json({ bookmarked: true });
});
