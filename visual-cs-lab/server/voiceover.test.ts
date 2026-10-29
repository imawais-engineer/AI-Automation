import assert from 'node:assert/strict';
import test from 'node:test';

import { planFor, type PlanBrand } from './anim/index.ts';
import { buildScenes, type ConceptInput, type LessonInput } from './scenes.ts';
import {
  applyVoiceoverEdits,
  checkVoiceover,
  formatVoiceover,
  generateVoiceover,
  verifiedNumbers
} from './voiceover.ts';

const BRAND: PlanBrand = {
  name: 'Muhammad Awais',
  accent: '#22d3ee',
  background: '#0b1220',
  panel: '#141c2e',
  ink: '#e6edf7',
  watermark: 'Muhammad Awais',
  outro: '',
  presenter: 'Muhammad Awais',
  role: 'Aspiring Forward Deployed AI Engineer',
  closing: 'Building at the intersection of AI and software.',
  openingStyle: 'cinematic'
};

const STACK_CONCEPT: ConceptInput = {
  id: 'concept-stack',
  slug: 'stacks',
  name: 'Stacks',
  objectives: 'Explain LIFO.',
  summary: 'A LIFO container.',
  plain_explanation: 'A stack is a pile where you can only touch the top. The newest item always leaves first.',
  technical_explanation: 'Array-backed stack with O(1) push and pop.',
  pseudocode: 'PUSH(s, x): s.items[top] = x',
  reference_language: 'typescript',
  reference_code: 'class Stack {}',
  complexity_time: 'O(1) push, pop and peek',
  complexity_space: 'O(n) for n stored elements',
  example_input: 'PUSH(10), PUSH(20), POP()',
  expected_output: 'POP returns 20',
  animation_config: JSON.stringify({
    ops: [
      { op: 'push', value: 10 },
      { op: 'push', value: 20 },
      { op: 'pop' }
    ],
    expect: { finalStack: [10], top: 10, popReturns: 20 }
  })
};

const STACK_LESSON: LessonInput = {
  id: 'lesson-stack',
  concept_id: 'concept-stack',
  title: 'Stacks in 45 Seconds',
  audience: 'Beginners',
  objective: 'Watch PUSH and POP change one stack.',
  duration_seconds: 45,
  hook: 'Three values go in. Which one comes out first?',
  narration: 'Push and pop.',
  on_screen_text: 'LIFO',
  key_takeaway: 'LIFO: the last value pushed is the first value popped.',
  cta: 'POP on an empty stack returns EMPTY.',
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
  key_takeaway: 'Each comparison halves the range: O(log n) time, O(1) extra space.'
};

function planForLesson(lesson: LessonInput, concept: ConceptInput) {
  const scenes = buildScenes(lesson, concept);
  return planFor({ lesson, concept, scenes, brand: BRAND });
}

test('a stack script narrates every operation with the verified result', () => {
  const plan = planForLesson(STACK_LESSON, STACK_CONCEPT);
  const { script } = generateVoiceover({ plan, lesson: STACK_LESSON, concept: STACK_CONCEPT });

  assert.ok(script.segments.length >= plan.beats.length);
  assert.equal(script.segments[0].scene, 'Opening');
  assert.equal(script.segments[0].startMs, 0);
  assert.match(script.segments[0].text, /Presented by Muhammad Awais/);
  assert.equal(script.segments[1].scene, 'Hook');

  const popSegment = script.segments.find((segment) => segment.scene.includes('POP'));
  assert.ok(popSegment, 'the POP scene is narrated');
  assert.match(popSegment!.text, /20/);

  const { checks, ok } = checkVoiceover({ script, plan });
  assert.equal(ok, true, checks.map((check) => check.detail).join(' | '));
});

test('script timestamps tile the scene timeline exactly', () => {
  const plan = planForLesson(BINARY_LESSON, BINARY_CONCEPT);
  const { script } = generateVoiceover({ plan, lesson: BINARY_LESSON, concept: BINARY_CONCEPT });

  for (const beat of plan.beats) {
    const inside = script.segments.filter(
      (segment) => segment.startMs >= beat.startMs && segment.endMs <= beat.endMs
    );
    assert.ok(inside.length > 0, `${beat.sceneType} is narrated`);
    assert.equal(inside[0].startMs, beat.startMs);
    assert.equal(inside[inside.length - 1].endMs, beat.endMs);
  }
  const sorted = [...script.segments].sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].startMs >= sorted[i - 1].endMs, 'segments never overlap');
  }
});

test('a binary search script walks the real comparison sequence', () => {
  const plan = planForLesson(BINARY_LESSON, BINARY_CONCEPT);
  const { script } = generateVoiceover({ plan, lesson: BINARY_LESSON, concept: BINARY_CONCEPT });
  const trace = script.segments.filter((segment) => segment.scene.startsWith('Trace'));

  assert.equal(trace.length, 4, 'setup, two comparisons and the result');
  assert.match(trace[1].text, /index 2 holding 5/);
  assert.match(trace[2].text, /the target/);
  assert.match(trace[3].text, /5 values took only 2 comparisons/i);
});

test('an invented result fails the narration accuracy check', () => {
  const plan = planForLesson(STACK_LESSON, STACK_CONCEPT);
  const { script } = generateVoiceover({ plan, lesson: STACK_LESSON, concept: STACK_CONCEPT });
  const edited = applyVoiceoverEdits(script, [
    { id: script.segments[1].id, text: 'Push 99 onto the stack and watch the top change.' }
  ]);
  const { checks, ok } = checkVoiceover({ script: edited, plan });
  assert.equal(ok, false);
  const accuracy = checks.find((check) => check.id === 'voiceover_accuracy');
  assert.equal(accuracy?.ok, false);
  assert.match(String(accuracy?.detail), /99/);
});

test('numbers the trace can honestly state are allowed', () => {
  const plan = planForLesson(BINARY_LESSON, BINARY_CONCEPT);
  const allowed = verifiedNumbers(plan);
  for (const value of [1, 3, 5, 7, 9, 2, 45]) assert.ok(allowed.has(value), `${value} is allowed`);
  assert.equal(allowed.has(42), false);
});

test('the copyable script follows the documented format', () => {
  const plan = planForLesson(BINARY_LESSON, BINARY_CONCEPT);
  const { script } = generateVoiceover({ plan, lesson: BINARY_LESSON, concept: BINARY_CONCEPT });
  const markdown = formatVoiceover(script);

  assert.match(markdown, /\*\*Video title:\*\* Binary Search in 45 Seconds/);
  assert.match(markdown, /\*\*Estimated narration duration:\*\* 45\.0s/);
  assert.match(markdown, /\| Timestamp \| Scene \| Voice-over \|/);
  assert.match(markdown, /\| 00:00–00:03 \| Opening \| Binary Search\. Presented by Muhammad Awais\. \|/);
  assert.match(markdown, /\| 00:03–00:05 \| Hook \|/);
  assert.match(markdown, /\*\*Continuous script\*\*/);
  assert.equal(markdown.split(script.script).length, 2, 'the continuous script is included once');
});

test('regenerating gives the same script for the same plan', () => {
  const plan = planForLesson(STACK_LESSON, STACK_CONCEPT);
  const first = generateVoiceover({ plan, lesson: STACK_LESSON, concept: STACK_CONCEPT });
  const second = generateVoiceover({ plan, lesson: STACK_LESSON, concept: STACK_CONCEPT });
  assert.equal(first.sourceHash, second.sourceHash);
  assert.deepEqual(first.script.segments, second.script.segments);
});
