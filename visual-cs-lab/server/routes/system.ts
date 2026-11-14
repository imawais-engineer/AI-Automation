/**
 * Service metadata: the health probe the deployment waits on, and the Studio
 * dashboard overview that counts content and render state.
 */
import { Router } from 'express';

import { db, nowIso } from '../db.ts';
import { fontStatus } from '../render/typography.ts';
import { parseValidation } from '../render/quality.ts';
import { PRESETS } from '../render/jobs.ts';
import { requireAction } from '../auth.ts';

export const systemRouter = Router();

systemRouter.get('/health', (_req, res) => {
  const fonts = fontStatus();
  res.json({ ok: true, service: 'visual-cs-lab', fonts: fonts.ok, time: nowIso() });
});

systemRouter.get('/overview', requireAction('content:read'), (_req, res) => {
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const recentLessons = db
    .prepare(
      `SELECT lessons.id, lessons.title, lessons.review_status, lessons.updated_at, concepts.name AS concept
       FROM lessons JOIN concepts ON concepts.id = lessons.concept_id
       ORDER BY lessons.updated_at DESC LIMIT 5`
    )
    .all();
  const recentJobs = db
    .prepare(
      `SELECT render_jobs.id, render_jobs.state, render_jobs.preset, render_jobs.progress,
              render_jobs.created_at, lessons.title
       FROM render_jobs JOIN lessons ON lessons.id = render_jobs.lesson_id
       ORDER BY render_jobs.created_at DESC LIMIT 5`
    )
    .all();

  res.json({
    concepts: one('SELECT COUNT(*) AS n FROM concepts WHERE archived = 0'),
    lessons: one('SELECT COUNT(*) AS n FROM lessons'),
    lessonsInProgress: one("SELECT COUNT(*) AS n FROM lessons WHERE review_status IN ('draft','in_review')"),
    rendersDone: one("SELECT COUNT(*) AS n FROM render_jobs WHERE state = 'done'"),
    rendersFailed: one("SELECT COUNT(*) AS n FROM render_jobs WHERE state = 'error'"),
    rendersActive: one("SELECT COUNT(*) AS n FROM render_jobs WHERE state IN ('queued','rendering','encoding','validating')"),
    awaitingReview: one("SELECT COUNT(*) AS n FROM lessons WHERE review_status = 'in_review'"),
    // Ready to publish means: approved by a human AND a render that passed every
    // automated quality check. A finished job alone is not enough.
    readyToPublish: new Set(
      (
        db
          .prepare(
            `SELECT r.lesson_id, r.validation FROM render_jobs r
             JOIN lessons l ON l.id = r.lesson_id
             WHERE l.review_status = 'approved' AND r.state = 'done'`
          )
          .all() as { lesson_id: string; validation: string | null }[]
      )
        .filter((row) => parseValidation(row.validation)?.ok)
        .map((row) => row.lesson_id)
    ).size,
    qualityCheckedRenders: (
      db.prepare("SELECT validation FROM render_jobs WHERE state = 'done'").all() as { validation: string | null }[]
    ).filter((row) => parseValidation(row.validation)?.ok).length,
    published: one("SELECT COUNT(*) AS n FROM publish_jobs WHERE status = 'published'"),
    recentLessons,
    recentJobs,
    environment: {
      renderer: 'in-process worker: Skia frames → ffmpeg H.264, validated on the encoded file',
      presets: Object.entries(PRESETS).map(([key, value]) => ({
        key,
        label: value.label,
        width: value.width,
        height: value.height,
        fps: value.fps
      })),
      persistent: Boolean(process.env.DATA_DIR)
    }
  });
});
