/**
 * Render jobs, delivery of finished MP4s, per-platform captions and the
 * publishing queue. Everything a finished video needs after it exists.
 */
import { Router } from 'express';

import { db, newId, nowIso, readBranding } from '../db.ts';
import { lessonBundle } from '../render/jobs.ts';
import {
  cancelJob,
  createJob,
  recentFailures,
  retryJob,
  type Preset,
  type RenderJob
} from '../render/jobs.ts';
import { cleanupPlan, duplicatePlan, KEEP_PER_LESSON, runCleanup, runDedupe } from '../render/cleanup.ts';
import { parseValidation } from '../render/quality.ts';
import { buildPublishCopy, type PublishCopyInput } from '../publish-copy.ts';
import { CAPTION_PLATFORMS, captionsFor, type SavedCaption } from '../video-captions.ts';
import { effectiveConcept, lessonDurationMs, runConcept } from '../scenes.ts';
import { requireAction } from '../auth.ts';
import { PLATFORMS, requireLesson, slugify } from './shared.ts';

export const rendersRouter = Router();

/* ------------------------------------------------------------------- renders */

rendersRouter.post('/renders', requireAction('render:run'), (req, res) => {
  const lessonId = String(req.body?.lessonId || '');
  const preset = String(req.body?.preset || 'hd') as Preset;
  const result = createJob(lessonId, preset);
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ job: result.job });
});

rendersRouter.get('/renders', requireAction('content:read'), (req, res) => {
  const lessonId = String(req.query.lessonId || '');
  const jobs = db
    .prepare(
      `SELECT render_jobs.*, lessons.title AS lesson_title
       FROM render_jobs JOIN lessons ON lessons.id = render_jobs.lesson_id
       WHERE (? = '' OR render_jobs.lesson_id = ?)
       ORDER BY render_jobs.created_at DESC LIMIT 40`
    )
    .all(lessonId, lessonId);
  res.json({ renders: jobs, failures: lessonId ? [] : recentFailures() });
});

/** What a cleanup would remove, so the Studio can confirm before deleting. */
rendersRouter.get('/renders/cleanup', requireAction('render:run'), (_req, res) => {
  res.json({ keepPerLesson: KEEP_PER_LESSON, plan: cleanupPlan() });
});

/** Deletes every render beyond the newest two of its lesson, and their MP4s. */
rendersRouter.post('/renders/cleanup', requireAction('render:run'), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id: unknown) => String(id)) : undefined;
  const result = await runCleanup(ids);
  res.status(result.failed.length > 0 ? 207 : 200).json({ result });
});

/** Older copies of the newest render per lesson and profile, so the Studio can confirm. */
rendersRouter.get('/renders/duplicates', requireAction('render:run'), (_req, res) => {
  res.json({ plan: duplicatePlan() });
});

/** Deletes every duplicate render older than the newest copy of its lesson and profile. */
rendersRouter.post('/renders/duplicates', requireAction('render:run'), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id: unknown) => String(id)) : undefined;
  const result = await runDedupe(ids);
  res.status(result.failed.length > 0 ? 207 : 200).json({ result });
});

rendersRouter.get('/renders/:id', requireAction('content:read'), (req, res) => {
  const job = db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(req.params.id) as RenderJob | undefined;
  if (!job) return res.status(404).json({ error: 'Render job not found.' });
  res.json({ job, validation: parseValidation(job.validation) });
});

rendersRouter.post('/renders/:id/retry', requireAction('render:run'), (req, res) => {
  const result = retryJob(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ job: result.job });
});

rendersRouter.post('/renders/:id/cancel', requireAction('render:run'), (req, res) => {
  const result = cancelJob(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ job: result.job });
});

/** Inline playback for the preview player; the download route stays a download. */
rendersRouter.get('/renders/:id/stream', requireAction('content:read'), (req, res) => {
  const job = db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(req.params.id) as RenderJob | undefined;
  if (!job || job.state !== 'done' || !job.output_path) {
    return res.status(404).json({ error: 'This render has no finished MP4 yet.' });
  }
  res.type('video/mp4');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(job.output_path);
});

rendersRouter.get('/renders/:id/video', requireAction('content:read'), (req, res) => {
  const job = db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(req.params.id) as RenderJob | undefined;
  if (!job || job.state !== 'done' || !job.output_path) {
    return res.status(404).json({ error: 'This render has no finished MP4 yet.' });
  }
  // The upload copy is named for its lesson: arrays_video.mp4, linked-lists_video.mp4.
  const lesson = db.prepare('SELECT slug, title FROM lessons WHERE id = ?').get(job.lesson_id) as
    | { slug: string | null; title: string }
    | undefined;
  const name = `${slugify(String(lesson?.slug || lesson?.title || 'short'))}_video.mp4`;
  res.download(job.output_path, name);
});

