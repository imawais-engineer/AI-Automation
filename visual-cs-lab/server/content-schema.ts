/**
 * The learning-content schema and its one-time migration.
 *
 * Everything here is additive: new tables, new nullable columns on `lessons`, and
 * a backfill that turns the library that existed before (concepts + demo lessons)
 * into the unified lesson model. No concept, lesson, storyboard or render record
 * is deleted or recreated, so the production pipeline keeps its data.
 *
 * This module takes the database as an argument instead of importing `db.ts`,
 * because `db.ts` calls it while it is still initialising.
 */

import type Database from 'better-sqlite3';

import { THEMES, nextThemeId, type ThemeId } from './themes.ts';

type LessonRow = {
  id: string;
  concept_id: string;
  title: string;
  slug: string | null;
  theme_id: string | null;
  content_status: string | null;
  summary: string | null;
  learning_objectives: string | null;
  prerequisites: string | null;
  topics: string | null;
  scenes: string;
};

type ConceptRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  summary: string;
  objectives: string;
  prerequisites: string;
  plain_explanation: string;
  technical_explanation: string;
  pseudocode: string;
  reference_language: string;
  reference_code: string;
  complexity_time: string;
  complexity_space: string;
  example_input: string;
  expected_output: string;
};

const DIFFICULTY: Record<string, 'beginner' | 'intermediate' | 'advanced'> = {
  'Data Structures': 'beginner',
  Algorithms: 'intermediate',
  'Complexity Analysis': 'intermediate'
};

