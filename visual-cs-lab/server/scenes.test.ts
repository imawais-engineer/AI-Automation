import assert from 'node:assert/strict';
import test from 'node:test';

import { allocateDurations, buildScenes, lessonIssues, type ConceptInput, type LessonInput, type Scene } from './scenes.ts';
import { traceProgress } from './render/binary-search-panel.ts';

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
  title: 'Binary Search in 20 seconds',
  audience: 'Junior developers',
  objective: 'Trace low, high and mid over a sorted array and explain why every comparison halves the range.',
  duration_seconds: 20,
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

test('binary search storyboard has five scenes totalling exactly 20 seconds', () => {
  const scenes = buildScenes(BINARY_LESSON, BINARY_CONCEPT);
  assert.deepEqual(
    scenes.map((scene) => scene.type),
    ['hook', 'concept', 'trace', 'complexity', 'brand']
  );
  assert.deepEqual(
    scenes.map((scene) => scene.durationMs),
    [2500, 3500, 7000, 4000, 3000]
  );
  assert.equal(
    scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
    20000
  );
});

test('binary search storyboard carries the verified trace and the lesson copy', () => {
  const scenes = buildScenes(BINARY_LESSON, BINARY_CONCEPT);
  const [hook, concept, trace, complexity, brand] = scenes;

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

  assert.equal(brand.subtitle, "Understand the algorithm. Don't just memorize it.");
});

test('storyboard durations scale exactly to other lesson lengths', () => {
  const scenes = buildScenes({ ...BINARY_LESSON, duration_seconds: 30 }, BINARY_CONCEPT);
  assert.equal(
    scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
    30000
  );
  assert.deepEqual(allocateDurations([2.5, 3.5, 7, 4, 3], 20000), [2500, 3500, 7000, 4000, 3000]);
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
  const tampered = scenes.map((scene, index) => {
    if (index !== 2 || scene.visual?.kind !== 'binary-search') return scene;
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
  assert.ok(issues.some((issue) => /add up to 21\.5s/.test(issue)));
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
  assert.equal(scenes.length, 10);
  assert.equal(
    scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
    20000
  );
  assert.deepEqual(lessonIssues(withScenes(lesson, scenes), concept), []);
});

test('trace progress walks the steps of the trace scene in order', () => {
  assert.deepEqual(traceProgress(2, 7000, 0), { index: 0, local: 0 });
  assert.equal(traceProgress(2, 7000, 3000).index, 0);
  assert.equal(traceProgress(2, 7000, 3600).index, 1);
  assert.equal(traceProgress(2, 7000, 6999).index, 1);
  assert.equal(traceProgress(2, 7000, 6999).local > 0.9, true);
});
