import assert from 'node:assert/strict';
import test from 'node:test';

import { allocateDurations, buildScenes, lessonIssues, type ConceptInput, type LessonInput, type Scene } from './scenes.ts';
import { brandingFrom, openingCaptureMs, shortTitle } from './branding.ts';
import { inspectPlan, verifyBranding } from './anim/inspect.ts';
import { planFor, type PlanBrand } from './anim/index.ts';
import { stackStateAt } from './anim/stack.ts';
import { binaryStateAt, blockWidth } from './anim/binary.ts';

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

const BINARY_CONCEPT: ConceptInput = {
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

const BINARY_LESSON: LessonInput = {
  id: 'lesson-binary',
  concept_id: 'concept-binary',
  title: 'Binary Search in 45 seconds',
  audience: 'Junior developers',
  objective: 'Trace low, high and mid over a sorted array and explain why every comparison halves the range.',
  duration_seconds: 45,
  hook: 'Searching a sorted array? Check the middle first.',
  narration: 'Sorted array 1, 3, 5, 7, 9. Target 7. The middle is 5, so the left half is gone.',
  on_screen_text: 'mid = floor((low + high) / 2)',
  key_takeaway: 'Each comparison halves the range: O(log n) time, O(1) extra space.',
  cta: 'Try a target that is not in the array.',
  sources: 'CLRS ch. 2.3',
  scenes: '[]'
};

function withScenes(lesson: LessonInput, scenes: Scene[]): LessonInput {
  return { ...lesson, scenes: JSON.stringify(scenes) };
}

test('binary search storyboard opens, teaches and closes inside exactly 45 seconds', () => {
  const scenes = buildScenes(BINARY_LESSON, BINARY_CONCEPT);
  assert.deepEqual(
    scenes.map((scene) => scene.type),
    ['open', 'hook', 'concept', 'trace', 'complexity', 'brand']
  );
  // The 2.5s opening and 2.5s closing are allocated first; the lesson is fitted
  // into the 40 seconds that remain.
  assert.equal(scenes[0].durationMs, 2500);
  assert.equal(scenes[scenes.length - 1].durationMs, 2500);
  assert.equal(
    scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
    45000
  );
  assert.equal((45000 / 1000) * 30, 1350, 'a 45 second short is exactly 1350 frames at 30 fps');
});

test('the opening runs 2–3 seconds, carries the lesson title and the personal credit', () => {
  for (const seconds of [10, 20, 45, 60]) {
    const scenes = buildScenes({ ...BINARY_LESSON, duration_seconds: seconds }, BINARY_CONCEPT);
    const opening = scenes[0];
    assert.equal(opening.type, 'open');
    assert.ok(opening.durationMs >= 2000 && opening.durationMs <= 3000, `${opening.durationMs}ms opening`);
    assert.equal(opening.title, 'Binary Search', 'the lesson title is shortened to its topic');
    assert.equal(opening.caption, 'Presented by Muhammad Awais');
    const ending = scenes[scenes.length - 1];
    assert.equal(ending.type, 'brand');
    assert.ok(ending.durationMs >= 2000 && ending.durationMs <= 3000);
    assert.equal(ending.title, 'Muhammad Awais');
    assert.equal(ending.subtitle, 'Aspiring Forward Deployed AI Engineer');
    assert.equal(ending.caption, 'Building at the intersection of AI and software.');
  }
});

test('the opening and ending durations come from the branding settings', () => {
  const branding = { ...brandingFrom(null), openingMs: 3000, endingMs: 2000 };
  const scenes = buildScenes(BINARY_LESSON, BINARY_CONCEPT, branding);
  assert.equal(scenes[0].durationMs, 3000);
  assert.equal(scenes[scenes.length - 1].durationMs, 2000);
  assert.equal(scenes.reduce((sum, scene) => sum + scene.durationMs, 0), 45000);
});

test('a duration too short for the opening, lesson and closing is reported', () => {
  const short = { ...BINARY_LESSON, duration_seconds: 10 };
  const issues = lessonIssues({ ...short, scenes: JSON.stringify(buildScenes(short, BINARY_CONCEPT)) }, BINARY_CONCEPT);
  assert.ok(issues.some((issue) => /raise the duration to at least/i.test(issue)));
});

test('binary search storyboard carries the verified trace and the lesson copy', () => {
  const scenes = buildScenes(BINARY_LESSON, BINARY_CONCEPT);
  const [opening, hook, concept, trace, complexity, brand] = scenes;

  assert.equal(opening.type, 'open');
  assert.equal(hook.title, BINARY_LESSON.hook);

  const setup = concept.visual;
  assert.equal(setup?.kind, 'binary-search');
  assert.deepEqual(setup && setup.kind === 'binary-search' ? setup.array : [], [1, 3, 5, 7, 9]);
  assert.equal(setup && setup.kind === 'binary-search' ? setup.target : null, 7);

  const visual = trace.visual;
  assert.equal(visual?.kind, 'binary-search');
  if (!visual || visual.kind !== 'binary-search') throw new Error('trace scene has no binary search visual');
  assert.equal(visual.mode, 'trace');
  assert.equal(visual.steps.length, 2);
  assert.deepEqual(
    visual.steps.map((step) => [step.low, step.high, step.mid, step.midValue]),
    [
      [0, 4, 2, 5],
      [3, 4, 3, 7]
    ]
  );
  assert.equal(visual.foundIndex, 3);

  assert.equal(complexity.subtitle, 'O(log n)');
  assert.match(complexity.caption, /O\(1\)/);
  assert.equal(complexity.title, BINARY_LESSON.key_takeaway);

  assert.equal(brand.title, 'Muhammad Awais');
  assert.equal(brand.subtitle, 'Aspiring Forward Deployed AI Engineer');
});

test('storyboard durations scale exactly to other lesson lengths', () => {
  const scenes = buildScenes({ ...BINARY_LESSON, duration_seconds: 30 }, BINARY_CONCEPT);
  assert.equal(
    scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
    30000
  );
  assert.deepEqual(allocateDurations([3, 5, 27.5, 7, 2.5], 45000), [3000, 5000, 27500, 7000, 2500]);
});

test('the completed binary search lesson validates without bypasses', () => {
  const issues = lessonIssues(withScenes(BINARY_LESSON, buildScenes(BINARY_LESSON, BINARY_CONCEPT)), BINARY_CONCEPT);
  assert.deepEqual(issues, []);
});

test('validation reports a missing storyboard, hook and takeaway', () => {
  const noStoryboard = lessonIssues(BINARY_LESSON, BINARY_CONCEPT);
  assert.ok(noStoryboard.some((issue) => /no storyboard/i.test(issue)));

  const bare = withScenes({ ...BINARY_LESSON, hook: '', key_takeaway: '' }, buildScenes(BINARY_LESSON, BINARY_CONCEPT));
  const issues = lessonIssues(bare, BINARY_CONCEPT);
  assert.ok(issues.some((issue) => /needs a hook/i.test(issue)));
  assert.ok(issues.some((issue) => /key takeaway/i.test(issue)));
});

test('a storyboard whose trace steps were altered fails readiness', () => {
  const scenes = buildScenes(BINARY_LESSON, BINARY_CONCEPT);
  const tampered = scenes.map((scene) => {
    if (scene.type !== 'trace' || scene.visual?.kind !== 'binary-search') return scene;
    const steps = scene.visual.steps.map((step, i) => (i === 1 ? { ...step, mid: 4 } : step));
    return { ...scene, visual: { ...scene.visual, steps } };
  });
  const issues = lessonIssues(withScenes(BINARY_LESSON, tampered), BINARY_CONCEPT);
  assert.ok(issues.some((issue) => /different comparisons/i.test(issue)));
});

test('editing the lesson hook makes the stored storyboard stale', () => {
  const stale = { ...BINARY_LESSON, hook: 'A different hook.' };
  const issues = lessonIssues(withScenes(stale, buildScenes(BINARY_LESSON, BINARY_CONCEPT)), BINARY_CONCEPT);
  assert.ok(issues.some((issue) => /rebuild the storyboard/i.test(issue)));
});

test('validation reports a concept without an animation configuration', () => {
  const issues = lessonIssues(BINARY_LESSON, { ...BINARY_CONCEPT, animation_config: '{}' });
  assert.ok(issues.some((issue) => /no animation configuration/i.test(issue)));
});

test('validation reports an expectation mismatch', () => {
  const concept: ConceptInput = {
    ...BINARY_CONCEPT,
    animation_config: JSON.stringify({
      kind: 'binary-search',
      array: [1, 3, 5, 7, 9],
      target: 7,
      expect: { foundIndex: 2 }
    })
  };
  const issues = lessonIssues(withScenes(BINARY_LESSON, buildScenes(BINARY_LESSON, concept)), concept);
  assert.ok(issues.some((issue) => /index 3/.test(issue)));
});

test('validation reports scene timings that no longer add up', () => {
  const scenes = buildScenes(BINARY_LESSON, BINARY_CONCEPT).map((scene, index) =>
    index === 2 ? { ...scene, durationMs: scene.durationMs + 1500 } : scene
  );
  const issues = lessonIssues(withScenes(BINARY_LESSON, scenes), BINARY_CONCEPT);
  assert.ok(issues.some((issue) => /add up to 46\.5s/.test(issue)));
});

test('validation reports mismatched lesson and concept references', () => {
  const lesson = withScenes(BINARY_LESSON, buildScenes(BINARY_LESSON, BINARY_CONCEPT));
  const issues = lessonIssues({ ...lesson, concept_id: 'another-concept' }, BINARY_CONCEPT);
  assert.ok(issues.some((issue) => /different concept/i.test(issue)));
});

test('the stack storyboard still builds and validates', () => {
  const concept: ConceptInput = {
    ...BINARY_CONCEPT,
    id: 'concept-stack',
    slug: 'stacks',
    name: 'Stacks',
    complexity_time: 'O(1) push, pop and peek',
    complexity_space: 'O(n) for n stored elements',
    example_input: 'PUSH(10), PUSH(20), PUSH(30), POP()',
    animation_config: JSON.stringify({
      ops: [
        { op: 'push', value: 10 },
        { op: 'push', value: 20 },
        { op: 'push', value: 30 },
        { op: 'pop' }
      ],
      expect: { finalStack: [10, 20], top: 20, popReturns: 30 }
    })
  };
  const lesson: LessonInput = {
    ...BINARY_LESSON,
    id: 'lesson-stack',
    concept_id: 'concept-stack',
    title: 'Stack in 20 seconds',
    hook: 'Three values go into a stack. Which one comes out first?',
    key_takeaway: 'LIFO: the last value in is the first value out'
  };

  const scenes = buildScenes(lesson, concept);
  // opening, hook, setup, one beat per verified operation, LIFO, complexity, closing.
  assert.equal(scenes.length, 10);
  assert.equal(scenes.filter((scene) => scene.type === 'execution').length, 4);
  assert.equal(
    scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
    45000
  );
  assert.deepEqual(lessonIssues(withScenes(lesson, scenes), concept), []);
});

test('the binary animation shows the verified bounds at the end of every comparison', () => {
  const scenes = buildScenes(BINARY_LESSON, BINARY_CONCEPT);
  const plan = planFor({ lesson: BINARY_LESSON, concept: BINARY_CONCEPT, scenes, brand: BRAND });
  if (plan.kind !== 'binary') throw new Error('expected a binary plan');
  assert.equal(plan.array.length, 5);
  assert.equal(plan.target, 7);

  const [first, second] = plan.steps;
  const afterFirst = binaryStateAt(plan, first.endMs - 1);
  assert.equal(first.step.low, 0);
  assert.equal(first.step.high, 4);
  assert.equal(first.step.mid, 2);
  assert.equal(first.step.midValue, 5);
  assert.equal(afterFirst.low, 3);
  assert.equal(afterFirst.high, 4);

  const afterSecond = binaryStateAt(plan, second.endMs - 1);
  assert.equal(second.step.mid, 3);
  assert.equal(second.step.midValue, 7);
  assert.equal(second.step.comparison, 'equal');
  assert.equal(afterSecond.matched, 3);
  assert.equal(afterSecond.eliminated.get(0), 1);
  assert.equal(afterSecond.eliminated.get(1), 1);
});

test('every supported array length stays inside the 1080 wide frame', () => {
  for (let count = 2; count <= 8; count++) {
    const width = blockWidth(count);
    const total = count * width + (count - 1) * 22;
    assert.ok(total <= 960, `${count} values need ${total}px`);
    assert.ok(width >= 96, `${count} values keep blocks ${width}px wide`);
  }
  assert.equal(blockWidth(5), 158, 'the five value demo keeps its full-size blocks');
});

test('the stack animation shows the verified state after every operation', () => {
  const concept: ConceptInput = {
    ...BINARY_CONCEPT,
    id: 'concept-stack-motion',
    slug: 'stacks',
    name: 'Stacks',
    complexity_time: 'O(1) push, pop and peek',
    complexity_space: 'O(n) for n stored elements',
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
  const lesson: LessonInput = {
    ...BINARY_LESSON,
    concept_id: 'concept-stack-motion',
    title: 'Stacks in 45 seconds',
    hook: 'Three values go in. Which one comes out first?',
    key_takeaway: 'LIFO: the last value pushed is the first value popped.'
  };

  const scenes = buildScenes(lesson, concept);
  assert.deepEqual(lessonIssues({ ...lesson, scenes: JSON.stringify(scenes) }, concept), []);
  const plan = planFor({ lesson, concept, scenes, brand: BRAND });
  if (plan.kind !== 'stack') throw new Error('expected a stack plan');

  const expected = [
    [10],
    [10, 20],
    [10, 20, 30],
    [10, 20, 30],
    [10, 20],
    [10],
    [10, 40]
  ];
  plan.ops.forEach((op, index) => {
    assert.deepEqual(op.event.items, expected[index], `verified state after operation ${index + 1}`);
    assert.deepEqual(stackStateAt(plan, op.endMs - 1).items, expected[index]);
  });
  assert.equal(stackStateAt(plan, plan.ops[3].endMs - 1).top, 30, 'PEEK leaves 30 on top');
  assert.equal(plan.ops[4].event.returned, 30, 'first POP returns 30');
  assert.equal(plan.ops[5].event.returned, 20, 'second POP returns 20');
});
