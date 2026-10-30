/**
 * The Admin Studio API.
 *
 * Mounted behind `requireAction(...)` per route, so the role check happens on the
 * server for every read and every write. Content editing, trace inspection,
 * rendering, review, publishing, themes, audio licensing, roadmaps and user roles
 * are separate permissions — an editor cannot approve content, and only an admin
 * can change roles.
 */

import { Router } from 'express';
import { existsSync } from 'node:fs';

import { db, newId, nowIso } from './db.ts';
import { attachUser, createUser, publicUser, requireAction, type AuthedRequest } from './auth.ts';
import { isRole, ROLES, type Role } from './roles.ts';
import { safeJson } from './scenes.ts';
import { THEMES, isThemeId, themeById } from './themes.ts';
import {
  assetsOf,
  bumpLessonVersion,
  codeOf,
  deckOf,
  derivedState,
  generateSlideDeck,
  lessonContentHash,
  publishChecks,
  publishLesson,
  quizOf,
  sectionsOf,
  slidesOf
} from './content.ts';
import { approvedTracks, createAudioVariant, type AudioTrackRow } from './render/variants.ts';
import { createJob, PRESETS, registerRenderAsset } from './render/jobs.ts';
import { voiceoverState } from './voiceover-store.ts';

export const adminApi = Router();
adminApi.use(attachUser);

function lessonRow(id: string): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

function conceptRow(id: string): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM concepts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

/* ------------------------------------------------------------------ overview */

adminApi.get('/overview', requireAction('content:read'), (_req, res) => {
  const count = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...(params as never[])) as { n: number }).n;

  const drafts = db
    .prepare(
      `SELECT lessons.id, lessons.title, lessons.slug, lessons.content_status, lessons.updated_at, lessons.version,
              concepts.name AS concept
       FROM lessons JOIN concepts ON concepts.id = lessons.concept_id
       WHERE lessons.content_status IN ('draft','in_review') ORDER BY lessons.updated_at DESC LIMIT 8`
    )
    .all() as Record<string, unknown>[];

  const failed = db
    .prepare(
      `SELECT render_jobs.id, render_jobs.lesson_id, render_jobs.error, render_jobs.created_at, lessons.title
       FROM render_jobs JOIN lessons ON lessons.id = render_jobs.lesson_id
       WHERE render_jobs.state = 'error' ORDER BY render_jobs.created_at DESC LIMIT 5`
    )
    .all() as Record<string, unknown>[];

  const active = db
    .prepare(
      `SELECT render_jobs.id, render_jobs.lesson_id, render_jobs.state, render_jobs.progress, lessons.title
       FROM render_jobs JOIN lessons ON lessons.id = render_jobs.lesson_id
       WHERE render_jobs.state IN ('queued','rendering','encoding','validating') ORDER BY render_jobs.created_at DESC LIMIT 5`
    )
    .all() as Record<string, unknown>[];

  // "Ready to publish" is computed, not counted from a status column: a lesson
  // whose checks all pass but that nobody has published is awaiting publication.
  const awaiting = (
    db.prepare("SELECT id, title, version FROM lessons WHERE content_status != 'published'").all() as {
      id: string;
      title: string;
      version: number;
    }[]
  )
    .map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      checks: publishChecks(lesson.id),
      ready: publishChecks(lesson.id, { waiveVideo: true }).filter((check) => check.key !== 'video').every((check) => check.ok)
    }))
    .filter((lesson) => lesson.ready);

  const stale = (
    db.prepare("SELECT id, title, version FROM lessons WHERE content_status = 'published'").all() as {
      id: string;
      title: string;
    }[]
  )
    .map((lesson) => ({ ...lesson, derived: derivedState(lesson.id) }))
    .filter((lesson) => lesson.derived.deck.stale || lesson.derived.videos.stale || lesson.derived.narration.stale);

  res.json({
    counts: {
      lessons: count('SELECT COUNT(*) AS n FROM lessons'),
      published: count("SELECT COUNT(*) AS n FROM lessons WHERE content_status = 'published'"),
      drafts: count("SELECT COUNT(*) AS n FROM lessons WHERE content_status IN ('draft','in_review')"),
      inReview: count("SELECT COUNT(*) AS n FROM lessons WHERE content_status = 'in_review'"),
      rendersDone: count("SELECT COUNT(*) AS n FROM render_jobs WHERE state = 'done'"),
      rendersFailed: count("SELECT COUNT(*) AS n FROM render_jobs WHERE state = 'error'"),
      rendersActive: count("SELECT COUNT(*) AS n FROM render_jobs WHERE state IN ('queued','rendering','encoding','validating')"),
      audioApproved: count("SELECT COUNT(*) AS n FROM audio_tracks WHERE status = 'approved'"),
      audioCandidates: count("SELECT COUNT(*) AS n FROM audio_tracks WHERE status = 'candidate'"),
      users: count('SELECT COUNT(*) AS n FROM users'),
      roadmaps: count('SELECT COUNT(*) AS n FROM roadmaps')
    },
    drafts,
    failed,
    active,
    awaitingPublication: awaiting.slice(0, 6),
    staleAssets: stale.slice(0, 6)
  });
});

