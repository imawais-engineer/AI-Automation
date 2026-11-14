/**
 * The Create flow: which algorithms can be animated, and the single call that
 * verifies an input with the trusted implementation, stores a new lesson and
 * builds its beat windows.
 */
import { Router } from 'express';

import { db, newId, nowIso, readBrand, readBranding } from '../db.ts';
import { trace } from '../algorithms/stack.ts';
import { traceBinarySearch } from '../algorithms/binary-search.ts';
import {
  buildScenes,
  lessonIssues,
  safeJson,
  type ConceptInput,
  type LessonInput,
  type Scene
} from '../scenes.ts';
import { PRESETS } from '../render/jobs.ts';
import { requireAction } from '../auth.ts';
import { conceptBySlug, requireLesson } from './shared.ts';

export const createRouter = Router();

const ALGORITHMS = [
  {
    slug: 'stacks',
    kind: 'stack',
    name: 'Stack',
    blurb: 'PUSH, PEEK and POP on one vertical tower — last in, first out.',
    defaultInput: {
      ops: [
        { op: 'push', value: 10 },
        { op: 'push', value: 20 },
        { op: 'push', value: 30 },
        { op: 'top' },
        { op: 'pop' },
        { op: 'pop' },
        { op: 'push', value: 40 }
      ]
    }
  },
  {
    slug: 'binary-search',
    kind: 'binary-search',
    name: 'Binary Search',
    blurb: 'LOW, HIGH and MID move across a sorted array until the target is found.',
    defaultInput: { array: [1, 3, 5, 7, 9], target: 7 }
  }
];

/** What the Create screen offers: verified algorithms and their default inputs. */
createRouter.get('/algorithms', requireAction('content:read'), (_req, res) => {
  const brand = readBrand();
  const algorithms = ALGORITHMS.map((algorithm) => {
    const concept = conceptBySlug(algorithm.slug);
    return {
      ...algorithm,
      available: Boolean(concept),
      complexity: concept ? `${concept.complexity_time} time · ${concept.complexity_space} space` : '',
      summary: concept?.summary || algorithm.blurb
    };
  });
  res.json({
    algorithms,
    defaultSeconds: Number(brand.default_duration) || 45,
    profiles: Object.entries(PRESETS).map(([key, value]) => ({
      key,
      label: value.label,
      width: value.width,
      height: value.height
    }))
  });
});

/**
 * One call for the Create screen: verify the input with the trusted
 * implementation, store the animation input on a new lesson, build its beat
 * windows and report anything that would block a render.
 */
createRouter.post('/create', requireAction('content:write'), (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const algorithm = String(body.algorithm || 'stacks');
  const spec = ALGORITHMS.find((item) => item.slug === algorithm || item.kind === algorithm);
  if (!spec) return res.status(400).json({ error: 'Choose an algorithm to animate.' });
  const concept = conceptBySlug(spec.slug);
  if (!concept) return res.status(404).json({ error: 'That algorithm has no concept record yet.' });

  let animationInput: Record<string, unknown>;
  let summary = '';

  if (spec.kind === 'stack') {
    const raw = Array.isArray(body.ops) ? (body.ops as Record<string, unknown>[]) : [];
    const ops = raw.slice(0, 10).map((item) => {
      const op = String(item.op || '').toLowerCase();
      if (op === 'push') return { op: 'push' as const, value: Number(item.value) };
      if (op === 'pop') return { op: 'pop' as const };
      return { op: 'top' as const };
    });
    if (ops.length === 0) return res.status(400).json({ error: 'Add at least one PUSH, PEEK or POP.' });

    const run = trace(ops);
    if (run.errors.length > 0) return res.status(400).json({ error: run.errors.join(' ') });
    const last = run.events[run.events.length - 1];
    if (!last) return res.status(400).json({ error: 'That input produced no verified stack state.' });
    const firstPop = run.events.find((event) => event.op === 'pop' && event.returned !== null);
    const expect: Record<string, unknown> = { finalStack: last.items, top: last.top };
    if (firstPop) expect.popReturns = firstPop.returned;
    animationInput = { ops, expect };
    summary = `${run.events.length} verified operations · final stack [${last.items.join(', ')}] · TOP ${String(last.top)}`;
  } else {
    const array = (Array.isArray(body.array) ? (body.array as unknown[]) : spec.defaultInput.array ?? [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    const target = Number(body.target ?? spec.defaultInput.target);
    if (array.length < 2) return res.status(400).json({ error: 'Add at least two numbers to the array.' });
    if (array.length > 8) {
      return res.status(400).json({ error: 'Up to eight values fit the vertical frame — trim the array.' });
    }
    if (!Number.isFinite(target)) return res.status(400).json({ error: 'Add a numeric target value.' });
    for (let i = 1; i < array.length; i++) {
      if (array[i - 1] > array[i]) {
        return res.status(400).json({ error: 'Binary search needs a sorted array — sort the values ascending.' });
      }
    }

    const traceRun = traceBinarySearch(array, target);
    if (traceRun.errors.length > 0) return res.status(400).json({ error: traceRun.errors.join(' ') });
    animationInput = {
      kind: 'binary-search',
      array,
      target,
      expect: {
        foundIndex: traceRun.foundIndex >= 0 ? traceRun.foundIndex : null,
        steps: traceRun.steps.length
      }
    };
    summary =
      traceRun.foundIndex >= 0
        ? `Target ${target} found at index ${traceRun.foundIndex} after ${traceRun.steps.length} comparison${traceRun.steps.length === 1 ? '' : 's'}`
        : `Target ${target} is not in the array — ${traceRun.steps.length} comparison${traceRun.steps.length === 1 ? '' : 's'} exhausted the range`;
  }

  const id = newId();
  const stamp = nowIso();
  // The video is as long as its beat script and verified trace need — the length
  // is measured from the content, never requested as a fixed slot.
  const draft: LessonInput = {
    id,
    concept_id: concept.id,
    title: '',
    audience: '',
    objective: concept.objectives,
    duration_seconds: 0,
    hook: String(body.hook || concept.summary),
    narration: concept.plain_explanation,
    on_screen_text: concept.example_input,
    key_takeaway: concept.expected_output || concept.summary,
    cta: "Understand the algorithm. Don't just memorize it.",
    sources: '',
    scenes: '[]'
  };
  const scenes = buildScenes(draft, concept, readBranding());
  const seconds = Math.round(scenes.reduce((sum, scene) => sum + scene.durationMs, 0) / 1000);

  db.prepare(
    `INSERT INTO lessons (id, concept_id, title, audience, objective, duration_seconds, hook,
       narration, on_screen_text, key_takeaway, cta, sources, review_status, scenes, animation_input,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'draft', ?, ?, ?, ?)`
  ).run(
    id,
    concept.id,
    String(body.title || `${concept.name} · ${seconds}s`),
    '',
    concept.objectives,
    seconds,
    draft.hook,
    draft.narration,
    draft.on_screen_text,
    draft.key_takeaway,
    draft.cta,
    JSON.stringify(scenes),
    JSON.stringify(animationInput),
    stamp,
    stamp
  );

  const stored = requireLesson(id)!;
  const issues = lessonIssues(stored, concept, readBranding());
  res.status(201).json({
    lesson: { ...stored, scenes: safeJson<Scene[]>(stored.scenes, []) },
    concept,
    durationSeconds: seconds,
    summary,
    issues,
    renderable: issues.length === 0
  });
});

export type { ConceptInput };
