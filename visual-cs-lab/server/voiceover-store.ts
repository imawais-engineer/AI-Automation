/**
 * Persistence for voice-over scripts.
 *
 * A script is stored per video, fingerprinted against the plan it was generated
 * from. When the lesson, storyboard or trace changes, the fingerprint no longer
 * matches and the script is reported as outdated until it is regenerated — the
 * video does not have to be re-rendered for that.
 */

import { db, nowIso } from './db.ts';
import { motionForLesson } from './motion.ts';
import {
  applyVoiceoverEdits,
  checkVoiceover,
  generateVoiceover,
  voiceoverSourceHash,
  type VoiceoverCheck,
  type VoiceoverScript,
  type VoiceoverSegment,
  type VoiceoverStatus
} from './voiceover.ts';

type VoiceoverRow = {
  lesson_id: string;
  title: string;
  duration_seconds: number;
  segments: string;
  script: string;
  source_hash: string;
  created_at: string;
  updated_at: string;
};

/** Rebuilds the script from its stored parts; `null` when the row is unreadable. */
function scriptFromRow(row: VoiceoverRow | null): VoiceoverScript | null {
  if (!row) return null;
  try {
    const segments = JSON.parse(row.segments || '[]') as VoiceoverSegment[];
    if (!Array.isArray(segments)) return null;
    return {
      title: row.title,
      durationSeconds: Number(row.duration_seconds) || 0,
      segments,
      script: row.script
    };
  } catch {
    return null;
  }
}

export function readVoiceoverRow(lessonId: string): VoiceoverRow | null {
  return (db.prepare('SELECT * FROM voiceovers WHERE lesson_id = ?').get(lessonId) as VoiceoverRow) || null;
}

function missingCheck(detail: string): VoiceoverCheck {
  return { id: 'voiceover_missing', label: 'Voice-over script exists', ok: false, detail };
}

/** The script as stored, with the plan's current freshness verdict. */
export function voiceoverState(lessonId: string): VoiceoverStatus {
  const built = motionForLesson(lessonId);
  const row = readVoiceoverRow(lessonId);

  if (!built) {
    return {
      present: Boolean(row),
      outdated: false,
      checks: [missingCheck('This lesson has no animation plan yet, so no script can be generated.')],
      ok: false,
      script: scriptFromRow(row)
    };
  }

  const sourceHash = voiceoverSourceHash(built.motion, built.lesson, built.concept);

  if (!row) {
    return {
      present: false,
      outdated: false,
      checks: [missingCheck('Generate the voice-over script for this video.')],
      ok: false,
      script: null
    };
  }

  const script = scriptFromRow(row);
  if (!script) {
    return {
      present: false,
      outdated: true,
      checks: [missingCheck('The stored script could not be read — regenerate it.')],
      ok: false,
      script: null
    };
  }

  const outdated = row.source_hash !== sourceHash;
  const { checks, ok } = checkVoiceover({ script, plan: built.motion });
  const all: VoiceoverCheck[] = outdated
    ? [
        ...checks,
        {
          id: 'voiceover_outdated',
          label: 'Voice-over script is current',
          ok: false,
          detail: 'The lesson or storyboard changed after this script was written — regenerate it.'
        }
      ]
    : checks;

  return {
    present: true,
    outdated,
    checks: all,
    ok: ok && !outdated,
    script
  };
}

/** Generates (or regenerates) the script from the current plan. */
export function generateVoiceoverFor(lessonId: string): { status?: VoiceoverStatus; error?: string } {
  const built = motionForLesson(lessonId);
  if (!built) return { error: 'Build the storyboard first — there is no verified plan to narrate.' };

  const { script, sourceHash } = generateVoiceover({
    plan: built.motion,
    lesson: built.lesson,
    concept: built.concept
  });
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO voiceovers (lesson_id, title, duration_seconds, segments, script, source_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(lesson_id) DO UPDATE SET
       title = excluded.title,
       duration_seconds = excluded.duration_seconds,
       segments = excluded.segments,
       script = excluded.script,
       source_hash = excluded.source_hash,
       updated_at = excluded.updated_at`
  ).run(
    lessonId,
    script.title,
    script.durationSeconds,
    JSON.stringify(script.segments),
    script.script,
    sourceHash,
    stamp,
    stamp
  );
  return { status: voiceoverState(lessonId) };
}

/**
 * Saves wording edits. Editing does not touch the video: the same timestamps and
 * the same verified facts stay, only the human words change.
 */
export function saveVoiceoverEdits(
  lessonId: string,
  edits: { id: string; text: string }[]
): { status?: VoiceoverStatus; error?: string } {
  const row = readVoiceoverRow(lessonId);
  if (!row) return { error: 'Generate the voice-over script first.' };
  const script = scriptFromRow(row);
  if (!script) return { error: 'The stored script could not be read — regenerate it.' };

  const next: VoiceoverScript = applyVoiceoverEdits(script, edits);
  db.prepare('UPDATE voiceovers SET segments = ?, script = ?, updated_at = ? WHERE lesson_id = ?').run(
    JSON.stringify(next.segments),
    next.script,
    nowIso(),
    lessonId
  );
  return { status: voiceoverState(lessonId) };
}

export function deleteVoiceover(lessonId: string): void {
  db.prepare('DELETE FROM voiceovers WHERE lesson_id = ?').run(lessonId);
}