/* -------------------------------------------------------------------- themes */

adminApi.get('/themes', requireAction('content:read'), (_req, res) => {
  const counts = db
    .prepare('SELECT theme_id, COUNT(*) AS n FROM lessons GROUP BY theme_id')
    .all() as { theme_id: string; n: number }[];
  const map = new Map(counts.map((row) => [row.theme_id, row.n]));
  res.json({
    themes: THEMES.map((theme) => ({
      ...theme,
      lessons: map.get(theme.id) || 0
    }))
  });
});

/* ---------------------------------------------------------------- content lib */

adminApi.get('/lessons', requireAction('content:read'), (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim();
  const rows = db
    .prepare(
      `SELECT lessons.id, lessons.slug, lessons.title, lessons.summary, lessons.content_status, lessons.version,
              lessons.difficulty, lessons.theme_id, lessons.estimated_minutes, lessons.updated_at, lessons.published_at,
              concepts.name AS concept, concepts.category
       FROM lessons JOIN concepts ON concepts.id = lessons.concept_id
       ORDER BY lessons.updated_at DESC`
    )
    .all() as Record<string, unknown>[];
  const filtered = rows.filter((row) => {
    if (status && String(row.content_status) !== status) return false;
    if (q && !`${row.title} ${row.concept} ${row.slug}`.toLowerCase().includes(q)) return false;
    return true;
  });
  // The roadmap is the learning sequence: a lesson's module and position come from
  // its roadmap item, so the list can be read as a path rather than a table.
  const placements = db
    .prepare(
      `SELECT roadmap_items.lesson_id, roadmap_items.position,
              roadmap_modules.title AS module_title, roadmap_modules.summary AS module_summary,
              roadmap_modules.position AS module_position,
              roadmaps.title AS roadmap_title, roadmaps.position AS roadmap_position
       FROM roadmap_items
       JOIN roadmap_modules ON roadmap_modules.id = roadmap_items.module_id
       JOIN roadmaps ON roadmaps.id = roadmap_modules.roadmap_id
       ORDER BY roadmaps.position, roadmap_modules.position, roadmap_items.position`
    )
    .all() as Record<string, unknown>[];
  const placement = new Map<string, Record<string, unknown>>();
  for (const item of placements) {
    const lessonId = String(item.lesson_id);
    if (!placement.has(lessonId)) placement.set(lessonId, item);
  }
  res.json({
    lessons: filtered.map((row) => ({
      ...row,
      derived: derivedState(String(row.id)),
      roadmap: placement.get(String(row.id)) || null
    }))
  });
});

