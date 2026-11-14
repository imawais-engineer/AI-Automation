/**
 * Read-only visual previews of a stored storyboard: layout inspection, scene
 * stills and single-scene motion clips. These expose the same plan the renderer
 * uses, so the Studio previews what the MP4 will contain.
 */
import { Router } from 'express';

import { requireAction } from '../auth.ts';
import { inspectPlan } from '../anim/inspect.ts';
import { motionForLesson } from '../motion.ts';
import { sceneClip, thumbnail } from '../render/jobs.ts';

export const previewRouter = Router();

/** Layout, pointer and algorithm-state inspection of the stored storyboard. */
previewRouter.get('/lessons/:id/inspect', requireAction('content:read'), (req, res) => {
  const built = motionForLesson(req.params.id);
  if (!built) return res.status(400).json({ error: 'Build the storyboard first — there is no plan to inspect.' });
  const audit = inspectPlan(built.motion);
  res.json({ audit });
});

previewRouter.get('/lessons/:id/scene/:index.png', requireAction('content:read'), (req, res) => {
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
previewRouter.get('/lessons/:id/scene/:index/clip.mp4', requireAction('content:read'), async (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'Invalid scene index.' });
  const result = await sceneClip(req.params.id, index, 540);
  if (!result.file) return res.status(500).json({ error: result.error || 'Scene preview failed.' });
  res.type('video/mp4');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.sendFile(result.file);
});
