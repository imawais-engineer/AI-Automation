import { existsSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';

import { db } from '../db.ts';

/** How many renders each lesson keeps: the current one and the one before it. */
export const KEEP_PER_LESSON = 2;

const ACTIVE_STATES = ['queued', 'rendering', 'encoding', 'validating'];

export type CleanupEntry = {
  id: string;
  lesson_id: string;
  lesson_title: string;
  preset: string;
  state: string;
  created_at: string;
  bytes: number;
  file: string | null;
  /** Why a job is being kept, when it is not simply one of the newest two. */
  reason?: 'newest' | 'active' | 'in-use';
};

export type CleanupLesson = {
  lesson_id: string;
  lesson_title: string;
  remove: number;
  keep: number;
};

export type CleanupPlan = {
  keepPerLesson: number;
  remove: CleanupEntry[];
  keep: CleanupEntry[];
  lessons: CleanupLesson[];
  files: number;
  bytes: number;
};

type JobRow = {
  id: string;
  lesson_id: string;
  lesson_title: string | null;
  preset: string;
  state: string;
  output_path: string | null;
  created_at: string;
};

function fileSize(file: string | null): number {
  if (!file) return 0;
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Files the learner pages actually play: the newest validated asset per lesson
 * and audio mode. An older render that still serves one of those is kept, so the
 * cleanup can never break a published video.
 */
function filesInUse(): Set<string> {
  const rows = db
    .prepare(
      `SELECT lesson_id, audio_mode, file_path FROM video_assets
       WHERE status = 'ready' AND validation_ok = 1 AND file_path != ''
       ORDER BY created_at DESC`
    )
    .all() as { lesson_id: string; audio_mode: string; file_path: string }[];
  const seen = new Set<string>();
  const inUse = new Set<string>();
  for (const row of rows) {
    const key = `${row.lesson_id}:${row.audio_mode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    inUse.add(row.file_path);
  }
  return inUse;
}

function entry(row: JobRow): CleanupEntry {
  const file = row.output_path && existsSync(row.output_path) ? row.output_path : null;
  return {
    id: row.id,
    lesson_id: row.lesson_id,
    lesson_title: row.lesson_title || row.lesson_id,
    preset: row.preset,
    state: row.state,
    created_at: row.created_at,
    bytes: fileSize(file),
    file
  };
}

/**
 * What a cleanup would keep and delete, without touching anything: per lesson the
 * newest two renders stay, plus anything still rendering and any file a learner
 * can still play.
 */
export function cleanupPlan(): CleanupPlan {
  const rows = db
    .prepare(
      `SELECT render_jobs.id, render_jobs.lesson_id, render_jobs.preset, render_jobs.state,
              render_jobs.output_path, render_jobs.created_at, lessons.title AS lesson_title
       FROM render_jobs LEFT JOIN lessons ON lessons.id = render_jobs.lesson_id
       ORDER BY render_jobs.created_at DESC, render_jobs.rowid DESC`
    )
    .all() as JobRow[];

  const inUse = filesInUse();
  const newest: Record<string, number> = {};
  const lessonOrder: string[] = [];
  const keep: CleanupEntry[] = [];
  const remove: CleanupEntry[] = [];

  for (const row of rows) {
    const seen = newest[row.lesson_id] || 0;
    if (seen === 0) lessonOrder.push(row.lesson_id);
    newest[row.lesson_id] = seen + 1;
    const item = entry(row);
    if (seen < KEEP_PER_LESSON) {
      item.reason = 'newest';
      keep.push(item);
    } else if (ACTIVE_STATES.includes(row.state)) {
      item.reason = 'active';
      keep.push(item);
    } else if (row.output_path && inUse.has(row.output_path)) {
      item.reason = 'in-use';
      keep.push(item);
    } else {
      remove.push(item);
    }
  }

  const lessons: CleanupLesson[] = lessonOrder.map((lessonId) => {
    const kept = keep.filter((item) => item.lesson_id === lessonId);
    const dropped = remove.filter((item) => item.lesson_id === lessonId);
    return {
      lesson_id: lessonId,
      lesson_title: kept[0]?.lesson_title || dropped[0]?.lesson_title || lessonId,
      remove: dropped.length,
      keep: kept.length
    };
  });

  return {
    keepPerLesson: KEEP_PER_LESSON,
    remove,
    keep,
    // Only lessons that actually lose a render are listed as affected.
    lessons: lessons.filter((lesson) => lesson.remove > 0),
    files: remove.filter((item) => item.file).length,
    bytes: remove.reduce((sum, item) => sum + item.bytes, 0)
  };
}

export type CleanupResult = {
  removed: { id: string; lesson_title: string; bytes: number }[];
  failed: { id: string; lesson_title: string; error: string }[];
  freedBytes: number;
  kept: number;
};

/**
 * Deletes the planned renders and their MP4s. A job whose file cannot be deleted
 * keeps its record, so the report never claims space that is still on disk.
 */
export async function runCleanup(ids?: string[]): Promise<CleanupResult> {
  const plan = cleanupPlan();
  const wanted = ids && ids.length > 0 ? new Set(ids) : null;
  const targets = wanted ? plan.remove.filter((item) => wanted.has(item.id)) : plan.remove;

  const result: CleanupResult = { removed: [], failed: [], freedBytes: 0, kept: plan.keep.length };

  for (const item of targets) {
    try {
      if (item.file) await unlink(item.file);
      db.transaction(() => {
        // The assets built from this render have no file left to play.
        db.prepare('DELETE FROM video_assets WHERE render_job_id = ?').run(item.id);
        db.prepare('DELETE FROM render_jobs WHERE id = ?').run(item.id);
      })();
      result.removed.push({ id: item.id, lesson_title: item.lesson_title, bytes: item.bytes });
      result.freedBytes += item.bytes;
    } catch (error) {
      result.failed.push({ id: item.id, lesson_title: item.lesson_title, error: (error as Error).message });
    }
  }

  return result;
}
