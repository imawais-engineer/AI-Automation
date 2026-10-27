import assert from 'node:assert/strict';
import test from 'node:test';

import { lessonPipeline, type RenderRef } from './pipeline.ts';
import { buildScenes, lessonIssues, type ConceptInput, type LessonInput } from './scenes.ts';

const CONCEPT: ConceptInput = {
  id: 'concept-binary',
  slug: 'binary-search',
  name: 'Binary Search',
  objectives: 'Trace low/high/mid pointers and justify O(log n).',
  summary: 'Halve a sorted range until the target is found.',
  plain_explanation: 'Open the middle of a sorted list, then keep only the half that can still contain the answer.',
  technical_explanation: 'Maintains a candidate range and discards half after each comparison.',
  pseudocode: 'while low <= high:\n  mid = (low + high) // 2',
  reference_language: 'typescript',
  reference_code: 'while (low <= high) { const mid = Math.floor((low + high) / 2); }',
  complexity_time: 'O(log n)',
  complexity_space: 'O(1)',
  example_input: '[1, 3, 5, 7, 9], target 7',
  expected_output: 'Index 3',
  animation_config: JSON.stringify({
    kind: 'binary-search',
    array: [1, 3, 5, 7, 9],
    target: 7,
    expect: { foundIndex: 3, steps: 2 }
  })
};

const LESSON: LessonInput = {
  id: 'lesson-binary',
  concept_id: 'concept-binary',
  title: 'Binary Search in 20 seconds',
  audience: 'Junior developers',
  objective: 'Trace low, high and mid over a sorted array.',
  duration_seconds: 20,
  hook: 'Searching a sorted array? Check the middle first.',
  narration: 'Check the middle, discard half, repeat.',
  on_screen_text: 'Sorted array. Check the middle. Eliminate half. Repeat.',
  key_takeaway: 'Each comparison halves the range: O(log n) time, O(1) extra space.',
  cta: 'Try a target that is not in the array.',
  sources: 'CLRS ch. 2.3',
  review_status: 'draft',
  scenes: '[]'
};

function withScenes(scenes: unknown): LessonInput {
  return { ...LESSON, scenes: JSON.stringify(scenes) };
}

const validation = JSON.stringify({
  ok: true,
  media: {
    container: 'mov',
    codec: 'h264',
    pixelFormat: 'yuv420p',
    width: 1080,
    height: 1920,
    durationSeconds: 20,
    hasAudio: false
  },
  checks: [],
  humanReview: ['legibility'],
  samples: [],
  validatedAt: '2026-10-27T00:00:00.000Z'
});

function render(overrides: Partial<RenderRef> = {}): RenderRef {
  return {
    id: 'job-1',
    preset: 'hd',
    state: 'done',
    width: 1080,
    height: 1920,
    fps: 30,
    bytes: 640000,
    duration_seconds: 20,
    validation,
    finished_at: '2026-10-27T00:00:00.000Z',
    ...overrides
  };
}

const scenes = buildScenes(LESSON, CONCEPT);
const issues = lessonIssues(withScenes(scenes), CONCEPT);

test('a lesson without a storyboard stops at trace verified', () => {
  const pipeline = lessonPipeline({ lesson: LESSON, concept: CONCEPT, scenes: [], issues: lessonIssues(LESSON, CONCEPT), renders: [] });
  assert.equal(pipeline.stage, 'trace_verified');
  assert.equal(pipeline.readyToPublish, false);
});

test('a built storyboard is ready but not rendered', () => {
  const pipeline = lessonPipeline({ lesson: withScenes(scenes), concept: CONCEPT, scenes, issues, renders: [] });
  assert.equal(pipeline.stage, 'storyboard_ready');
  assert.equal(pipeline.steps.find((step) => step.key === 'rendered')?.status, 'current');
  assert.equal(pipeline.readyToPublish, false);
});

test('a finished render without validation counts as rendered only', () => {
  const pipeline = lessonPipeline({
    lesson: withScenes(scenes),
    concept: CONCEPT,
    scenes,
    issues,
    renders: [render({ validation: null })]
  });
  assert.equal(pipeline.stage, 'rendered');
  assert.equal(pipeline.readyToPublish, false);
});

test('a quality-checked render is ready once a human approves it', () => {
  const checked = lessonPipeline({
    lesson: withScenes(scenes),
    concept: CONCEPT,
    scenes,
    issues,
    renders: [render()]
  });
  assert.equal(checked.stage, 'quality_checked');
  assert.equal(checked.readyToPublish, false, 'approval is still required');

  const approved = lessonPipeline({
    lesson: { ...withScenes(scenes), review_status: 'approved' },
    concept: CONCEPT,
    scenes,
    issues,
    renders: [render()]
  });
  assert.equal(approved.stage, 'ready_to_publish');
  assert.equal(approved.readyToPublish, true);
  assert.ok(approved.checklist.every((item) => item.kind === 'manual' || item.ok === true));
});

test('a render that failed its checks never marks the lesson ready', () => {
  const failed = JSON.stringify({ ok: false, media: null, checks: [{ id: 'codec', label: 'H.264 video', ok: false, detail: 'vp9' }], humanReview: [], samples: [], validatedAt: '' });
  const pipeline = lessonPipeline({
    lesson: { ...withScenes(scenes), review_status: 'approved' },
    concept: CONCEPT,
    scenes,
    issues,
    renders: [render({ validation: failed })]
  });
  assert.equal(pipeline.readyToPublish, false);
  assert.equal(pipeline.stage, 'rendered');
});

test('an unverified concept stays in draft', () => {
  const pipeline = lessonPipeline({
    lesson: withScenes(scenes),
    concept: { ...CONCEPT, animation_config: '{}' },
    scenes,
    issues: ['no animation configuration'],
    renders: [render()]
  });
  assert.equal(pipeline.stage, 'draft');
  // Verifying the trace is the step that is waiting on the author.
  assert.equal(pipeline.steps.find((step) => step.key === 'trace_verified')?.status, 'current');
  assert.equal(pipeline.steps.find((step) => step.key === 'rendered')?.status, 'blocked');
});