/* ------------------------------------------------------------ publish copy */

/** The lesson fields the platform copy is written from. */
function publishCopyInput(lessonId: string): PublishCopyInput | null {
  const bundle = lessonBundle(lessonId);
  if (!bundle) return null;
  return {
    title: bundle.lesson.title,
    hook: bundle.lesson.hook,
    takeaway: bundle.lesson.key_takeaway,
    time: bundle.concept.complexity_time,
    space: bundle.concept.complexity_space,
    category: String((bundle.concept as unknown as { category?: string }).category || ''),
    slug: String((bundle.lesson as unknown as { slug?: string }).slug || ''),
    seconds: Math.round(lessonDurationMs(bundle.lesson, bundle.concept, readBranding()) / 1000)
  };
}

function savedCaptions(renderId: string): SavedCaption[] {
  return db
    .prepare('SELECT platform, title, description, updated_at FROM video_captions WHERE render_id = ?')
    .all(renderId) as SavedCaption[];
}

/** Per-platform post copy for a lesson: Facebook, Instagram, LinkedIn, X, YouTube. */
rendersRouter.get('/lessons/:id/publish-copy', requireAction('content:read'), (req, res) => {
  const input = publishCopyInput(req.params.id);
  if (!input) return res.status(404).json({ error: 'Lesson not found.' });
  const bundle = lessonBundle(req.params.id)!;
  const run = runConcept(effectiveConcept(bundle.lesson, bundle.concept));
  res.json({ lessonId: req.params.id, copy: buildPublishCopy(input), verified: run.validation.ok });
});

/* -------------------------------------------------------- video captions */

/** The four platform captions of one finished video, saved or drafted. */
rendersRouter.get('/renders/:id/captions', requireAction('content:read'), (req, res) => {
  const job = db.prepare('SELECT id, lesson_id FROM render_jobs WHERE id = ?').get(req.params.id) as
    | { id: string; lesson_id: string }
    | undefined;
  if (!job) return res.status(404).json({ error: 'Render job not found.' });
  const input = publishCopyInput(job.lesson_id);
  if (!input) return res.status(404).json({ error: 'Render job not found.' });
  res.json({ renderId: job.id, captions: captionsFor(input, savedCaptions(job.id)) });
});

/** Save this video's own title and description for one platform. */
rendersRouter.put('/renders/:id/captions/:platform', requireAction('content:write'), (req, res) => {
  const job = db.prepare('SELECT id, lesson_id FROM render_jobs WHERE id = ?').get(req.params.id) as
    | { id: string; lesson_id: string }
    | undefined;
  if (!job) return res.status(404).json({ error: 'Render job not found.' });
  const platform = String(req.params.platform);
  if (!CAPTION_PLATFORMS.includes(platform as (typeof CAPTION_PLATFORMS)[number])) {
    return res.status(400).json({ error: 'Choose youtube, facebook, instagram or tiktok.' });
  }
  const body = req.body as Record<string, unknown>;
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO video_captions (render_id, platform, title, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (render_id, platform) DO UPDATE SET
       title = excluded.title, description = excluded.description, updated_at = excluded.updated_at`
  ).run(job.id, platform, String(body.title ?? ''), String(body.description ?? ''), stamp, stamp);
  const input = publishCopyInput(job.lesson_id);
  if (!input) return res.status(404).json({ error: 'Render job not found.' });
  res.json({ renderId: job.id, captions: captionsFor(input, savedCaptions(job.id)) });
});

/* ---------------------------------------------------------------- publishing */

rendersRouter.get('/publishes', requireAction('content:read'), (_req, res) => {
  const publishes = db
    .prepare(
      `SELECT publish_jobs.*, lessons.title AS lesson_title
       FROM publish_jobs JOIN lessons ON lessons.id = publish_jobs.lesson_id
       ORDER BY publish_jobs.updated_at DESC`
    )
    .all();
  res.json({ publishes });
});

rendersRouter.post('/publishes', requireAction('content:publish'), (req, res) => {
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

rendersRouter.patch('/publishes/:id', requireAction('content:publish'), (req, res) => {
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

rendersRouter.delete('/publishes/:id', requireAction('content:publish'), (req, res) => {
  const result = db.prepare('DELETE FROM publish_jobs WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Publishing entry not found.' });
  res.json({ ok: true });
});
