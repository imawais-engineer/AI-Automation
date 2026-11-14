/**
 * Automatic video thumbnails.
 *
 * A thumbnail is a real frame of the video, not a placeholder: it is drawn by the
 * same `drawMoment()` the encoder uses, at the moment inside the opening beat when
 * the title, the accent rule and the presenter credit have all settled. The moment
 * is derived from the opening's own animation timings (`openingCaptureMs`), so a
 * change to the opening timing moves the capture point with it.
 *
 * The file is stored separately from the MP4, so a thumbnail can be replaced or
 * regenerated without touching the render. An automatic thumbnail is regenerated
 * whenever the storyboard (which carries the opening title) or the branding
 * changes; a manual replacement is left alone until it is explicitly regenerated.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

import { db, nowIso, readBrand } from '../db.ts';
import { brandingFrom, brandingHash, openingCaptureMs } from '../branding.ts';
import { lessonThemeId, motionForLesson, themedBrand } from '../motion.ts';
import { drawMoment, type MotionPlan } from '../anim/index.ts';
import { OPENING_SETTLED_MS } from '../anim/stage.ts';

const MEDIA_DIR = process.env.MEDIA_DIR || '/tmp/visual-cs-lab/media';
const THUMB_DIR = path.join(MEDIA_DIR, 'thumbnails');
mkdirSync(THUMB_DIR, { recursive: true });

/** The card format every Shorts platform uses. */
export const THUMB_WIDTH = 1080;
export const THUMB_HEIGHT = 1920;

export type ThumbnailRow = {
  lesson_id: string;
  source: 'auto' | 'manual';
  file: string;
  captured_at_ms: number;
  storyboard_hash: string;
  branding_hash: string;
  width: number;
  height: number;
  created_at: string;
  updated_at: string;
};

export function thumbnailRow(lessonId: string): ThumbnailRow | null {
  return (db.prepare('SELECT * FROM thumbnails WHERE lesson_id = ?').get(lessonId) as ThumbnailRow) || null;
}

/** The moment inside the opening that becomes the thumbnail, or null without an opening. */
export function thumbnailMoment(motion: MotionPlan): number | null {
  const beat = motion.beats.find((item) => item.key === 'open');
  if (!beat) return null;
  return openingCaptureMs(beat.startMs, beat.endMs, OPENING_SETTLED_MS);
}

function digest(value: unknown, length = 12): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

function fileFor(lessonId: string, storyHash: string, brandHash: string): string {
  return path.join(THUMB_DIR, `${lessonId}-${storyHash.slice(0, 6)}${brandHash.slice(0, 6)}.png`);
}

/** The JPEG twin of a thumbnail: same frame, saved at quality 95 for uploads. */
export function jpegFor(pngFile: string): string {
  return pngFile.replace(/\.png$/i, '.jpg');
}

/** Quality of the JPEG twin, at the ceiling the export spec asks for. */
export const THUMB_JPEG_QUALITY = 95;

function store(row: ThumbnailRow): ThumbnailRow {
  db.prepare(
    `INSERT INTO thumbnails (lesson_id, source, file, captured_at_ms, storyboard_hash, branding_hash, width, height, created_at, updated_at)
     VALUES (@lesson_id, @source, @file, @captured_at_ms, @storyboard_hash, @branding_hash, @width, @height, @created_at, @updated_at)
     ON CONFLICT(lesson_id) DO UPDATE SET
       source = excluded.source,
       file = excluded.file,
       captured_at_ms = excluded.captured_at_ms,
       storyboard_hash = excluded.storyboard_hash,
       branding_hash = excluded.branding_hash,
       width = excluded.width,
       height = excluded.height,
       updated_at = excluded.updated_at`
  ).run(row);
  return row;
}

/** Drops the file for a replaced thumbnail, so the folder does not grow without bound. */
function discard(previous: ThumbnailRow | null, next: ThumbnailRow | null): void {
  if (!previous?.file || previous.file === next?.file) return;
  try {
    if (existsSync(previous.file)) unlinkSync(previous.file);
    const jpg = jpegFor(previous.file);
    if (existsSync(jpg)) unlinkSync(jpg);
  } catch {
    /* a leftover file is harmless */
  }
}

export type ThumbnailResult = {
  file?: string;
  row?: ThumbnailRow;
  error?: string;
  regenerated?: boolean;
};

/**
 * Returns the current thumbnail, generating it from the opening frame when it is
 * missing or stale. `force` rebuilds it from the video, replacing a manual image.
 */
