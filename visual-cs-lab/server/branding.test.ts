/**
 * The personal brand and the opening/closing pipeline.
 *
 * These tests draw real frames: the plan is inspected with the layout recorder,
 * so text containment, collisions and the on-screen branding are verified on the
 * actual geometry the renderer produces — not on a description of it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRAND_DEFAULTS,
  brandingFrom,
  openingCaptureMs,
  shortTitle
} from './branding.ts';
import { buildScenes, type ConceptInput, type LessonInput } from './scenes.ts';
import { planFor, type PlanBrand } from './anim/index.ts';
import { inspectPlan, recordLayout, verifyBranding } from './anim/inspect.ts';
import { OPENING_SETTLED_MS } from './anim/stage.ts';

const BRAND: PlanBrand = {
  name: 'Muhammad Awais',
  accent: '#22d3ee',
  background: '#0b1220',
  panel: '#141c2e',
  ink: '#e6edf7',
  watermark: 'Muhammad Awais',
  outro: '',
  presenter: BRAND_DEFAULTS.presenter,
  role: BRAND_DEFAULTS.role,
  closing: BRAND_DEFAULTS.closing,
  cta: BRAND_DEFAULTS.cta,
  handle: BRAND_DEFAULTS.handle,
  openingStyle: 'cinematic'
};

const STACK_CONCEPT: ConceptInput = {
  id: 'concept-stack',
  slug: 'stacks',
  name: 'Stacks',
  objectives: 'Explain LIFO.',
  summary: 'A LIFO container: the last value pushed is the first value popped.',
  plain_explanation: 'A stack is a pile where you can only touch the top.',
  technical_explanation: 'Array-backed stack with O(1) push and pop.',
  pseudocode: 'PUSH(s, x): s.items[top] = x',
  reference_language: 'typescript',
  reference_code: 'class Stack {}',
  complexity_time: 'O(1) push, pop and peek',
  complexity_space: 'O(n) for n stored elements',
  example_input: 'PUSH(10), PUSH(20), PUSH(30), PEEK(), POP(), POP(), PUSH(40)',
  expected_output: 'The final PUSH leaves [10, 40].',
  animation_config: JSON.stringify({
    ops: [
      { op: 'push', value: 10 },
      { op: 'push', value: 20 },
      { op: 'push', value: 30 },
      { op: 'top' },
      { op: 'pop' },
      { op: 'pop' },
      { op: 'push', value: 40 }
    ],
    expect: { finalStack: [10, 40], top: 40, popReturns: 30 }
  })
};

const STACK_LESSON: LessonInput = {
  id: 'lesson-stack',
  concept_id: 'concept-stack',
  title: 'Stacks in 45 Seconds',
  audience: 'Beginner software engineering students',
  objective: 'Watch PUSH, PEEK and POP change one stack and see why LIFO holds.',
  duration_seconds: 45,
  hook: 'Three values go in. Which one comes out first?',
  narration: 'Push 10, 20 and 30.',
  on_screen_text: 'LIFO: the last value in is the first value out.',
  key_takeaway: 'LIFO: the last value pushed is the first value popped.',
  cta: 'POP on an empty stack? That is underflow.',
  sources: 'CLRS §10.1',
  scenes: '[]'
};

const BINARY_CONCEPT: ConceptInput = {
  ...STACK_CONCEPT,
  id: 'concept-binary',
  slug: 'binary-search',
  name: 'Binary Search',
  plain_explanation: 'Open the middle of a sorted list, then keep only the half that can still contain the answer.',
  complexity_time: 'O(log n)',
  complexity_space: 'O(1)',
  animation_config: JSON.stringify({
    kind: 'binary-search',
    array: [1, 3, 5, 7, 9],
    target: 7,
    expect: { foundIndex: 3, steps: 2 }
  })
};

const BINARY_LESSON: LessonInput = {
  ...STACK_LESSON,
  id: 'lesson-binary',
  concept_id: 'concept-binary',
  title: 'Binary Search in 45 Seconds',
  hook: 'Searching a sorted array? Check the middle first.',
  key_takeaway: 'Binary search requires sorted input and runs in O(log n) time.'
};

test('the defaults are the exact personal identity, never a channel name', () => {
  const branding = brandingFrom(null);
  assert.equal(branding.presenter, 'Muhammad Awais');
  assert.equal(branding.role, 'Aspiring Forward Deployed AI Engineer');
  assert.equal(branding.closing, 'Building at the intersection of AI and software.');
  assert.equal(branding.openingMs, 2500);
  assert.equal(branding.endingMs, 2500);
  assert.equal(branding.autoThumbnail, true);
  assert.ok(!/visual cs lab|vs lab/i.test(`${branding.presenter} ${branding.role}`));
});

test('opening and ending durations stay inside 2–3 seconds', () => {
  const long = brandingFrom({ opening_ms: 9000, ending_ms: 9000 });
  assert.equal(long.openingMs, 3000);
  assert.equal(long.endingMs, 3000);
  const short = brandingFrom({ opening_ms: 200, ending_ms: 200 });
  assert.equal(short.openingMs, 2000);
  assert.equal(short.endingMs, 2000);
});

test('the opening title is the lesson topic, never a generic or long sentence', () => {
  assert.equal(shortTitle({ title: 'Stacks in 45 Seconds' }, { name: 'Stacks' }), 'Stacks');
  assert.equal(shortTitle({ title: 'Binary Search in 45 seconds' }, { name: 'Binary Search' }), 'Binary Search');
  assert.equal(shortTitle({ title: 'Heap Sort · 30s' }, { name: 'Heap Sort' }), 'Heap Sort');
  assert.equal(shortTitle({ title: '' }, { name: 'Hash Tables' }), 'Hash Tables');
  // A sentence is not a title: the concept name is the honest short name.
  const long = shortTitle(
    { title: 'Understand exactly how iterative binary search halves the search interval' },
    { name: 'Binary Search' }
  );
  assert.equal(long, 'Binary Search');
});

test('the thumbnail frame is cut 1.0–1.5s in, once the title has settled', () => {
  const at = openingCaptureMs(0, 2500, OPENING_SETTLED_MS);
  assert.ok(at >= 1000 && at <= 1500, `capture at ${at}ms`);
  assert.ok(at > OPENING_SETTLED_MS - 120, 'the capture is after the credit has settled');
  // It follows the opening wherever the opening sits on the timeline, and a
  // shorter opening still leaves a legible frame.
  assert.equal(openingCaptureMs(10000, 12000, OPENING_SETTLED_MS), 10000 + OPENING_SETTLED_MS);
  const short = openingCaptureMs(0, 2000, OPENING_SETTLED_MS);
  assert.ok(short >= 1000 && short <= 1500);
});

function planForLesson(lesson: LessonInput, concept: ConceptInput, brand: PlanBrand = BRAND) {
  const scenes = buildScenes(lesson, concept, brandingFrom(null));
  return planFor({ lesson, concept, scenes, brand });
}

test('the plan opens with the branded beat and closes on the personal identity', () => {
  const plan = planForLesson(STACK_LESSON, STACK_CONCEPT);
  const first = plan.beats[0];
  const last = plan.beats[plan.beats.length - 1];
  assert.equal(first.key, 'open');
  assert.equal(first.endMs - first.startMs, 2500);
  assert.equal(last.key, 'brand');
  assert.equal(plan.opening.title, 'Stacks');
  assert.equal(plan.opening.presenter, 'Muhammad Awais');
  assert.equal(plan.opening.role, 'Aspiring Forward Deployed AI Engineer');
  assert.equal(plan.brand.closing, 'Building at the intersection of AI and software.');
});

test('the stack short passes inspection with the opening, the trace and the closing', () => {
  const plan = planForLesson(STACK_LESSON, STACK_CONCEPT);
  const audit = inspectPlan(plan);
  assert.equal(audit.ok, true, audit.issues.join(' | '));
  assert.ok(audit.checks.some((check) => check.id === 'personal_branding' && check.ok));
  assert.ok(audit.checks.some((check) => check.id === 'algorithm_state' && check.ok));
});

test('the binary search short passes inspection with the opening, the trace and the closing', () => {
  const plan = planForLesson(BINARY_LESSON, BINARY_CONCEPT);
  const audit = inspectPlan(plan);
  assert.equal(audit.ok, true, audit.issues.join(' | '));
  assert.ok(audit.checks.some((check) => check.id === 'personal_branding' && check.ok));
});

test('every opening style keeps its frame inside the safe area', () => {
  for (const style of ['cinematic', 'minimal', 'bold']) {
    const brand: PlanBrand = { ...BRAND, openingStyle: style };
    for (const [lesson, concept] of [
      [STACK_LESSON, STACK_CONCEPT],
      [BINARY_LESSON, BINARY_CONCEPT]
    ] as const) {
      const plan = planForLesson(lesson, concept, brand);
      const audit = inspectPlan(plan);
      assert.equal(audit.ok, true, `${style}: ${audit.issues.join(' | ')}`);
    }
  }
});

test('a storyboard without the branded opening fails the branding check', () => {
  const scenes = buildScenes(BINARY_LESSON, BINARY_CONCEPT, brandingFrom(null)).filter(
    (scene) => scene.type !== 'open'
  );
  const plan = planFor({ lesson: BINARY_LESSON, concept: BINARY_CONCEPT, scenes, brand: BRAND });
  const recorded = recordLayout(plan, { width: 540, height: 960 });
  const check = verifyBranding(plan, recorded);
  assert.equal(check.ok, false);
  assert.match(check.detail, /opening/i);
});

test('a leftover channel watermark fails the branding check', () => {
  const plan = planForLesson(STACK_LESSON, STACK_CONCEPT, { ...BRAND, watermark: 'Visual CS Lab' });
  const recorded = recordLayout(plan, { width: 540, height: 960 });
  const check = verifyBranding(plan, recorded);
  assert.equal(check.ok, false);
  assert.match(check.detail, /old channel branding/i);
});

test('an empty presenter is refused rather than rendered', () => {
  const plan = planForLesson(STACK_LESSON, STACK_CONCEPT, { ...BRAND, presenter: '  ' });
  const recorded = recordLayout(plan, { width: 540, height: 960 });
  const check = verifyBranding(plan, recorded);
  assert.equal(check.ok, false);
});
