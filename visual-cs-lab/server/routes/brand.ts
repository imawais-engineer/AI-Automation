/**
 * Brand settings and thumbnails: the palette and typography the renderer draws
 * with, the rebuild that applies them to existing videos, and the poster images.
 */
import { Router } from 'express';

import { db, nowIso, readBrand, readBranding } from '../db.ts';
import { ensureThumbnail, jpegFor, saveManualThumbnail, thumbnailStatus } from '../render/thumbnails.ts';
import { buildScenes, type LessonInput } from '../scenes.ts';
import { requireAction } from '../auth.ts';
import { pick, requireConcept, requireLesson, slugify } from './shared.ts';

export const brandRouter = Router();

/* --------------------------------------------------------------------- brand */

brandRouter.get('/brand', requireAction('content:read'), (_req, res) => {
  res.json({ brand: readBrand() });
});

brandRouter.patch('/brand', requireAction('content:write'), (req, res) => {
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
brandRouter.post('/brand/regenerate', requireAction('render:run'), (req, res) => {
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
brandRouter.get('/lessons/:id/thumbnail.png', requireAction('content:read'), (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const result = ensureThumbnail(req.params.id);
  if (!result.file) return res.status(404).json({ error: result.error || 'No thumbnail available.' });
  const lesson = requireLesson(req.params.id) as { slug?: string; title: string } | null;
  const name = `${slugify(String(lesson?.slug || lesson?.title || 'lesson'))}_thumbnail.png`;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Thumbnail-Source', result.row?.source || 'auto');
  res.download(result.file, name);
});

/** The same frame as JPEG at quality 95, named for the upload field. */
brandRouter.get('/lessons/:id/thumbnail.jpg', requireAction('content:read'), (req, res) => {
  const lesson = requireLesson(req.params.id) as { slug?: string; title: string } | null;
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const result = ensureThumbnail(req.params.id);
  if (!result.file) return res.status(404).json({ error: result.error || 'No thumbnail available.' });
  const name = `${slugify(String(lesson.slug || lesson.title || 'lesson'))}_thumbnail.jpg`;
  res.setHeader('Cache-Control', 'no-store');
  res.download(jpegFor(result.file), name);
});

/** Replaces the thumbnail without touching the video. */
brandRouter.post('/lessons/:id/thumbnail', requireAction('content:write'), async (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const result = await saveManualThumbnail(req.params.id, String(req.body?.image || ''));
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ thumbnail: thumbnailStatus(req.params.id) });
});

/** Recuts the automatic thumbnail from the current opening frame. */
brandRouter.post('/lessons/:id/thumbnail/auto', requireAction('content:write'), (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const result = ensureThumbnail(req.params.id, { force: true });
  if (!result.file) return res.status(400).json({ error: result.error || 'No thumbnail available.' });
  res.json({ thumbnail: thumbnailStatus(req.params.id), capturedAtMs: result.row?.captured_at_ms ?? 0 });
});