export function ensureThumbnail(lessonId: string, opts: { force?: boolean } = {}): ThumbnailResult {
  const existing = thumbnailRow(lessonId);
  const themeId = lessonThemeId(lessonId);
  const branding = brandingFrom(themedBrand(readBrand(), themeId));
  const built = motionForLesson(lessonId);
  if (!built) return { error: 'This video has no animation plan yet, so it has no thumbnail.' };

  const moment = thumbnailMoment(built.motion);
  if (moment === null) {
    return { error: 'The storyboard has no opening beat — rebuild it to get an automatic thumbnail.' };
  }

  const storyHash = digest(built.scenes);
  // The theme is part of the poster's identity: a theme override must recut it.
  const brandDigest = digest({ branding: brandingHash(branding), theme: themeId });

  if (!opts.force && existing?.source === 'manual' && existing.file && existsSync(existing.file)) {
    return { file: existing.file, row: existing, regenerated: false };
  }
  const fresh =
    !opts.force &&
    existing?.source === 'auto' &&
    existing.storyboard_hash === storyHash &&
    existing.branding_hash === brandDigest &&
    Boolean(existing.file) &&
    existsSync(existing.file);
  if (fresh) return { file: existing!.file, row: existing!, regenerated: false };

  if (!branding.autoThumbnail && !existing?.file) {
    return { error: 'Automatic thumbnails are turned off in the Style settings.' };
  }

  const canvas = createCanvas(THUMB_WIDTH, THUMB_HEIGHT);
  const ctx = canvas.getContext('2d');
  drawMoment(ctx, built.motion, moment, { width: THUMB_WIDTH, height: THUMB_HEIGHT });

  const file = fileFor(lessonId, storyHash, brandDigest);
  writeFileSync(file, canvas.encodeSync('png'));
  // The upload copy: same frame, 1080×1920, JPEG at quality 95.
  writeFileSync(jpegFor(file), canvas.encodeSync('jpeg', THUMB_JPEG_QUALITY));
  const stamp = nowIso();
  const row = store({
    lesson_id: lessonId,
    source: 'auto',
    file,
    captured_at_ms: Math.round(moment),
    storyboard_hash: storyHash,
    branding_hash: brandDigest,
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    created_at: existing?.created_at || stamp,
    updated_at: stamp
  });
  discard(existing, row);
  return { file, row, regenerated: true };
}

/**
 * Replaces the thumbnail with an image the author chose. The video is untouched:
 * only the poster image changes, and it survives later renders until it is
 * explicitly regenerated.
 */
export async function saveManualThumbnail(
  lessonId: string,
  dataUrl: string
): Promise<ThumbnailResult> {
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || '').trim());
  if (!match) return { error: 'Send the image as a base64 PNG, JPEG or WebP data URL.' };
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength === 0) return { error: 'That image file is empty.' };
  if (buffer.byteLength > 4 * 1024 * 1024) return { error: 'Keep the thumbnail image under 4 MB.' };

  let image;
  try {
    image = await loadImage(buffer);
  } catch {
    return { error: 'That file could not be read as an image.' };
  }

  const canvas = createCanvas(THUMB_WIDTH, THUMB_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  // Cover the card without distorting it: fill the frame, crop the overflow.
  const scale = Math.max(THUMB_WIDTH / image.width, THUMB_HEIGHT / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (THUMB_WIDTH - w) / 2, (THUMB_HEIGHT - h) / 2, w, h);

  const existing = thumbnailRow(lessonId);
  const file = path.join(THUMB_DIR, `${lessonId}-manual-${Date.now().toString(36)}.png`);
  writeFileSync(file, canvas.encodeSync('png'));
  const stamp = nowIso();
  const row = store({
    lesson_id: lessonId,
    source: 'manual',
    file,
    captured_at_ms: existing?.captured_at_ms || 0,
    storyboard_hash: existing?.storyboard_hash || '',
    branding_hash: existing?.branding_hash || '',
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    created_at: existing?.created_at || stamp,
    updated_at: stamp
  });
  discard(existing, row);
  return { file, row, regenerated: false };
}

/** Status the lesson payload reports: which image the library will show. */
export function thumbnailStatus(lessonId: string): {
  source: 'auto' | 'manual' | 'none';
  capturedAtMs: number;
  updatedAt: string | null;
} {
  const row = thumbnailRow(lessonId);
  return {
    source: row ? (row.source === 'manual' ? 'manual' : 'auto') : 'none',
    capturedAtMs: row?.captured_at_ms ?? 0,
    updatedAt: row?.updated_at ?? null
  };
}