export function slugifyName(value: string): string {
  return (
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70) || 'lesson'
  );
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((item) => item.name === column);
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  if (!columnExists(db, table, column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

/** Creates every table the learning platform and admin studio need. */
function createTables(db: Database.Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'learner',
  password_hash TEXT NOT NULL,
  default_language TEXT NOT NULL DEFAULT 'python',
  audio_mode TEXT NOT NULL DEFAULT 'silent',
  captions INTEGER NOT NULL DEFAULT 1,
  reduced_motion INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lesson_sections (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  heading TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'concept'
);

CREATE TABLE IF NOT EXISTS code_examples (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  expected_output TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL DEFAULT '',
  options TEXT NOT NULL DEFAULT '[]',
  answer_index INTEGER NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS slide_decks (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  lesson_version INTEGER NOT NULL DEFAULT 1,
  source_hash TEXT NOT NULL DEFAULT '',
  slide_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slides (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES slide_decks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'concept',
  scene_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS video_assets (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  lesson_version INTEGER NOT NULL DEFAULT 1,
  render_job_id TEXT,
  base_asset_id TEXT,
  theme_id TEXT NOT NULL DEFAULT 'theme_01',
  audio_mode TEXT NOT NULL DEFAULT 'silent',
  audio_track_id TEXT,
  resolution TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  file_path TEXT NOT NULL DEFAULT '',
  thumbnail_path TEXT NOT NULL DEFAULT '',
  bytes INTEGER NOT NULL DEFAULT 0,
  duration_seconds REAL NOT NULL DEFAULT 0,
  validation_ok INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audio_tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  source_page TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  license_type TEXT NOT NULL DEFAULT '',
  license_evidence TEXT NOT NULL DEFAULT '',
  commercial_use INTEGER NOT NULL DEFAULT 0,
  social_use INTEGER NOT NULL DEFAULT 0,
  attribution_required INTEGER NOT NULL DEFAULT 0,
  attribution_text TEXT NOT NULL DEFAULT '',
  restrictions TEXT NOT NULL DEFAULT '',
  review_notes TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  reviewed_by TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'music',
  lesson_id TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  file_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roadmaps (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '',
  outcomes TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roadmap_modules (
  id TEXT PRIMARY KEY,
  roadmap_id TEXT NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roadmap_items (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES roadmap_modules(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'started',
  last_mode TEXT NOT NULL DEFAULT 'video',
  last_section TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS review_records (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  lesson_version INTEGER NOT NULL DEFAULT 1,
  reviewer TEXT NOT NULL DEFAULT '',
  reviewer_id TEXT,
  checklist TEXT NOT NULL DEFAULT '[]',
  decision TEXT NOT NULL DEFAULT 'pending',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lessons_concept ON lessons(concept_id);
CREATE INDEX IF NOT EXISTS idx_sections_lesson ON lesson_sections(lesson_id, position);
CREATE INDEX IF NOT EXISTS idx_code_lesson ON code_examples(lesson_id, position);
CREATE INDEX IF NOT EXISTS idx_slides_deck ON slides(deck_id, position);
CREATE INDEX IF NOT EXISTS idx_assets_lesson ON video_assets(lesson_id, created_at);
CREATE INDEX IF NOT EXISTS idx_items_module ON roadmap_items(module_id, position);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);
}

/** New learning fields on the canonical `lessons` table (additive only). */
function extendLessons(db: Database.Database): void {
  ensureColumn(db, 'lessons', 'slug', 'TEXT');
  ensureColumn(db, 'lessons', 'summary', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'lessons', 'difficulty', "TEXT NOT NULL DEFAULT 'beginner'");
  ensureColumn(db, 'lessons', 'topics', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'lessons', 'estimated_minutes', 'INTEGER NOT NULL DEFAULT 8');
  ensureColumn(db, 'lessons', 'learning_objectives', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'lessons', 'prerequisites', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'lessons', 'content_status', "TEXT NOT NULL DEFAULT 'draft'");
  ensureColumn(db, 'lessons', 'version', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'lessons', 'published_at', 'TEXT');
  ensureColumn(db, 'lessons', 'theme_id', 'TEXT');
  ensureColumn(db, 'lessons', 'content_hash', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'render_jobs', 'theme_id', 'TEXT');
}

function jsonList(values: string[]): string {
  return JSON.stringify(values.filter((value) => String(value || '').trim().length > 0));
}

function splitObjectives(concept: ConceptRow): string[] {
  const raw = String(concept.objectives || '').trim();
  if (!raw) return [];
  // The library stores objectives as one sentence; the lesson shows them as a list.
  return raw
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

/**
 * Turns a concept into the canonical lesson record the first time the platform
 * runs with the learning schema. The text is the concept's existing explanation —
 * nothing is invented.
 */
function createLessonForConcept(db: Database.Database, concept: ConceptRow, now: string): string {
  let slug = slugifyName(concept.slug || concept.name);
  const taken = new Set((db.prepare('SELECT slug FROM lessons WHERE slug IS NOT NULL').all() as { slug: string }[]).map((row) => row.slug));
  if (taken.has(slug)) {
    let n = 2;
    while (taken.has(`${slug}-${n}`)) n++;
    slug = `${slug}-${n}`;
  }

  const counts = themeCounts(db);
  const theme = nextThemeId(counts);
  const id = `lesson-${concept.slug}`;
  db.prepare(
    `INSERT INTO lessons (id, concept_id, title, audience, objective, duration_seconds, hook, narration,
       on_screen_text, key_takeaway, cta, sources, review_status, scenes, slug, summary, difficulty,
       topics, estimated_minutes, learning_objectives, prerequisites, content_status, version,
       published_at, theme_id, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, '', ?, 'approved', '[]', ?, ?, ?, ?, ?, ?, ?, 'published', 1, ?, ?, ?, ?)`
  ).run(
    id,
    concept.id,
    concept.name,
    concept.objectives,
    15,
    concept.summary,
    concept.plain_explanation,
    concept.summary,
    concept.technical_explanation || concept.summary,
    'Cormen et al., Introduction to Algorithms; Sedgewick & Wayne, Algorithms.',
    slug,
    concept.summary,
    DIFFICULTY[concept.category] || 'beginner',
    jsonList([concept.category]),
    8,
    jsonList(splitObjectives(concept)),
    concept.prerequisites,
    now,
    theme,
    now,
    now
  );
  seedLessonBody(db, id, concept, now);
  return id;
}

/** The default structured content every lesson starts with, taken from its concept. */
function seedLessonBody(db: Database.Database, lessonId: string, concept: ConceptRow, now: string): void {
  const hasSections = db.prepare('SELECT COUNT(*) AS n FROM lesson_sections WHERE lesson_id = ?').get(lessonId) as {
    n: number;
  };
  if (hasSections.n === 0) {
    const insert = db.prepare(
      'INSERT INTO lesson_sections (id, lesson_id, position, heading, body, kind) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const rows: [string, string, string][] = [
      ['What it is', concept.plain_explanation, 'concept'],
      ['How it works', concept.technical_explanation, 'concept'],
      [
        'Worked example',
        [concept.example_input ? `Input: ${concept.example_input}` : '', concept.expected_output ? `Result: ${concept.expected_output}` : '', concept.pseudocode ? `\n${concept.pseudocode}` : '']
          .filter(Boolean)
          .join('\n'),
        'example'
      ]
    ].filter((row) => String(row[1] || '').trim().length > 0) as [string, string, string][];
    rows.forEach((row, index) => insert.run(`sec-${lessonId}-${index}`, lessonId, index, row[0], row[1], row[2]));
  }

  const hasCode = db.prepare('SELECT COUNT(*) AS n FROM code_examples WHERE lesson_id = ?').get(lessonId) as { n: number };
  if (hasCode.n === 0 && String(concept.reference_code || '').trim()) {
    db.prepare(
      `INSERT INTO code_examples (id, lesson_id, position, language, label, code, expected_output, notes)
       VALUES (?, ?, 0, ?, ?, ?, ?, '')`
    ).run(
      `code-${lessonId}-0`,
      lessonId,
      concept.reference_language || 'text',
      `${concept.name} reference implementation`,
      concept.reference_code,
      concept.expected_output
    );
  }

  const hasQuiz = db.prepare('SELECT COUNT(*) AS n FROM quiz_questions WHERE lesson_id = ?').get(lessonId) as {
    n: number;
  };
  if (hasQuiz.n === 0 && String(concept.summary || '').trim()) {
    db.prepare(
      `INSERT INTO quiz_questions (id, lesson_id, position, prompt, options, answer_index, explanation)
       VALUES (?, ?, 0, ?, ?, 0, ?)`
    ).run(
      `quiz-${lessonId}-0`,
      lessonId,
      `What does ${concept.name} let you do?`,
      JSON.stringify([concept.summary, 'It has no defined cost model.', 'It only works on unsorted input with no rules.']),
      concept.summary
    );
  }
  void now;
}

export function themeCounts(db: Database.Database): Partial<Record<ThemeId, number>> {
  const rows = db
    .prepare("SELECT theme_id, COUNT(*) AS n FROM lessons WHERE theme_id IS NOT NULL GROUP BY theme_id")
    .all() as { theme_id: string; n: number }[];
  const counts: Partial<Record<ThemeId, number>> = {};
  for (const row of rows) counts[row.theme_id as ThemeId] = row.n;
  return counts;
}

/** The roadmap that existed before publishing existed: the library, in order. */
function seedRoadmap(db: Database.Database, now: string): void {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM roadmaps').get() as { n: number };
  if (existing.n > 0) return;

  const lessons = db
    .prepare(
      `SELECT lessons.id, lessons.slug, concepts.category
       FROM lessons JOIN concepts ON concepts.id = lessons.concept_id
       WHERE lessons.content_status = 'published'
       ORDER BY concepts.rowid`
    )
    .all() as { id: string; slug: string | null; category: string }[];
  if (lessons.length === 0) return;

  const roadmapId = 'roadmap-dsa-foundations';
  db.prepare(
    `INSERT INTO roadmaps (id, slug, title, description, prerequisites, outcomes, published, position, created_at, updated_at)
     VALUES (?, 'dsa-foundations', ?, ?, ?, ?, 1, 0, ?, ?)`
  ).run(
    roadmapId,
    'DSA Foundations',
    'The working vocabulary: how data is stored, how algorithms move through it, and how to reason about cost. Work through it in order.',
    'Basic programming: variables, loops and functions.',
    'Read and trace the core data structures, then the algorithms that use them, then complexity analysis.',
    now,
    now
  );

  const byCategory = new Map<string, { id: string; slug: string | null }[]>();
  for (const lesson of lessons) {
    const list = byCategory.get(lesson.category) || [];
    list.push(lesson);
    byCategory.set(lesson.category, list);
  }

  const summaries: Record<string, string> = {
    'Data Structures': 'How values are arranged in memory, and what that costs.',
    Algorithms: 'Procedures that transform a structure into an answer.',
    'Complexity Analysis': 'The language for comparing one approach with another.'
  };

  let modulePosition = 0;
  for (const [category, items] of byCategory) {
    const moduleId = `module-${slugifyName(category)}`;
    db.prepare('INSERT INTO roadmap_modules (id, roadmap_id, title, summary, position) VALUES (?, ?, ?, ?, ?)').run(
      moduleId,
      roadmapId,
      category,
      summaries[category] || '',
      modulePosition++
    );
    items.forEach((item, index) => {
      db.prepare('INSERT INTO roadmap_items (id, module_id, lesson_id, position) VALUES (?, ?, ?, ?)').run(
        `item-${moduleId}-${index}`,
        moduleId,
        item.id,
        index
      );
    });
  }
}

/**
 * Runs the schema, then brings existing rows onto the learning model exactly once.
 * Every step is idempotent, so a restart or a newer branch cannot duplicate data.
 */
export function ensureContentSchema(db: Database.Database, now: string): void {
  createTables(db);
  extendLessons(db);

  // Existing lessons need a public slug and a theme before the unique index lands.
  const lessons = db.prepare('SELECT * FROM lessons').all() as LessonRow[];
  const used = new Set(lessons.map((lesson) => lesson.slug).filter(Boolean) as string[]);
  for (const lesson of lessons) {
    if (lesson.slug) continue;
    const concept = db.prepare('SELECT slug FROM concepts WHERE id = ?').get(lesson.concept_id) as
      | { slug: string }
      | undefined;
    let slug = slugifyName(concept?.slug || lesson.title);
    if (used.has(slug)) {
      let n = 2;
      while (used.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    used.add(slug);
    db.prepare('UPDATE lessons SET slug = ? WHERE id = ?').run(slug, lesson.id);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_lessons_slug ON lessons(slug)');

  // Fill the learning metadata for lessons created by the previous build.
  for (const lesson of db.prepare('SELECT * FROM lessons').all() as LessonRow[]) {
    const concept = db.prepare('SELECT * FROM concepts WHERE id = ?').get(lesson.concept_id) as ConceptRow | undefined;
    if (!concept) continue;
    const patch: Record<string, unknown> = {};
    if (!String(lesson.summary || '').trim()) patch.summary = concept.summary;
    if (lesson.content_status === null || lesson.content_status === undefined) {
      patch.content_status = lesson.theme_id ? 'published' : 'published';
    }
    if (!String(lesson.learning_objectives || '[]').replace(/[\[\]\s]/g, '')) {
      patch.learning_objectives = jsonList(splitObjectives(concept));
    }
    if (!String(lesson.prerequisites || '').trim()) patch.prerequisites = concept.prerequisites;
    if (!String(lesson.topics || '[]').replace(/[\[\]\s]/g, '')) patch.topics = jsonList([concept.category]);
    if (lesson.content_status === 'published' && !db.prepare('SELECT published_at FROM lessons WHERE id = ?').get(lesson.id)) {
      patch.published_at = now;
    }
    if (Object.keys(patch).length > 0) {
      const entries = Object.entries(patch);
      db.prepare(
        `UPDATE lessons SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
      ).run(...entries.map(([, value]) => value as never), now, lesson.id);
    }
    seedLessonBody(db, lesson.id, concept, now);
  }

  // Every concept in the library becomes a lesson, so the public site can link to
  // one page per concept instead of three disconnected content systems.
  const concepts = db.prepare('SELECT * FROM concepts WHERE archived = 0 ORDER BY rowid').all() as ConceptRow[];
  const withLesson = new Set(
    (db.prepare('SELECT DISTINCT concept_id FROM lessons').all() as { concept_id: string }[]).map((row) => row.concept_id)
  );
  for (const concept of concepts) {
    if (withLesson.has(concept.id)) continue;
    createLessonForConcept(db, concept, now);
  }

  // Themes for rows that predate the rotation: assigned once, in creation order.
  const untinted = db.prepare('SELECT id FROM lessons WHERE theme_id IS NULL ORDER BY created_at').all() as {
    id: string;
  }[];
  for (const row of untinted) {
    const theme = nextThemeId(themeCounts(db));
    db.prepare('UPDATE lessons SET theme_id = ? WHERE id = ?').run(theme, row.id);
  }

  // A stored theme that is no longer one of the four is moved to the first one.
  const known = new Set(THEMES.map((theme) => theme.id as string));
  for (const row of db.prepare('SELECT id, theme_id FROM lessons WHERE theme_id IS NOT NULL').all() as {
    id: string;
    theme_id: string;
  }[]) {
    if (!known.has(row.theme_id)) db.prepare('UPDATE lessons SET theme_id = ? WHERE id = ?').run('theme_01', row.id);
  }

  seedRoadmap(db, now);
}
