/**
 * Narration: the voice-over script, its recorded takes and the audio export that
 * remuxes a take under the validated silent master.
 */
import { Router } from 'express';

import { requireAction } from '../auth.ts';
import { formatVoiceover } from '../voiceover.ts';
import { generateVoiceoverFor, saveVoiceoverEdits, voiceoverState } from '../voiceover-store.ts';
import { generateNarrationFor, narrationStatus } from '../tts/narration.ts';
import { createAudioVariant } from '../render/variants.ts';
import { requireLesson } from './shared.ts';

export const narrationRouter = Router();

/* ---------------------------------------------------------------- voice-over */

/** The stored script plus its freshness and accuracy checks. */
narrationRouter.get('/lessons/:id/voiceover', requireAction('content:read'), (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const status = voiceoverState(req.params.id);
  res.json({
    voiceover: status,
    markdown: status.script ? formatVoiceover(status.script) : ''
  });
});

/** Generates or regenerates the script — no video render is needed for this. */
narrationRouter.post('/lessons/:id/voiceover', requireAction('content:write'), (req, res) => {
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
narrationRouter.patch('/lessons/:id/voiceover', requireAction('content:write'), (req, res) => {
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

/* ------------------------------------------------------------------ narration */

/** The takes recorded for this lesson, plus which provider is usable right now. */
narrationRouter.get('/lessons/:id/narration', requireAction('content:read'), (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  res.json(narrationStatus(req.params.id));
});

/** Speaks the current voice-over script and records the take in the audio library. */
narrationRouter.post('/lessons/:id/narration', requireAction('content:write'), async (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const speed = Number(req.body?.speed);
  const expressivity = Number(req.body?.expressivity);
  const result = await generateNarrationFor(req.params.id, {
    provider: req.body?.provider ? String(req.body.provider) : undefined,
    model: req.body?.model ? String(req.body.model) : undefined,
    speed: Number.isFinite(speed) ? speed : undefined,
    expressivity: Number.isFinite(expressivity) ? expressivity : undefined
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ take: result.take, durationSeconds: result.durationSeconds, narration: narrationStatus(req.params.id) });
});

/** Remuxes a narration take under the validated silent master. */
narrationRouter.post('/lessons/:id/narration/export', requireAction('render:run'), async (req, res) => {
  if (!requireLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found.' });
  const trackId = String(req.body?.trackId || '');
  if (!trackId) return res.status(400).json({ error: 'Choose a narration take to export.' });
  const result = await createAudioVariant({ lessonId: req.params.id, audioMode: 'voiceover', narrationTrackId: trackId });
  if (result.error && !result.asset) return res.status(400).json({ error: result.error });
  res.status(result.error ? 422 : 201).json({ asset: result.asset, warning: result.error || null });
});
