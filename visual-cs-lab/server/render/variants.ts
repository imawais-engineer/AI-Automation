/**
 * Audio variants of a finished silent export.
 *
 * A music or voice-over version is derived from the validated silent MP4 by
 * remuxing the same video stream with an added audio track, so the visuals of
 * every variant are byte-identical to the export that passed the quality checks.
 *
 * Nothing is assumed about licensing: a music track must be an approved library
 * entry with a licence on record, and a narration file must exist. A variant is
 * only marked ready once the encoded file actually contains an audio stream.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { db, newId, nowIso } from '../db.ts';
import type { VideoAssetRow } from '../content.ts';
import { parseMediaInfo } from './quality.ts';
import { runFfmpeg } from './jobs.ts';

const MEDIA_DIR = process.env.MEDIA_DIR || '/tmp/visual-cs-lab/media';
const VARIANT_DIR = path.join(MEDIA_DIR, 'variants');
mkdirSync(VARIANT_DIR, { recursive: true });

export type AudioTrackRow = {
  id: string;
  title: string;
  artist: string;
  source_page: string;
  source_url: string;
  license_type: string;
  license_evidence: string;
  commercial_use: number;
  social_use: number;
  attribution_required: number;
  attribution_text: string;
  restrictions: string;
  review_notes: string;
  reviewed_at: string | null;
  reviewed_by: string;
  kind: string;
  lesson_id: string | null;
  status: string;
  file_path: string;
  created_at: string;
  updated_at: string;
};

export type VariantResult = { asset?: VideoAssetRow; error?: string };

function audioTrack(id: string): AudioTrackRow | undefined {
  return db.prepare('SELECT * FROM audio_tracks WHERE id = ?').get(id) as AudioTrackRow | undefined;
}

/** The validated silent master a variant is built from. */
function baseAsset(lessonId: string, assetId?: string): VideoAssetRow | undefined {
  if (assetId) {
    const row = db.prepare('SELECT * FROM video_assets WHERE id = ? AND lesson_id = ?').get(assetId, lessonId) as
      | VideoAssetRow
      | undefined;
    if (row) return row;
  }
  return db
    .prepare(
      "SELECT * FROM video_assets WHERE lesson_id = ? AND audio_mode = 'silent' AND status = 'ready' AND validation_ok = 1 ORDER BY created_at DESC LIMIT 1"
    )
    .get(lessonId) as VideoAssetRow | undefined;
}

export function approvedTracks(): AudioTrackRow[] {
  return db
    .prepare("SELECT * FROM audio_tracks WHERE status = 'approved' AND kind = 'music' ORDER BY title")
    .all() as AudioTrackRow[];
}

/**
 * Builds a music or voice-over variant. `narrationTrackId` points at a narration
 * audio entry for this lesson; `musicTrackId` must be an approved library track.
 */
export async function createAudioVariant(input: {
  lessonId: string;
  audioMode: 'music' | 'voiceover';
  assetId?: string;
  musicTrackId?: string;
  narrationTrackId?: string;
  mixMusicUnderNarration?: boolean;
}): Promise<VariantResult> {
  const base = baseAsset(input.lessonId, input.assetId);
  if (!base) return { error: 'Render and validate a silent export first — variants are built from it.' };
  if (!existsSync(base.file_path)) return { error: 'The silent master file is missing on disk. Re-render it.' };
  if (!base.validation_ok) return { error: 'The silent master has not passed the output checks.' };

  const lesson = db.prepare('SELECT version FROM lessons WHERE id = ?').get(input.lessonId) as
    | { version: number }
    | undefined;
  const version = Number(lesson?.version || 1);

  const inputs: string[] = ['-i', base.file_path];
  const filters: string[] = [];
  let mixLabel = '';
  let musicUsed: string | null = null;
  let narrationUsed: string | null = null;

  if (input.audioMode === 'music' || (input.audioMode === 'voiceover' && input.mixMusicUnderNarration)) {
    const music = audioTrack(String(input.musicTrackId || ''));
    if (!music) return { error: 'Choose an approved music track from the audio library.' };
    if (music.status !== 'approved') {
      return { error: `“${music.title}” is not approved. A track with an ambiguous licence cannot be used.` };
    }
    if (!music.commercial_use || !music.social_use) {
      return { error: `“${music.title}” is not cleared for commercial and social use.` };
    }
    if (!existsSync(music.file_path)) {
      return { error: `The audio file for “${music.title}” is missing on disk.` };
    }
    inputs.push('-i', music.file_path);
    const index = inputs.filter((item) => item === '-i').length - 1;
    // Quiet bed: it must never compete with the on-screen explanation.
    filters.push(`[${index}:a]volume=0.18[music]`);
    mixLabel = '[music]';
    musicUsed = music.id;
  }

  if (input.audioMode === 'voiceover') {
    const narration = audioTrack(String(input.narrationTrackId || ''));
    if (!narration) return { error: 'Attach the narration audio for this lesson first.' };
    if (!existsSync(narration.file_path)) return { error: 'The narration audio file is missing on disk.' };
    inputs.push('-i', narration.file_path);
    const index = inputs.filter((item) => item === '-i').length - 1;
    if (mixLabel) {
      filters.push(`[${index}:a]volume=1.0[narr]`);
      filters.push(`[narr][music]amix=inputs=2:duration=first:dropout_transition=0[aout]`);
    } else {
      filters.push(`[${index}:a]volume=1.0[aout]`);
    }
    narrationUsed = narration.id;
  } else {
    filters.push(`${mixLabel}anull[aout]`);
  }

  const id = `asset-${input.lessonId}-${Date.now().toString(36)}`;
  const output = path.join(VARIANT_DIR, `${id}.mp4`);
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '0:v:0',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    output
  ];

  const encoded = await runFfmpeg(args);
  if (encoded.code !== 0) {
    return { error: `Mixing failed: ${encoded.stderr.trim().slice(-240) || 'ffmpeg exited non-zero'}` };
  }

  const probe = await runFfmpeg(['-hide_banner', '-i', output]);
  const media = parseMediaInfo(probe.stderr);
  const stats = statSync(output);
  const hasAudio = Boolean(media?.hasAudio);
  const status = hasAudio && stats.size > 0 ? 'ready' : 'failed';
  const stamp = nowIso();

  db.prepare(
    `INSERT INTO video_assets (id, lesson_id, lesson_version, render_job_id, base_asset_id, theme_id, audio_mode,
       audio_track_id, resolution, width, height, file_path, thumbnail_path, bytes, duration_seconds,
       validation_ok, status, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.lessonId,
    version,
    base.render_job_id,
    base.id,
    base.theme_id,
    input.audioMode,
    narrationUsed || musicUsed,
    base.resolution,
    base.width,
    base.height,
    output,
    base.thumbnail_path,
    stats.size,
    media?.durationSeconds || base.duration_seconds,
    hasAudio && base.validation_ok ? 1 : 0,
    status,
    hasAudio ? null : 'The encoded file has no audio stream.',
    stamp,
    stamp
  );

  const asset = db.prepare('SELECT * FROM video_assets WHERE id = ?').get(id) as VideoAssetRow;
  return status === 'ready'
    ? { asset }
    : { asset, error: 'The encoded variant has no audio stream, so it was not marked ready.' };
}

export function newTrackId(): string {
  return `track-${newId().slice(0, 8)}`;
}
