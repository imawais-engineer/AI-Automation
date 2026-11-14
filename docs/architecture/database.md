# Database

SQLite through `better-sqlite3`, one file at `DATA_DIR/lab.db`. The schema is created and
migrated idempotently in `server/db.ts`; there is no ORM and no migration directory — the
migration code is TypeScript that runs at boot.

Content and media are **data, not source**: the database and `MEDIA_DIR` sit outside the
repository and are never reset by a code change.

## Tables (23)

### Identity
| Table | Holds |
| --- | --- |
| `users` | Account, hashed password (scrypt), role, preferences |
| `sessions` | Session tokens (HttpOnly cookie value → user) |

### Curriculum
| Table | Holds |
| --- | --- |
| `concepts` | The CS topic: name, category, explanations, pseudocode, complexity, animation config, related slugs, status, archived |
| `lessons` | One video/tutorial per concept: objective, hook, narration, takeaway, review status, `scenes` (storyboard JSON), `animation_input` |
| `lesson_sections` | The tutorial body — sections in a documented order with type and content |
| `code_examples` | Implementation samples with their real output |
| `quiz_questions` | Practice questions and answers |
| `roadmaps` | A named path (`DSA Foundations`) with description and ordering |
| `roadmap_modules` | Modules inside a roadmap |
| `roadmap_items` | Lessons attached to a module, with position |
| `slide_decks`, `slides` | Slide decks (84 slides across 11 decks) derived from the content |

### Learner state
| Table | Holds |
| --- | --- |
| `lesson_progress` | Per-user lesson status and completion |
| `bookmarks` | Saved lessons per user |

### Production
| Table | Holds |
| --- | --- |
| `render_jobs` | Queue state, profile, progress, log, `output_path`, `validation` report |
| `video_assets` | Registered MP4s with width/height/duration/bytes, so the public site can serve them |
| `thumbnails` | Cached poster per lesson, auto or manual |
| `voiceovers` | Generated script and per-scene segments |
| `audio_tracks` | Narration takes, provider/model, approval status |
| `video_captions` | Saved per-platform title and description, unique per `(render_id, platform)` |
| `publish_jobs` | Publishing queue: platform, copy, status, schedule, published URL |
| `review_records` | Review decisions with reviewer and note |

### Configuration
| Table | Holds |
| --- | --- |
| `brand` | Single row: palette, fonts, watermark, narration timings, defaults |

## Relationships that matter

- `lessons.concept_id → concepts.id` — a lesson always belongs to a concept; a missing concept
  makes a lesson unrenderable (reported, never silently skipped).
- `render_jobs.lesson_id → lessons.id` — renders are per lesson; a storyboard rebuild does not
  delete finished videos.
- `video_assets.lesson_id → lessons.id` — the public site reads only assets, so a render that
  never finished is never published.
- `video_captions` is keyed by render, not lesson: a re-render can get fresh copy.
- Foreign keys are enforced (`PRAGMA foreign_keys = ON`).

## Changing the schema

1. Add an idempotent statement in `server/db.ts` (create, or add-column guarded by a
   `PRAGMA table_info` check) — existing rows must survive.
2. Keep it reversible where practical: additive columns with defaults, never a rename in the
   same release.
3. Back up first: `cp "$DATA_DIR/lab.db" /tmp/lab-backup-$(date +%s).db`.
4. Test against the copy: `DATA_DIR=/tmp/db-copy npm run dev`, then check the affected route
   against real rows.
5. Never reseed or reset content to make a migration pass.

## Inspecting data

```bash
sqlite3 "$DATA_DIR/lab.db" ".tables"
sqlite3 "$DATA_DIR/lab.db" "select slug, content_status from lessons order by slug;"
```
