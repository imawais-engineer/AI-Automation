/**
 * The unified lesson content layer.
 *
 * One lesson record is canonical. Its written material, code examples and
 * practice questions hang off the same lesson id, and its video assets are
 * derived from render jobs — so the tutorial the learner reads and the
 * demonstration they watch can never describe different content.
 *
 * Derived artefacts record the lesson version and source hash they were built
 * from, which is what makes staleness detectable instead of silent.
 */

import { createHash } from 'node:crypto';

import { db, nowIso } from './db.ts';
import { safeJson, type Scene } from './scenes.ts';
import { themeById } from './themes.ts';
import { voiceoverState } from './voiceover-store.ts';

export type SectionRow = {
  id: string;
  lesson_id: string;
  position: number;
  heading: string;
  body: string;
  kind: string;
};

export type CodeRow = {
  id: string;
  lesson_id: string;
  position: number;
  language: string;
  label: string;
  code: string;
  expected_output: string;
  notes: string;
};

export type QuizRow = {
  id: string;
  lesson_id: string;
  position: number;
  prompt: string;
  options: string;
  answer_index: number;
  explanation: string;
};

export type SlideDeckRow = {
  id: string;
  lesson_id: string;
  lesson_version: number;
  source_hash: string;
  slide_count: number;
  created_at: string;
  updated_at: string;
};

export type SlideRow = {
  id: string;
  deck_id: string;
  position: number;
  title: string;
  body: string;
  notes: string;
  kind: string;
  scene_id: string;
};

