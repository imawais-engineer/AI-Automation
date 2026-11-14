/**
 * Content maintenance that runs once per boot.
 *
 * Two jobs live here:
 *
 * 1. Lesson naming. A demo short is a media asset, so a title such as
 *    "Stacks in 45 seconds" describes the video, not the lesson. Every learner
 *    surface reads the lesson's own title, so the record itself is corrected to
 *    the concept name once rather than patched at render time.
 * 2. Complexity prose. A lesson that only states "O(log n)" teaches a label;
 *    these authored sections explain the bound in context. They are added only
 *    to lessons whose text has not covered complexity yet, so an author's own
 *    section is never overwritten.
 *
 * Any render that finished before the asset table existed is still registered as
 * the lesson's silent video. Slides are no longer generated: the learner page is
 * a tutorial and the deck is not part of it.
 */

import { db, nowIso } from './db.ts';
import { registerRenderAsset } from './render/jobs.ts';

/** "Stacks in 45 seconds" / "Binary Search in 45 Seconds" — a media label. */
const MEDIA_TITLE = /\bin\s+\d+\s*(?:seconds?|secs?|s)\b/i;

const COMPLEXITY_SECTIONS: Record<string, { heading: string; body: string }> = {
  stacks: {
    heading: 'O(1) per operation, O(n) for the stack',
    body: [
      'Push, pop and peek each read or write a single slot — the top — so every one of them costs one step. The cost does not grow with the number of stored values, which is what O(1) means: stacking ten values costs the same per operation as stacking ten million.',
      'There is no best or worst case to distinguish. Every push does the same work, and every pop does the same work, on any input. A data structure with a genuinely varying case would have to search, and a stack never searches.',
      'Auxiliary space is O(1): two indexes over the array that already holds the values. The values themselves take O(n) memory for n stored items, and a dynamic array occasionally reallocates to grow — that one push is O(n), but averaged over the pushes it enables it is O(1) amortised.',
      'The bound is also the limit of the structure. Reaching a value that is not on top means popping until it appears, which is O(n) and destroys the values above it. When a lesson needs that lookup, a stack is the wrong tool and a hash set is usually the right one.'
    ].join('\n\n')
  },
  'binary-search': {
    heading: 'O(log n) time, O(1) space — but only on sorted input',
    body: [
      'Each iteration halves the candidate range: n, then n/2, then n/4. After k comparisons at most n/2ᵏ values are still in play, so the loop finishes in about log₂ n comparisons — 10 for a thousand sorted values, 20 for a million. That is the O(log n) time bound.',
      'The best case is a single comparison, O(1), when the target happens to sit at the first midpoint. Average and worst case are both O(log n); worst case is a target that is missing or at an end of the range, which uses the full ⌊log₂ n⌋ + 1 comparisons. The input that makes it slow is not a different kind of data, only a different position in the same range.',
      'Auxiliary space is O(1). The iterative version stores only low, high and mid, however large the array is. The recursive version keeps the same time bound but spends O(log n) call frames, so its space is O(log n).',
      'The sorted precondition is what buys the bound. On unsorted data one comparison says nothing about the half being discarded, so the guarantee disappears and the algorithm can miss the target entirely. Sorting first costs O(n log n) — worth it only when many searches will follow.'
    ].join('\n\n')
  }
};

/** Media-style titles become the concept's own name, which is the lesson name. */
function canonicaliseTitles(): number {
  const rows = db
    .prepare(
      `SELECT lessons.id, lessons.title, concepts.name AS concept_name
       FROM lessons JOIN concepts ON concepts.id = lessons.concept_id`
    )
    .all() as { id: string; title: string; concept_name: string }[];
  let corrected = 0;
  for (const row of rows) {
    if (!MEDIA_TITLE.test(String(row.title || ''))) continue;
    if (!String(row.concept_name || '').trim()) continue;
    db.prepare('UPDATE lessons SET title = ?, updated_at = ? WHERE id = ?').run(
      String(row.concept_name).trim(),
      nowIso(),
      row.id
    );
    corrected++;
  }
  return corrected;
}

/** Adds the authored complexity section to lessons whose text has none yet. */
function ensureComplexitySections(): number {
  let added = 0;
  for (const [slug, copy] of Object.entries(COMPLEXITY_SECTIONS)) {
    const lesson = db
      .prepare(
        `SELECT lessons.id FROM lessons JOIN concepts ON concepts.id = lessons.concept_id
         WHERE concepts.slug = ? AND lessons.content_status = 'published'
         ORDER BY lessons.created_at LIMIT 1`
      )
      .get(slug) as { id: string } | undefined;
    if (!lesson) continue;
    const existing = db
      .prepare("SELECT 1 FROM lesson_sections WHERE lesson_id = ? AND kind = 'complexity'")
      .get(lesson.id);
    if (existing) continue;
    const next = db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM lesson_sections WHERE lesson_id = ?')
      .get(lesson.id) as { position: number };
    db.prepare(
      'INSERT INTO lesson_sections (id, lesson_id, position, heading, body, kind) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      `sec-${lesson.id}-complexity`,
      lesson.id,
      next.position,
      copy.heading,
      copy.body,
      'complexity'
    );
    added++;
  }
  return added;
}

export function ensureDerivedContent(): { titles: number; sections: number; assets: number } {
  const titles = canonicaliseTitles();
  const sections = ensureComplexitySections();

  let assets = 0;
  const jobs = db
    .prepare(
      `SELECT render_jobs.id FROM render_jobs
       WHERE render_jobs.state = 'done'
         AND NOT EXISTS (SELECT 1 FROM video_assets WHERE video_assets.render_job_id = render_jobs.id)`
    )
    .all() as { id: string }[];
  for (const job of jobs) {
    if (registerRenderAsset(job.id)) assets++;
  }

  return { titles, sections, assets };
}
