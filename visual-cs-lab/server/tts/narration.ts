/**
 * Narration audio for a lesson.
 *
 * The voice-over script is the source of truth: this module speaks that exact
 * text through a TTS provider, validates the encoded file, and records it as a
 * `narration` entry in the audio library. The existing voice-over variant then
 * remuxes it under the validated silent master, so the visuals are untouched.
 *
 * Narration never replaces the script — the script can be edited and re-spoken,
 * and each take is kept with its own track id.
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { db, newId, nowIso } from '../db.ts';
import { runFfmpeg } from '../render/jobs.ts';
import type { AudioTrackRow } from '../render/variants.ts';
import { voiceoverState } from '../voiceover-store.ts';
import { deepgramConfigured, deepgramModel, synthesizeSpeech } from './deepgram.ts';

const MEDIA_DIR = process.env.MEDIA_DIR || '/tmp/visual-cs-lab/media';
const NARRATION_DIR = path.join(MEDIA_DIR, 'narration');
mkdirSync(NARRATION_DIR, { recursive: true });

export type NarrationProvider = { id: string; label: string; configured: boolean; model: string };

export type NarrationTake = {
  id: string;
  title: string;
  provider: string;
  model: string;
  status: string;
  file_path: string;
  available: boolean;
  created_at: string;
};

export type NarrationStatus = {
  providers: NarrationProvider[];
  script_ready: boolean;
  takes: NarrationTake[];
};

export type NarrationResult = { take?: NarrationTake; durationSeconds?: number; error?: string };

export type NarrationOptions = { provider?: string; model?: string; speed?: number; expressivity?: number };

/** Only Deepgram is wired up for speech today; the list is where a second provider goes. */
export function narrationProviders(): NarrationProvider[] {
  return [{ id: 'deepgram', label: 'Deepgram', configured: deepgramConfigured(), model: deepgramModel() }];
}

function takeOf(row: AudioTrackRow): NarrationTake {
  return {
    id: row.id,
    title: row.title,
    provider: row.artist,
    model: row.review_notes,
    status: row.status,
    file_path: row.file_path,
    available: Boolean(row.file_path) && existsSync(row.file_path),
    created_at: row.created_at
  };
}

/** Narration takes for one lesson, newest first, plus the provider state. */
export function narrationStatus(lessonId: string): NarrationStatus {
  const rows = db
    .prepare("SELECT * FROM audio_tracks WHERE kind = 'narration' AND lesson_id = ? ORDER BY created_at DESC")
    .all(lessonId) as AudioTrackRow[];
  const status = voiceoverState(lessonId);
  return {
    providers: narrationProviders(),
    script_ready: Boolean(status.script) && !status.outdated,
    takes: rows.map(takeOf)
  };
}

function lessonTitle(lessonId: string): string {
  const row = db.prepare('SELECT title FROM lessons WHERE id = ?').get(lessonId) as { title: string } | undefined;
  return String(row?.title || 'Untitled lesson');
}

/** Duration and stream presence of an encoded audio file, read back with ffmpeg. */
async function probeAudio(file: string): Promise<{ ok: boolean; durationSeconds: number; detail: string }> {
  const probe = await runFfmpeg(['-hide_banner', '-i', file]);
  const stderr = probe.stderr || '';
  const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(stderr);
  const match = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSeconds = match
    ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    : 0;
  if (!hasAudio) return { ok: false, durationSeconds, detail: 'The generated file has no audio stream.' };
  if (durationSeconds <= 0) return { ok: false, durationSeconds, detail: 'The generated file has no duration.' };
  return { ok: true, durationSeconds, detail: '' };
}

/**
 * Speaks the current script and stores the take. Refuses an outdated script:
 * the words would no longer match what the storyboard shows.
 */
export async function generateNarrationFor(
  lessonId: string,
  options: NarrationOptions = {}
): Promise<NarrationResult> {
  const provider = String(options.provider || 'deepgram');
  if (provider !== 'deepgram') return { error: `Unknown voice provider “${provider}”.` };

  const status = voiceoverState(lessonId);
  if (!status.script) return { error: 'Generate the voice-over script first — there is no text to speak.' };
  if (status.outdated) {
    return { error: 'The voice-over script is out of date. Regenerate it before recording narration.' };
  }
  if (!deepgramConfigured()) {
    return { error: 'Deepgram is not configured yet — add DEEPGRAM_API_KEY to the app secrets.' };
  }

  const model = String(options.model || '').trim() || deepgramModel();
  const speech = await synthesizeSpeech({
    text: status.script.script,
    model,
    speed: options.speed,
    expressivity: options.expressivity
  });
  if (!speech.audio) return { error: speech.error || 'Deepgram returned no audio.' };

  const id = `track-${newId().slice(0, 8)}`;
  const file = path.join(NARRATION_DIR, `${lessonId}-${Date.now().toString(36)}.mp3`);
  writeFileSync(file, speech.audio);

  const probed = await probeAudio(file);
  if (!probed.ok) {
    return { error: `The generated narration was rejected: ${probed.detail}` };
  }
  const bytes = statSync(file).size;
  const stamp = nowIso();
  const artist = `Deepgram · ${model}`;

  db.prepare(
    `INSERT INTO audio_tracks (id, title, artist, source_page, source_url, license_type, license_evidence,
       commercial_use, social_use, attribution_required, attribution_text, restrictions, review_notes,
       reviewed_at, reviewed_by, kind, lesson_id, status, file_path, created_at, updated_at)
     VALUES (?, ?, ?, '', '', ?, ?, 1, 1, 0, '', ?, ?, ?, ?, 'narration', ?, 'approved', ?, ?, ?)`
  ).run(
    id,
    `${lessonTitle(lessonId)} — narration`.slice(0, 160),
    artist.slice(0, 160),
    'AI-generated voice',
    `Synthesized from this lesson's voice-over script via the Deepgram Speak API (${model}).`,
    `Generated take · ${probed.durationSeconds.toFixed(1)}s · ${Math.round(bytes / 1024)} KB`,
    model.slice(0, 60),
    stamp,
    'Deepgram TTS',
    lessonId,
    file,
    stamp,
    stamp
  );

  const row = db.prepare('SELECT * FROM audio_tracks WHERE id = ?').get(id) as AudioTrackRow;
  return { take: takeOf(row), durationSeconds: probed.durationSeconds };
}