adminApi.get('/lessons/:id', requireAction('content:read'), (req, res) => {
  const lesson = lessonRow(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const concept = conceptRow(String(lesson.concept_id));
  res.json({
    lesson: {
      ...lesson,
      objectives: safeJson<string[]>(String(lesson.learning_objectives || '[]'), []),
      topics: safeJson<string[]>(String(lesson.topics || '[]'), [])
    },
    concept,
    sections: sectionsOf(req.params.id),
    code: codeOf(req.params.id),
    quiz: quizOf(req.params.id).map((question) => ({
      ...question,
      options: safeJson<string[]>(question.options, [])
    })),
    slides: (() => {
      const deck = deckOf(req.params.id);
      return deck ? { deck, items: slidesOf(deck.id) } : null;
    })(),
    assets: assetsOf(req.params.id).map((asset) => ({ ...asset, available: existsSync(asset.file_path) })),
    derived: derivedState(req.params.id),
    checks: publishChecks(req.params.id),
    reviews: db
      .prepare('SELECT * FROM review_records WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 10')
      .all(req.params.id),
    voiceover: voiceoverState(req.params.id),
    themes: THEMES.map((theme) => ({ id: theme.id, name: theme.name }))
  });
});

adminApi.patch('/lessons/:id', requireAction('content:write'), (req, res) => {
  const lesson = lessonRow(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const fields: Record<string, unknown> = {};
  const text = (key: string, max = 4000) => {
    if (typeof req.body?.[key] === 'string') fields[key] = req.body[key].slice(0, max);
  };
  text('title', 200);
  text('summary', 600);
  text('difficulty', 24);
  text('prerequisites', 600);
  text('objective', 600);
  text('hook', 400);
  text('key_takeaway', 600);
  if (req.body?.estimated_minutes !== undefined) {
    const minutes = Number(req.body.estimated_minutes);
    if (Number.isFinite(minutes)) fields.estimated_minutes = Math.max(1, Math.min(600, Math.round(minutes)));
  }
  if (Array.isArray(req.body?.objectives)) {
    fields.learning_objectives = JSON.stringify(
      (req.body.objectives as unknown[]).map((item) => String(item).slice(0, 300)).filter(Boolean).slice(0, 8)
    );
  }
  if (Array.isArray(req.body?.topics)) {
    fields.topics = JSON.stringify(
      (req.body.topics as unknown[]).map((item) => String(item).slice(0, 60)).filter(Boolean).slice(0, 8)
    );
  }
  if (typeof req.body?.content_status === 'string') {
    const allowed = ['draft', 'in_review', 'approved', 'published'];
    if (!allowed.includes(req.body.content_status)) {
      return res.status(400).json({ error: 'Unknown content status.' });
    }
    // Publishing has its own gated route; this only moves the editorial state.
    if (req.body.content_status !== 'published') fields.content_status = req.body.content_status;
  }
  if (typeof req.body?.slug === 'string') {
    const slug = req.body.slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70);
    if (!slug) return res.status(400).json({ error: 'A slug needs letters or numbers.' });
    const taken = db.prepare('SELECT id FROM lessons WHERE slug = ? AND id != ?').get(slug, req.params.id);
    if (taken) return res.status(409).json({ error: 'That slug is already used by another lesson.' });
    fields.slug = slug;
  }
  const entries = Object.entries(fields);
  if (entries.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  db.prepare(
    `UPDATE lessons SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`
  ).run(...entries.map(([, value]) => value as never), req.params.id);
  bumpLessonVersion(req.params.id);
  res.json({ lesson: lessonRow(req.params.id), derived: derivedState(req.params.id), checks: publishChecks(req.params.id) });
});

/** Replaces a lesson's structured sections in one call. */
adminApi.put('/lessons/:id/sections', requireAction('content:write'), (req, res) => {
  if (!lessonRow(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const raw = Array.isArray(req.body?.sections) ? (req.body.sections as Record<string, unknown>[]) : null;
  if (!raw) return res.status(400).json({ error: 'Send the sections as an array.' });
  const sections = raw
    .map((section, index) => ({
      id: String(section.id || `sec-${req.params.id}-${index}-${Date.now().toString(36)}`),
      position: index,
      heading: String(section.heading ?? '').slice(0, 200),
      body: String(section.body ?? '').slice(0, 8000),
      kind: ['concept', 'example', 'complexity', 'edge', 'recap'].includes(String(section.kind))
        ? String(section.kind)
        : 'concept'
    }))
    .filter((section) => section.heading.trim() || section.body.trim());

  db.transaction(() => {
    db.prepare('DELETE FROM lesson_sections WHERE lesson_id = ?').run(req.params.id);
    const insert = db.prepare(
      'INSERT INTO lesson_sections (id, lesson_id, position, heading, body, kind) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const section of sections) {
      insert.run(section.id, req.params.id, section.position, section.heading, section.body, section.kind);
    }
  })();
  bumpLessonVersion(req.params.id);
  res.json({ sections: sectionsOf(req.params.id), derived: derivedState(req.params.id) });
});

adminApi.put('/lessons/:id/code', requireAction('content:write'), (req, res) => {
  if (!lessonRow(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const raw = Array.isArray(req.body?.examples) ? (req.body.examples as Record<string, unknown>[]) : null;
  if (!raw) return res.status(400).json({ error: 'Send the code examples as an array.' });
  const examples = raw
    .map((example, index) => ({
      id: String(example.id || `code-${req.params.id}-${index}-${Date.now().toString(36)}`),
      position: index,
      language: String(example.language ?? '').slice(0, 24) || 'text',
      label: String(example.label ?? '').slice(0, 120),
      code: String(example.code ?? '').slice(0, 12000),
      expected_output: String(example.expected_output ?? '').slice(0, 2000),
      notes: String(example.notes ?? '').slice(0, 2000)
    }))
    .filter((example) => example.code.trim());

  db.transaction(() => {
    db.prepare('DELETE FROM code_examples WHERE lesson_id = ?').run(req.params.id);
    const insert = db.prepare(
      `INSERT INTO code_examples (id, lesson_id, position, language, label, code, expected_output, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const example of examples) {
      insert.run(
        example.id,
        req.params.id,
        example.position,
        example.language,
        example.label,
        example.code,
        example.expected_output,
        example.notes
      );
    }
  })();
  bumpLessonVersion(req.params.id);
  res.json({ code: codeOf(req.params.id), derived: derivedState(req.params.id) });
});

adminApi.put('/lessons/:id/quiz', requireAction('content:write'), (req, res) => {
  if (!lessonRow(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const raw = Array.isArray(req.body?.questions) ? (req.body.questions as Record<string, unknown>[]) : null;
  if (!raw) return res.status(400).json({ error: 'Send the questions as an array.' });
  const questions = raw
    .map((question, index) => {
      const options = Array.isArray(question.options)
        ? (question.options as unknown[]).map((option) => String(option).slice(0, 300)).filter(Boolean)
        : [];
      const answer = Number(question.answer_index);
      return {
        id: String(question.id || `quiz-${req.params.id}-${index}-${Date.now().toString(36)}`),
        position: index,
        prompt: String(question.prompt ?? '').slice(0, 400),
        options,
        answer_index: Number.isFinite(answer) ? Math.max(0, Math.min(options.length - 1, Math.round(answer))) : 0,
        explanation: String(question.explanation ?? '').slice(0, 1000)
      };
    })
    .filter((question) => question.prompt.trim() && question.options.length >= 2);

  db.transaction(() => {
    db.prepare('DELETE FROM quiz_questions WHERE lesson_id = ?').run(req.params.id);
    const insert = db.prepare(
      'INSERT INTO quiz_questions (id, lesson_id, position, prompt, options, answer_index, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const question of questions) {
      insert.run(
        question.id,
        req.params.id,
        question.position,
        question.prompt,
        JSON.stringify(question.options),
        question.answer_index,
        question.explanation
      );
    }
  })();
  bumpLessonVersion(req.params.id);
  res.json({ quiz: quizOf(req.params.id), derived: derivedState(req.params.id) });
});

/** Rebuilds the slide deck from the current verified storyboard. */
adminApi.post('/lessons/:id/slides', requireAction('content:write'), (req, res) => {
  const result = generateSlideDeck(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ deck: result.deck, items: result.deck ? slidesOf(result.deck.id) : [] });
});

adminApi.post('/lessons/:id/theme', requireAction('theme:override'), (req, res) => {
  const lesson = lessonRow(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  if (!isThemeId(req.body?.themeId)) return res.status(400).json({ error: 'Choose one of the four themes.' });
  db.prepare('UPDATE lessons SET theme_id = ?, updated_at = ? WHERE id = ?').run(req.body.themeId, nowIso(), req.params.id);
  // A new theme makes every existing poster/video surface stale, so the version moves.
  bumpLessonVersion(req.params.id);
  res.json({ lesson: lessonRow(req.params.id), derived: derivedState(req.params.id) });
});

/* ------------------------------------------------------------ review/publish */

adminApi.post('/lessons/:id/review', requireAction('review:decide'), (req, res) => {
  const user = (req as AuthedRequest).user!;
  const lesson = lessonRow(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const decision = String(req.body?.decision || '');
  if (!['approved', 'changes_requested'].includes(decision)) {
    return res.status(400).json({ error: 'Choose approved or changes_requested.' });
  }
  const checks = Array.isArray(req.body?.checklist) ? req.body.checklist : [];
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO review_records (id, lesson_id, lesson_version, reviewer, reviewer_id, checklist, decision, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(),
    req.params.id,
    Number(lesson.version || 1),
    user.name || user.email,
    user.id,
    JSON.stringify(checks),
    decision,
    String(req.body?.notes || '').slice(0, 2000),
    stamp
  );
  db.prepare("UPDATE lessons SET content_status = ?, review_status = ?, updated_at = ? WHERE id = ?").run(
    decision === 'approved' ? 'approved' : 'in_review',
    decision === 'approved' ? 'approved' : 'in_review',
    stamp,
    req.params.id
  );
  res.json({ checks: publishChecks(req.params.id), reviews: db.prepare('SELECT * FROM review_records WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 10').all(req.params.id) });
});

adminApi.post('/lessons/:id/publish', requireAction('content:publish'), (req, res) => {
  const user = (req as AuthedRequest).user!;
  const result = publishLesson(req.params.id, {
    reviewerId: user.id,
    reviewerName: user.name || user.email,
    waiveVideo: req.body?.waiveVideo === true,
    notes: String(req.body?.notes || '')
  });
  if (result.error) return res.status(409).json({ error: result.error, checks: result.checks });
  res.json({ lesson: lessonRow(req.params.id), checks: publishChecks(req.params.id) });
});

adminApi.post('/lessons/:id/unpublish', requireAction('content:publish'), (req, res) => {
  const lesson = lessonRow(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  db.prepare("UPDATE lessons SET content_status = 'draft', published_at = NULL, updated_at = ? WHERE id = ?").run(
    nowIso(),
    req.params.id
  );
  res.json({ lesson: lessonRow(req.params.id) });
});

/* -------------------------------------------------------------------- videos */

adminApi.get('/videos', requireAction('content:read'), (_req, res) => {
  const jobs = db
    .prepare(
      `SELECT render_jobs.id, render_jobs.lesson_id, render_jobs.preset, render_jobs.state, render_jobs.progress,
              render_jobs.error, render_jobs.bytes, render_jobs.duration_seconds, render_jobs.theme_id, render_jobs.created_at,
              lessons.title, lessons.slug
       FROM render_jobs JOIN lessons ON lessons.id = render_jobs.lesson_id
       ORDER BY render_jobs.created_at DESC LIMIT 40`
    )
    .all() as Record<string, unknown>[];
  const assets = db
    .prepare(
      `SELECT video_assets.*, lessons.title, lessons.slug
       FROM video_assets JOIN lessons ON lessons.id = video_assets.lesson_id
       ORDER BY video_assets.created_at DESC LIMIT 40`
    )
    .all() as Record<string, unknown>[];
  res.json({
    jobs: jobs.map((job) => ({ ...job, registered: Boolean(db.prepare('SELECT 1 FROM video_assets WHERE render_job_id = ?').get(String(job.id))) })),
    assets: assets.map((asset) => ({ ...asset, available: existsSync(String(asset.file_path)) })),
    presets: Object.entries(PRESETS).map(([key, value]) => ({ key, ...value })),
    tracks: approvedTracks().map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      attribution: track.attribution_required ? track.attribution_text : ''
    }))
  });
});

/** Enqueues a render and, when it finishes, it can be registered as the asset. */
adminApi.post('/videos/render', requireAction('render:run'), (req, res) => {
  const lessonId = String(req.body?.lessonId || '');
  const preset = String(req.body?.preset || 'hd');
  if (!['preview', 'hd', '4k'].includes(preset)) return res.status(400).json({ error: 'Unknown export preset.' });
  const result = createJob(lessonId, preset as 'preview' | 'hd' | '4k');
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ job: result.job });
});

adminApi.post('/videos/register', requireAction('render:run'), (req, res) => {
  const asset = registerRenderAsset(String(req.body?.jobId || ''));
  if (!asset) return res.status(400).json({ error: 'Only a finished, validated render can become a video asset.' });
  res.status(201).json({ asset });
});

adminApi.post('/videos/variant', requireAction('render:run'), async (req, res) => {
  const audioMode = String(req.body?.audioMode || '');
  if (!['music', 'voiceover'].includes(audioMode)) {
    return res.status(400).json({ error: 'Choose music or voiceover.' });
  }
  const result = await createAudioVariant({
    lessonId: String(req.body?.lessonId || ''),
    audioMode: audioMode as 'music' | 'voiceover',
    assetId: req.body?.assetId ? String(req.body.assetId) : undefined,
    musicTrackId: req.body?.musicTrackId ? String(req.body.musicTrackId) : undefined,
    narrationTrackId: req.body?.narrationTrackId ? String(req.body.narrationTrackId) : undefined,
    mixMusicUnderNarration: req.body?.mixMusic === true
  });
  if (result.error && !result.asset) return res.status(400).json({ error: result.error });
  res.status(result.error ? 422 : 201).json({ asset: result.asset, warning: result.error || null });
});

/* --------------------------------------------------------------------- audio */

adminApi.get('/audio', requireAction('content:read'), (_req, res) => {
  const tracks = db.prepare('SELECT * FROM audio_tracks ORDER BY status, title').all() as AudioTrackRow[];
  res.json({
    tracks: tracks.map((track) => ({ ...track, available: Boolean(track.file_path) && existsSync(track.file_path) })),
    music: tracks.filter((track) => track.kind === 'music')
  });
});

adminApi.post('/audio', requireAction('audio:manage'), (req, res) => {
  const user = (req as AuthedRequest).user!;
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'A track needs a title.' });
  const id = `track-${newId().slice(0, 8)}`;
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO audio_tracks (id, title, artist, source_page, source_url, license_type, license_evidence,
       commercial_use, social_use, attribution_required, attribution_text, restrictions, review_notes,
       reviewed_at, reviewed_by, kind, lesson_id, status, file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'candidate', ?, ?, ?)`
  ).run(
    id,
    title.slice(0, 160),
    String(req.body?.artist || '').slice(0, 160),
    String(req.body?.source_page || '').slice(0, 400),
    String(req.body?.source_url || '').slice(0, 400),
    String(req.body?.license_type || '').slice(0, 120),
    String(req.body?.license_evidence || '').slice(0, 400),
    req.body?.commercial_use ? 1 : 0,
    req.body?.social_use ? 1 : 0,
    req.body?.attribution_required ? 1 : 0,
    String(req.body?.attribution_text || '').slice(0, 400),
    String(req.body?.restrictions || '').slice(0, 600),
    String(req.body?.review_notes || '').slice(0, 600),
    user.name || user.email,
    req.body?.kind === 'narration' ? 'narration' : 'music',
    req.body?.lesson_id ? String(req.body.lesson_id) : null,
    String(req.body?.file_path || '').slice(0, 400),
    stamp,
    stamp
  );
  res.status(201).json({ track: db.prepare('SELECT * FROM audio_tracks WHERE id = ?').get(id) });
});

adminApi.patch('/audio/:id', requireAction('audio:manage'), (req, res) => {
  const user = (req as AuthedRequest).user!;
  const existing = db.prepare('SELECT * FROM audio_tracks WHERE id = ?').get(req.params.id) as AudioTrackRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Track not found.' });
  const fields: Record<string, unknown> = {};
  for (const key of [
    'title', 'artist', 'source_page', 'source_url', 'license_type', 'license_evidence', 'attribution_text',
    'restrictions', 'review_notes', 'file_path'
  ]) {
    if (typeof req.body?.[key] === 'string') fields[key] = req.body[key].slice(0, 2000);
  }
  for (const key of ['commercial_use', 'social_use', 'attribution_required']) {
    if (req.body?.[key] !== undefined) fields[key] = req.body[key] ? 1 : 0;
  }
  if (typeof req.body?.status === 'string') {
    if (!['candidate', 'approved', 'rejected'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Unknown licence status.' });
    }
    // Approving requires the licence facts a reviewer is accountable for.
    if (req.body.status === 'approved') {
      const merged = { ...existing, ...fields } as AudioTrackRow;
      if (!merged.license_type.trim() || !merged.license_evidence.trim()) {
        return res.status(400).json({ error: 'Record the licence type and its evidence before approving a track.' });
      }
      fields.reviewed_at = nowIso();
      fields.reviewed_by = user.name || user.email;
    }
    fields.status = req.body.status;
  }
  const entries = Object.entries(fields);
  if (entries.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  db.prepare(
    `UPDATE audio_tracks SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...entries.map(([, value]) => value as never), nowIso(), req.params.id);
  res.json({ track: db.prepare('SELECT * FROM audio_tracks WHERE id = ?').get(req.params.id) });
});

adminApi.delete('/audio/:id', requireAction('audio:manage'), (req, res) => {
  const used = db.prepare('SELECT 1 FROM video_assets WHERE audio_track_id = ?').get(req.params.id);
  if (used) return res.status(409).json({ error: 'That track is used by an exported variant.' });
  const result = db.prepare('DELETE FROM audio_tracks WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Track not found.' });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ roadmaps */

adminApi.get('/roadmaps', requireAction('content:read'), (_req, res) => {
  const roadmaps = db.prepare('SELECT * FROM roadmaps ORDER BY position, created_at').all() as Record<string, unknown>[];
  res.json({
    roadmaps: roadmaps.map((roadmap) => {
      const modules = db
        .prepare('SELECT * FROM roadmap_modules WHERE roadmap_id = ? ORDER BY position')
        .all(String(roadmap.id)) as Record<string, unknown>[];
      return {
        ...roadmap,
        modules: modules.map((module) => ({
          ...module,
          items: db
            .prepare(
              `SELECT roadmap_items.id, roadmap_items.position, lessons.id AS lesson_id, lessons.title, lessons.slug, lessons.content_status
               FROM roadmap_items JOIN lessons ON lessons.id = roadmap_items.lesson_id
               WHERE roadmap_items.module_id = ? ORDER BY roadmap_items.position`
            )
            .all(String(module.id))
        }))
      };
    }),
    lessons: db
      .prepare('SELECT id, title, content_status FROM lessons ORDER BY title')
      .all()
  });
});

adminApi.post('/roadmaps', requireAction('content:write'), (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'A roadmap needs a title.' });
  let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (db.prepare('SELECT 1 FROM roadmaps WHERE slug = ?').get(slug)) slug = `${slug}-${newId().slice(0, 4)}`;
  const id = newId();
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO roadmaps (id, slug, title, description, prerequisites, outcomes, published, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(
    id,
    slug,
    title.slice(0, 160),
    String(req.body?.description || '').slice(0, 1200),
    String(req.body?.prerequisites || '').slice(0, 600),
    String(req.body?.outcomes || '').slice(0, 1200),
    (db.prepare('SELECT COUNT(*) AS n FROM roadmaps').get() as { n: number }).n,
    stamp,
    stamp
  );
  res.status(201).json({ roadmap: db.prepare('SELECT * FROM roadmaps WHERE id = ?').get(id) });
});

adminApi.patch('/roadmaps/:id', requireAction('content:write'), (req, res) => {
  const existing = db.prepare('SELECT * FROM roadmaps WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Roadmap not found.' });
  const fields: Record<string, unknown> = {};
  for (const key of ['title', 'description', 'prerequisites', 'outcomes']) {
    if (typeof req.body?.[key] === 'string') fields[key] = req.body[key].slice(0, 1200);
  }
  if (req.body?.published !== undefined) fields.published = req.body.published ? 1 : 0;
  const entries = Object.entries(fields);
  if (entries.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  db.prepare(
    `UPDATE roadmaps SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...entries.map(([, value]) => value as never), nowIso(), req.params.id);
  res.json({ roadmap: db.prepare('SELECT * FROM roadmaps WHERE id = ?').get(req.params.id) });
});

adminApi.post('/roadmaps/:id/modules', requireAction('content:write'), (req, res) => {
  if (!db.prepare('SELECT 1 FROM roadmaps WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Roadmap not found.' });
  }
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'A module needs a title.' });
  const position = (db.prepare('SELECT COUNT(*) AS n FROM roadmap_modules WHERE roadmap_id = ?').get(req.params.id) as { n: number }).n;
  const id = newId();
  db.prepare('INSERT INTO roadmap_modules (id, roadmap_id, title, summary, position) VALUES (?, ?, ?, ?, ?)').run(
    id,
    req.params.id,
    title.slice(0, 160),
    String(req.body?.summary || '').slice(0, 600),
    position
  );
  res.status(201).json({ module: db.prepare('SELECT * FROM roadmap_modules WHERE id = ?').get(id) });
});

adminApi.post('/modules/:id/items', requireAction('content:write'), (req, res) => {
  const module = db.prepare('SELECT * FROM roadmap_modules WHERE id = ?').get(req.params.id);
  if (!module) return res.status(404).json({ error: 'Module not found.' });
  const lessonId = String(req.body?.lessonId || '');
  if (!db.prepare('SELECT 1 FROM lessons WHERE id = ?').get(lessonId)) {
    return res.status(404).json({ error: 'Lesson not found.' });
  }
  const position = (db.prepare('SELECT COUNT(*) AS n FROM roadmap_items WHERE module_id = ?').get(req.params.id) as { n: number }).n;
  const id = newId();
  db.prepare('INSERT INTO roadmap_items (id, module_id, lesson_id, position) VALUES (?, ?, ?, ?)').run(
    id,
    req.params.id,
    lessonId,
    position
  );
  res.status(201).json({ item: { id, position, lessonId } });
});

adminApi.delete('/items/:id', requireAction('content:write'), (req, res) => {
  const result = db.prepare('DELETE FROM roadmap_items WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Item not found.' });
  res.json({ ok: true });
});

/* --------------------------------------------------------------------- users */

adminApi.get('/users', requireAction('users:manage'), (_req, res) => {
  res.json({
    users: db
      .prepare('SELECT id, email, name, role, created_at, updated_at FROM users ORDER BY role DESC, email')
      .all(),
    roles: ROLES
  });
});

adminApi.post('/users', requireAction('users:manage'), (req, res) => {
  const role: Role = isRole(req.body?.role) ? req.body.role : 'learner';
  const result = createUser({ ...(req.body || {}), role });
  if (!result.user) return res.status(400).json({ error: result.error });
  res.status(201).json({ user: result.user });
});

adminApi.patch('/users/:id', requireAction('users:manage'), (req, res) => {
  const user = (req as AuthedRequest).user!;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
    | { id: string; role: string; email: string }
    | undefined;
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const fields: Record<string, unknown> = {};
  if (typeof req.body?.role === 'string') {
    if (!isRole(req.body.role)) return res.status(400).json({ error: 'Unknown role.' });
    if (target.id === user.id && req.body.role !== 'admin') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number };
      if (admins.n <= 1) return res.status(409).json({ error: 'You are the last admin — promote someone else first.' });
    }
    fields.role = req.body.role;
  }
  if (typeof req.body?.name === 'string') fields.name = req.body.name.slice(0, 80);
  const entries = Object.entries(fields);
  if (entries.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  db.prepare(
    `UPDATE users SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...entries.map(([, value]) => value as never), nowIso(), req.params.id);
  res.json({ user: publicUser(req.params.id) });
});

adminApi.delete('/users/:id', requireAction('users:manage'), (req, res) => {
  const user = (req as AuthedRequest).user!;
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id) as { role: string } | undefined;
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (req.params.id === user.id) return res.status(409).json({ error: 'You cannot delete your own account.' });
  if (target.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number };
    if (admins.n <= 1) return res.status(409).json({ error: 'The last admin cannot be removed.' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/** The lesson content hash is exposed so the studio can show what changed. */
adminApi.get('/lessons/:id/hash', requireAction('content:read'), (req, res) => {
  res.json({ hash: lessonContentHash(req.params.id), theme: themeById(String(lessonRow(req.params.id)?.theme_id)).id });
});