export type VideoAssetRow = {
  id: string;
  lesson_id: string;
  lesson_version: number;
  render_job_id: string | null;
  base_asset_id: string | null;
  theme_id: string;
  audio_mode: 'silent' | 'music' | 'voiceover';
  audio_track_id: string | null;
  resolution: string;
  width: number;
  height: number;
  file_path: string;
  thumbnail_path: string;
  bytes: number;
  duration_seconds: number;
  validation_ok: number;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

/** Anything the learner sees as text, hashed together to detect drift. */
export function lessonContentHash(lessonId: string): string {
  const lesson = db.prepare(
    'SELECT title, summary, objective, learning_objectives, prerequisites, hook, key_takeaway, scenes, concept_id FROM lessons WHERE id = ?'
  ).get(lessonId) as Record<string, unknown> | undefined;
  if (!lesson) return '';
  const concept = db.prepare(
    'SELECT plain_explanation, technical_explanation, pseudocode, reference_code, complexity_time, complexity_space, example_input, expected_output FROM concepts WHERE id = ?'
  ).get(lesson.concept_id) as Record<string, unknown> | undefined;
  const sections = db.prepare('SELECT heading, body FROM lesson_sections WHERE lesson_id = ? ORDER BY position').all(lessonId);
  const code = db.prepare('SELECT language, code, expected_output FROM code_examples WHERE lesson_id = ? ORDER BY position').all(lessonId);
  const quiz = db.prepare('SELECT prompt, options, answer_index FROM quiz_questions WHERE lesson_id = ? ORDER BY position').all(lessonId);
  return createHash('sha1')
    .update(JSON.stringify({ lesson, concept, sections, code, quiz }))
    .digest('hex');
}

export function lessonById(id: string): Record<string, unknown> | null {
  return (db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as Record<string, unknown>) || null;
}

export function lessonBySlug(slug: string): Record<string, unknown> | null {
  return (db.prepare('SELECT * FROM lessons WHERE slug = ?').get(slug) as Record<string, unknown>) || null;
}

export function sectionsOf(lessonId: string): SectionRow[] {
  return db.prepare('SELECT * FROM lesson_sections WHERE lesson_id = ? ORDER BY position').all(lessonId) as SectionRow[];
}

export function codeOf(lessonId: string): CodeRow[] {
  return db.prepare('SELECT * FROM code_examples WHERE lesson_id = ? ORDER BY position').all(lessonId) as CodeRow[];
}

export function quizOf(lessonId: string): QuizRow[] {
  return db.prepare('SELECT * FROM quiz_questions WHERE lesson_id = ? ORDER BY position').all(lessonId) as QuizRow[];
}

export function deckOf(lessonId: string): SlideDeckRow | null {
  return (
    (db
      .prepare('SELECT * FROM slide_decks WHERE lesson_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(lessonId) as SlideDeckRow) || null
  );
}

export function slidesOf(deckId: string): SlideRow[] {
  return db.prepare('SELECT * FROM slides WHERE deck_id = ? ORDER BY position').all(deckId) as SlideRow[];
}

export function assetsOf(lessonId: string): VideoAssetRow[] {
  return db
    .prepare('SELECT * FROM video_assets WHERE lesson_id = ? ORDER BY created_at DESC')
    .all(lessonId) as VideoAssetRow[];
}

/** Bumps the lesson version and records the hash of what changed. */
export function bumpLessonVersion(lessonId: string): number {
  const row = db.prepare('SELECT version FROM lessons WHERE id = ?').get(lessonId) as { version: number } | undefined;
  const next = Number(row?.version || 1) + 1;
  db.prepare('UPDATE lessons SET version = ?, content_hash = ?, updated_at = ? WHERE id = ?').run(
    next,
    lessonContentHash(lessonId),
    nowIso(),
    lessonId
  );
  return next;
}

/**
 * Slides are derived from the actual storyboard: one slide per verified beat,
 * carrying the beat's own title, caption and presenter notes. The complexity
 * slide closes the deck from the concept's own analysis.
 */
export function generateSlideDeck(lessonId: string): { deck?: SlideDeckRow; error?: string } {
  const lesson = lessonById(lessonId);
  if (!lesson) return { error: 'Lesson not found.' };
  const concept = db.prepare('SELECT * FROM concepts WHERE id = ?').get(lesson.concept_id as string) as
    | Record<string, unknown>
    | undefined;
  const scenes = safeJson<Scene[]>(String(lesson.scenes || '[]'), []);

  const slides: Omit<SlideRow, 'deck_id'>[] = [];
  const version = Number(lesson.version || 1);

  slides.push({
    id: `slide-${lessonId}-title`,
    position: 0,
    title: String(lesson.title),
    body: String(lesson.summary || lesson.hook || ''),
    notes: `Estimated ${Number(lesson.estimated_minutes || 8)} min · ${String(lesson.difficulty || 'beginner')}`,
    kind: 'title',
    scene_id: ''
  });

  scenes.forEach((scene, index) => {
    slides.push({
      id: `slide-${lessonId}-${index + 1}`,
      position: index + 1,
      title: scene.title || scene.type,
      body: scene.caption || scene.subtitle || '',
      notes: scene.subtitle || '',
      kind: scene.type,
      scene_id: scene.id
    });
  });

  // The storyboard has its own complexity beat; only add a concept slide when it
  // does not, so a deck never ends with two "Complexity" slides.
  const hasComplexityScene = scenes.some((scene) => scene.type === 'complexity');
  if (!hasComplexityScene && concept && (concept.complexity_time || concept.complexity_space)) {
    slides.push({
      id: `slide-${lessonId}-complexity`,
      position: slides.length,
      title: 'Complexity',
      body: `Time ${String(concept.complexity_time || '—')} · Auxiliary space ${String(concept.complexity_space || '—')}`,
      notes: 'Cost grows with the input, not with how fast the machine is.',
      kind: 'complexity',
      scene_id: ''
    });
  }

  if (slides.length < 2) {
    return { error: 'Build the storyboard first — a deck is derived from the verified beats.' };
  }

  const sourceHash = createHash('sha1').update(JSON.stringify(scenes)).digest('hex');
  const existing = deckOf(lessonId);
  const stamp = nowIso();
  const deckId = existing?.id || `deck-${lessonId}`;

  db.transaction(() => {
    if (existing) {
      db.prepare(
        'UPDATE slide_decks SET lesson_version = ?, source_hash = ?, slide_count = ?, updated_at = ? WHERE id = ?'
      ).run(version, sourceHash, slides.length, stamp, deckId);
      db.prepare('DELETE FROM slides WHERE deck_id = ?').run(deckId);
    } else {
      db.prepare(
        'INSERT INTO slide_decks (id, lesson_id, lesson_version, source_hash, slide_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(deckId, lessonId, version, sourceHash, slides.length, stamp, stamp);
    }
    const insert = db.prepare(
      'INSERT INTO slides (id, deck_id, position, title, body, notes, kind, scene_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const slide of slides) {
      insert.run(slide.id, deckId, slide.position, slide.title, slide.body, slide.notes, slide.kind, slide.scene_id);
    }
  })();

  return { deck: deckOf(lessonId) as SlideDeckRow };
}

export type DerivedState = {
  deck: { present: boolean; stale: boolean; updatedAt: string | null; slides: number };
  videos: { present: boolean; stale: boolean; ready: number };
  narration: { present: boolean; stale: boolean };
};

/** Which derived artefacts belong to an older lesson version. */
export function derivedState(lessonId: string): DerivedState {
  const lesson = lessonById(lessonId);
  const version = Number(lesson?.version || 1);
  const deck = deckOf(lessonId);
  const scenes = safeJson<Scene[]>(String(lesson?.scenes || '[]'), []);
  const storyHash = createHash('sha1').update(JSON.stringify(scenes)).digest('hex');
  const assets = assetsOf(lessonId);
  const ready = assets.filter((asset) => asset.status === 'ready' && asset.validation_ok);
  // The script fingerprint covers the plan, copy and trace, so compare against the
  // generator's own hash instead of the storyboard hash used by slides and video.
  const voice = voiceoverState(lessonId);
  return {
    deck: {
      present: Boolean(deck),
      stale: Boolean(deck) && (deck!.lesson_version !== version || deck!.source_hash !== storyHash),
      updatedAt: deck?.updated_at ?? null,
      slides: deck?.slide_count ?? 0
    },
    videos: {
      present: assets.length > 0,
      stale: ready.length > 0 ? ready.every((asset) => asset.lesson_version !== version) : assets.length > 0,
      ready: ready.length
    },
    narration: {
      present: voice.present,
      stale: voice.present && voice.outdated
    }
  };
}

export type Check = { key: string; label: string; ok: boolean; detail: string };

/** What a lesson still needs before it can be published. */
export function publishChecks(lessonId: string, opts: { waiveVideo?: boolean } = {}): Check[] {
  const lesson = lessonById(lessonId);
  if (!lesson) return [{ key: 'lesson', label: 'Lesson exists', ok: false, detail: 'Lesson not found.' }];
  const concepts = db.prepare('SELECT * FROM concepts WHERE id = ?').get(lesson.concept_id as string) as
    | Record<string, unknown>
    | undefined;
  const sections = sectionsOf(lessonId);
  const code = codeOf(lessonId);
  const quiz = quizOf(lessonId);
  const objectives = safeJson<string[]>(String(lesson.learning_objectives || '[]'), []);
  const review = db
    .prepare("SELECT * FROM review_records WHERE lesson_id = ? AND decision = 'approved' ORDER BY created_at DESC LIMIT 1")
    .get(lessonId) as { lesson_version: number; reviewer: string } | undefined;
  const readyVideo = assetsOf(lessonId).filter((asset) => asset.status === 'ready' && asset.validation_ok);

  return [
    { key: 'title', label: 'Title and summary', ok: Boolean(String(lesson.title || '').trim() && String(lesson.summary || '').trim()), detail: 'Learners need a title and a one-line summary.' },
    { key: 'objectives', label: 'Learning objectives', ok: objectives.length > 0, detail: 'Add at least one concrete outcome.' },
    { key: 'explanation', label: 'Written explanation', ok: sections.length > 0, detail: 'The lesson needs at least one explanation section.' },
    { key: 'example', label: 'Worked example or code', ok: sections.some((section) => section.kind === 'example') || code.length > 0, detail: 'Add an example section or a code example.' },
    { key: 'complexity', label: 'Complexity analysis', ok: Boolean(String(concepts?.complexity_time || '').trim() || String(concepts?.complexity_space || '').trim()), detail: 'State the time or space cost on the concept.' },
    { key: 'quiz', label: 'Knowledge check', ok: quiz.length > 0, detail: 'Add at least one practice question.' },
    {
      key: 'video',
      label: opts.waiveVideo ? 'Video (waived)' : 'Validated video',
      ok: opts.waiveVideo || readyVideo.length > 0,
      detail: opts.waiveVideo ? 'The reviewer waived the video for this publication.' : 'Render and validate at least one video asset.'
    },
    {
      key: 'review',
      label: 'Human review',
      ok: Boolean(review) && Number(review?.lesson_version) === Number(lesson.version || 1),
      detail: review ? 'The approved review is for an older lesson version — review again.' : 'A reviewer has not approved this version.'
    }
  ];
}

export type PublishResult = { error?: string; lesson?: Record<string, unknown>; checks?: Check[] };

/**
 * Publishing records the exact lesson version that was approved. Content,
 * render quality and approval stay separate states: a failed render never
 * touches the lesson text, and a good encode never approves teaching content.
 */
export function publishLesson(
  lessonId: string,
  opts: { reviewerId: string; reviewerName: string; waiveVideo?: boolean; notes?: string }
): PublishResult {
  const lesson = lessonById(lessonId);
  if (!lesson) return { error: 'Lesson not found.' };
  const checks = publishChecks(lessonId, { waiveVideo: opts.waiveVideo });
  const failing = checks.filter((check) => !check.ok);
  if (failing.length > 0) {
    return { error: `Publication is blocked: ${failing.map((check) => check.label).join(', ')}.`, checks };
  }
  const stamp = nowIso();
  db.prepare(
    `UPDATE lessons SET content_status = 'published', published_at = ?, content_hash = ?, updated_at = ? WHERE id = ?`
  ).run(stamp, lessonContentHash(lessonId), stamp, lessonId);
  db.prepare(
    `INSERT INTO review_records (id, lesson_id, lesson_version, reviewer, reviewer_id, checklist, decision, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)`
  ).run(
    `review-${lessonId}-${Date.now().toString(36)}`,
    lessonId,
    Number(lesson.version || 1),
    opts.reviewerName,
    opts.reviewerId,
    JSON.stringify(checks),
    String(opts.notes || ''),
    stamp
  );
  return { lesson: lessonById(lessonId) || undefined, checks };
}

export type RoadmapPosition = {
  roadmapSlug: string;
  roadmapTitle: string;
  moduleTitle: string;
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
  index: number;
  total: number;
};

/** The lesson's place in its published roadmap, for previous/next navigation. */
export function roadmapPositionFor(lessonId: string): RoadmapPosition | null {
  const row = db
    .prepare(
      `SELECT roadmaps.slug AS roadmap_slug, roadmaps.title AS roadmap_title, roadmap_modules.id AS module_id,
              roadmap_modules.title AS module_title
       FROM roadmap_items
       JOIN roadmap_modules ON roadmap_modules.id = roadmap_items.module_id
       JOIN roadmaps ON roadmaps.id = roadmap_modules.roadmap_id
       WHERE roadmap_items.lesson_id = ? AND roadmaps.published = 1
       ORDER BY roadmaps.position LIMIT 1`
    )
    .get(lessonId) as
    | { roadmap_slug: string; roadmap_title: string; module_id: string; module_title: string }
    | undefined;
  if (!row) return null;

  const ordered = db
    .prepare(
      `SELECT lessons.id, lessons.slug, lessons.title
       FROM roadmap_items
       JOIN roadmap_modules ON roadmap_modules.id = roadmap_items.module_id
       JOIN lessons ON lessons.id = roadmap_items.lesson_id
       JOIN roadmaps ON roadmaps.id = roadmap_modules.roadmap_id
       WHERE roadmaps.slug = ?
       ORDER BY roadmap_modules.position, roadmap_items.position`
    )
    .all(row.roadmap_slug) as { id: string; slug: string; title: string }[];
  const index = ordered.findIndex((item) => item.id === lessonId);
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
  return {
    roadmapSlug: row.roadmap_slug,
    roadmapTitle: row.roadmap_title,
    moduleTitle: row.module_title,
    prev: prev ? { slug: prev.slug, title: prev.title } : null,
    next: next ? { slug: next.slug, title: next.title } : null,
    index,
    total: ordered.length
  };
}

/** The learner's default audio mode, then whatever variant actually exists. */
export function preferredAsset(lessonId: string, audioMode: string): VideoAssetRow | null {
  const ready = assetsOf(lessonId).filter((asset) => asset.status === 'ready' && asset.validation_ok);
  if (ready.length === 0) return null;
  const order = [audioMode, 'silent', 'music', 'voiceover'];
  for (const mode of order) {
    const match = ready.find((asset) => asset.audio_mode === mode);
    if (match) return match;
  }
  return ready[0];
}

export function themeFor(lessonId: string): string {
  const row = db.prepare('SELECT theme_id FROM lessons WHERE id = ?').get(lessonId) as { theme_id: string } | undefined;
  return themeById(row?.theme_id).id;
}
