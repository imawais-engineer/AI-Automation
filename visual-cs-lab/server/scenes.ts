import { createHash } from 'node:crypto';

import {
  DEFAULT_STACK_OPS,
  parseOps,
  trace as traceStack,
  validate as validateStack,
  type StackEvent,
  type Validation
} from './algorithms/stack.ts';
import {
  isBinarySearchConfig,
  traceBinarySearch,
  validateBinarySearchTrace,
  type BinarySearchConfig,
  type BinarySearchStep
} from './algorithms/binary-search.ts';

export type SceneType = 'hook' | 'concept' | 'code' | 'execution' | 'trace' | 'complexity' | 'summary' | 'brand';

export type StackVisual = {
  kind: 'stack';
  items: number[];
  top: number | null;
  op: 'push' | 'pop' | 'top' | null;
  value: number | null;
  returned: number | null;
  step: number;
  total: number;
};

export type BinarySearchVisual = {
  kind: 'binary-search';
  array: number[];
  target: number;
  foundIndex: number | null;
  mode: 'setup' | 'trace';
  steps: BinarySearchStep[];
};

export type SceneVisual = StackVisual | BinarySearchVisual;

export type Scene = {
  id: string;
  type: SceneType;
  durationMs: number;
  title: string;
  subtitle: string;
  caption: string;
  code?: { language: string; lines: string[]; highlight: number };
  visual?: SceneVisual;
  /** Short labelled facts drawn as cards (complexity scenes). */
  facts?: { label: string; value: string }[];
};

export type LessonInput = {
  id: string;
  concept_id: string;
  title: string;
  audience: string;
  objective: string;
  duration_seconds: number;
  hook: string;
  narration: string;
  on_screen_text: string;
  key_takeaway: string;
  cta: string;
  sources: string;
  /** Human review state: draft, in_review or approved. */
  review_status?: string;
  /** Stored storyboard, JSON encoded. */
  scenes: string;
};

export type ConceptInput = {
  id: string;
  slug: string;
  name: string;
  objectives: string;
  summary: string;
  plain_explanation: string;
  technical_explanation: string;
  pseudocode: string;
  reference_language: string;
  reference_code: string;
  complexity_time: string;
  complexity_space: string;
  example_input: string;
  expected_output: string;
  animation_config: string;
};

export type ConceptRun = {
  kind: 'stack' | 'binary-search' | 'none';
  supported: boolean;
  /** Stack events, empty for other kinds. */
  events: StackEvent[];
  /** Verified binary search steps, empty for other kinds. */
  steps: BinarySearchStep[];
  foundIndex: number | null;
  summary: string;
  /** The input the trusted run was produced from (binary search only). */
  input: number[];
  target: number | null;
  comparisons: number;
  complexity: { time: string; space: string; arraySize: number; comparisons: number } | null;
  errors: string[];
  validation: Validation;
  eventCount: number;
};

export function safeJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw || '');
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function readAnimationConfig(concept: ConceptInput): Record<string, unknown> {
  return safeJson<Record<string, unknown>>(concept.animation_config, {});
}

/** Runs the concept's trusted animation configuration, if it has one. */
export function runConcept(concept: ConceptInput): ConceptRun {
  const config = readAnimationConfig(concept);

  if (isBinarySearchConfig(config)) {
    const binary = config as unknown as BinarySearchConfig;
    const trace = traceBinarySearch(binary.array, binary.target);
    const validation = validateBinarySearchTrace(trace, binary.expect, binary.array, binary.target);
    return {
      kind: 'binary-search',
      supported: true,
      events: [],
      steps: trace.steps,
      foundIndex: trace.foundIndex >= 0 ? trace.foundIndex : null,
      summary: trace.summary,
      input: trace.array,
      target: trace.target,
      comparisons: trace.comparisons,
      complexity: trace.complexity,
      errors: trace.errors,
      validation,
      eventCount: trace.steps.length
    };
  }

  const ops = config.ops ? parseOps(config.ops) : [];
  const supported = ops.length > 0;
  if (!supported) {
    return {
      kind: 'none',
      supported: false,
      events: [],
      steps: [],
      foundIndex: null,
      summary: '',
      input: [],
      target: null,
      comparisons: 0,
      complexity: null,
      errors: [],
      validation: { ok: false, failures: [] },
      eventCount: 0
    };
  }
  const { events, errors } = traceStack(ops);
  const expectation = (config.expect || {}) as Parameters<typeof validateStack>[1];
  const validation = validateStack(events, expectation);
  return {
    kind: 'stack',
    supported: true,
    events,
    steps: [],
    foundIndex: null,
    summary: '',
    input: [],
    target: null,
    comparisons: events.length,
    complexity: null,
    errors,
    validation,
    eventCount: events.length
  };
}

export function lessonDurationMs(lesson: LessonInput): number {
  const seconds = Number(lesson.duration_seconds);
  const clamped = Number.isFinite(seconds) ? Math.max(10, Math.min(60, seconds)) : 20;
  return Math.round(clamped * 1000);
}

/**
 * Splits `totalMs` across scene weights so the parts add up to exactly `totalMs`.
 * Largest-remainder allocation keeps the timeline honest: a 20 second lesson is
 * 20000 ms of video, not 19.98.
 */
export function allocateDurations(weights: number[], totalMs: number): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const exact = weights.map((weight) => (totalMs * weight) / totalWeight);
  const parts = exact.map((value) => Math.floor(value));
  let remainder = Math.round(totalMs - parts.reduce((sum, value) => sum + value, 0));
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; remainder > 0 && order.length > 0; i++, remainder--) {
    parts[order[i % order.length].index] += 1;
  }
  return parts;
}

function toScenes(specs: { weight: number; scene: Omit<Scene, 'id' | 'durationMs'> }[], totalMs: number): Scene[] {
  const durations = allocateDurations(
    specs.map((spec) => spec.weight),
    totalMs
  );
  return specs.map((spec, index) => ({ ...spec.scene, id: `s${index + 1}`, durationMs: durations[index] }));
}

const CODE_LINE_LIMIT = 16;

function codeLines(concept: ConceptInput): string[] {
  const source = (concept.reference_code || concept.pseudocode || '').split('\n');
  return source.slice(0, CODE_LINE_LIMIT).map((line) => line.replace(/\t/g, '  ').slice(0, 46));
}

function buildStackScenes(lesson: LessonInput, concept: ConceptInput, run: ConceptRun, totalMs: number): Scene[] {
  const events = run.events;
  const specs: { weight: number; scene: Omit<Scene, 'id' | 'durationMs'> }[] = [
    {
      weight: 1,
      scene: {
        type: 'hook',
        title: lesson.hook || `${concept.name}: the idea in one line`,
        subtitle: lesson.objective || concept.summary,
        caption: lesson.on_screen_text || ''
      }
    },
    {
      weight: 1.2,
      scene: {
        type: 'concept',
        title: concept.name,
        subtitle: concept.plain_explanation || concept.summary,
        caption: lesson.narration.split('\n')[0] || ''
      }
    }
  ];

  if (concept.reference_code.trim()) {
    specs.push({
      weight: 1.3,
      scene: {
        type: 'code',
        title: `${concept.name} — reference implementation`,
        subtitle: concept.reference_language ? concept.reference_language.toUpperCase() : '',
        caption: 'Read the implementation, then watch the trace below.',
        code: { language: concept.reference_language || 'text', lines: codeLines(concept), highlight: -1 }
      }
    });
  }

  events.forEach((event, index) => {
    specs.push({
      weight: 1,
      scene: {
        type: 'execution',
        title: event.op === 'push' ? `PUSH(${event.value})` : event.op.toUpperCase(),
        subtitle: concept.slug === 'stacks' ? 'LIFO — newest value on top' : concept.summary,
        caption: event.message,
        visual: {
          kind: 'stack',
          items: event.items,
          top: event.top,
          op: event.op,
          value: event.value,
          returned: event.returned,
          step: index + 1,
          total: events.length
        }
      }
    });
  });

  specs.push(
    {
      weight: 0.9,
      scene: {
        type: 'complexity',
        title: 'Complexity',
        subtitle: concept.complexity_time,
        caption: `${concept.complexity_time}. Space: ${concept.complexity_space}.`,
        facts: [
          { label: 'Auxiliary space', value: concept.complexity_space || 'O(1)' },
          { label: 'Rule', value: 'Only the top element is touched.' }
        ]
      }
    },
    {
      weight: 1.1,
      scene: {
        type: 'summary',
        title: lesson.key_takeaway || concept.summary,
        subtitle: concept.example_input ? `Input: ${concept.example_input}` : '',
        caption: lesson.cta || lesson.key_takeaway
      }
    },
    {
      weight: 0.6,
      scene: { type: 'brand', title: 'Visual CS Lab', subtitle: 'Concept → verified trace → short', caption: '' }
    }
  );

  return toScenes(specs, totalMs);
}

/**
 * The five-scene binary search storyboard: hook, concept, trace, complexity and
 * takeaway, branded closing. Weights are the 20 second plan (2.5 / 3.5 / 7 / 4 / 3),
 * so a 20 second lesson lands on exactly those durations.
 */
function buildBinarySearchScenes(lesson: LessonInput, concept: ConceptInput, totalMs: number): Scene[] {
  const config = readAnimationConfig(concept) as unknown as BinarySearchConfig;
  const run = runConcept(concept);
  const array = Array.isArray(config.array) ? config.array : [];
  const target = Number(config.target);

  const setup: BinarySearchVisual = {
    kind: 'binary-search',
    array,
    target,
    foundIndex: run.foundIndex,
    mode: 'setup',
    steps: []
  };

  const specs: { weight: number; scene: Omit<Scene, 'id' | 'durationMs'> }[] = [
    {
      weight: 2.5,
      scene: {
        type: 'hook',
        title: lesson.hook || 'Searching a sorted array? Check the middle first.',
        subtitle: lesson.objective || concept.summary,
        caption: lesson.on_screen_text || ''
      }
    },
    {
      weight: 3.5,
      scene: {
        type: 'concept',
        title: `Sorted array · target ${target}`,
        subtitle: concept.plain_explanation || concept.summary,
        caption: 'Precondition: the array is sorted — halving only works because of that order.',
        visual: setup
      }
    },
    {
      weight: 7,
      scene: {
        type: 'trace',
        title: `Trace · target ${target}`,
        subtitle: 'low, high and mid · mid = floor((low + high) / 2)',
        // Short enough to read inside 7 seconds with the sound off; the panel
        // already names the comparison and the bound that moves.
        caption: 'Compare the midpoint · keep the half that can still hold the target.',
        visual: { ...setup, mode: 'trace', steps: run.steps }
      }
    },
    {
      weight: 4,
      scene: {
        type: 'complexity',
        title: lesson.key_takeaway,
        subtitle: concept.complexity_time,
        caption: `Space: ${concept.complexity_space} auxiliary for this iterative version.`,
        facts: [
          { label: 'Auxiliary space', value: concept.complexity_space || 'O(1)' },
          { label: 'Precondition', value: 'Input must be sorted' }
        ]
      }
    },
    {
      weight: 3,
      scene: {
        type: 'brand',
        title: 'Visual CS Lab',
        subtitle: "Understand the algorithm. Don't just memorize it.",
        caption: ''
      }
    }
  ];

  return toScenes(specs, totalMs);
}

/**
 * Turns a lesson into the structured scene list the renderer draws. Every scene
 * carries its own duration, so the timeline is data, not code per video.
 */
export function buildScenes(lesson: LessonInput, concept: ConceptInput): Scene[] {
  const totalMs = lessonDurationMs(lesson);
  const run = runConcept(concept);
  if (run.kind === 'binary-search' && run.supported) return buildBinarySearchScenes(lesson, concept, totalMs);
  return buildStackScenes(lesson, concept, run, totalMs);
}

function hasExpectation(config: Record<string, unknown>): boolean {
  const expect = config.expect;
  if (!expect || typeof expect !== 'object') return false;
  const values = Object.values(expect as Record<string, unknown>);
  return values.some((value) => value !== null && value !== undefined);
}

function formatSeconds(ms: number): string {
  return (Math.round(ms / 100) / 10).toFixed(1);
}

/** How far the persisted scene total may drift from the lesson duration. */
export const TOTAL_TOLERANCE_MS = 100;

/**
 * A cheap fingerprint of a verified trace: the decision each comparison made and
 * the bounds it produced. Two storyboards with the same fingerprint animate the
 * same run, so a stale storyboard cannot pass readiness on step count alone.
 */
function traceSignature(steps: BinarySearchStep[]): string {
  return steps.map((step) => `${step.low}:${step.high}:${step.mid}:${step.comparison}:${step.nextLow}:${step.nextHigh}`).join('|');
}

/**
 * Stable fingerprint of a stored storyboard. A render job keeps this so its MP4
 * can be matched to the exact scenes that produced it, even after later edits.
 */
export function storyboardHash(scenes: Scene[]): string {
  const payload = JSON.stringify(
    scenes.map((scene) => ({
      id: scene.id,
      type: scene.type,
      durationMs: scene.durationMs,
      title: scene.title,
      subtitle: scene.subtitle,
      caption: scene.caption,
      code: scene.code ?? null,
      visual: scene.visual ?? null
    }))
  );
  return createHash('sha1').update(payload).digest('hex');
}

function storyboardIssues(lesson: LessonInput, concept: ConceptInput, run: ConceptRun, seconds: number): string[] {
  const issues: string[] = [];
  const stored = safeJson<Scene[]>(lesson.scenes || '[]', []);
  if (stored.length === 0) {
    return ['The lesson has no storyboard yet — build it from the verified trace.'];
  }

  // Reordering and duplicating scenes is allowed, so the check is that every
  // scene the plan needs is still present — not that the order is untouched.
  const required = Array.from(new Set(buildScenes(lesson, concept).map((scene) => scene.type)));
  const missing = required.filter((type) => !stored.some((scene) => scene.type === type));
  if (missing.length > 0) {
    return [
      `The storyboard is missing its ${missing.join(', ')} scene${missing.length === 1 ? '' : 's'} — rebuild the storyboard.`
    ];
  }

  stored.forEach((scene, index) => {
    const label = `Scene ${index + 1} (${scene.type})`;
    const duration = Number(scene.durationMs);
    if (!Number.isFinite(duration) || duration < 300) {
      issues.push(`${label} needs a duration of at least 0.3 seconds.`);
    }
    if (!String(scene.id || '').trim()) issues.push(`${label} is missing its id — rebuild the storyboard.`);

    if (scene.type === 'hook' || scene.type === 'summary' || scene.type === 'brand') {
      if (!String(scene.title || '').trim()) issues.push(`${label} needs its text before it can be rendered.`);
    }
    if (scene.type === 'concept' && !String(scene.subtitle || '').trim()) {
      issues.push(`${label} needs its explanation text.`);
    }
    if (scene.type === 'complexity' && !String(scene.subtitle || '').trim()) {
      issues.push(`${label} needs the time complexity.`);
    }
    if (scene.type === 'code' && (!scene.code || scene.code.lines.length === 0)) {
      issues.push(`${label} has no code lines.`);
    }
    if (scene.type === 'trace' || scene.type === 'execution') {
      if (!scene.visual) {
        issues.push(`${label} is missing its animation data — rebuild the storyboard.`);
      } else if (scene.visual.kind === 'binary-search' && run.kind === 'binary-search') {
        if (scene.visual.steps.length === 0) {
          issues.push(`${label} carries no verified trace steps.`);
        } else if (scene.visual.steps.length !== run.steps.length) {
          issues.push(
            `${label} carries ${scene.visual.steps.length} trace steps but the trusted run has ${run.steps.length} — rebuild the storyboard.`
          );
        } else if (traceSignature(scene.visual.steps) !== traceSignature(run.steps)) {
          issues.push(`${label} animates different comparisons than the verified trace — rebuild the storyboard.`);
        }
        if (!Array.isArray(scene.visual.array) || scene.visual.array.length === 0) {
          issues.push(`${label} is missing the array it should animate.`);
        } else if (scene.visual.array.join(',') !== run.input.join(',')) {
          issues.push(`${label} animates a different array than the concept configuration — rebuild the storyboard.`);
        }
        if (scene.visual.target !== run.target) {
          issues.push(`${label} animates target ${String(scene.visual.target)} but the concept searches for ${String(run.target)} — rebuild the storyboard.`);
        }
      } else if (scene.visual.kind === 'stack' && run.kind === 'stack') {
        if (!Array.isArray(scene.visual.items)) issues.push(`${label} is missing its stack snapshot.`);
      }
    }
  });

  const total = stored.reduce((sum, scene) => sum + (Number(scene.durationMs) || 0), 0);
  const target = Math.round(seconds * 1000);
  if (total > 0 && Math.abs(total - target) > TOTAL_TOLERANCE_MS) {
    issues.push(
      `The scene timings add up to ${formatSeconds(total)}s but the lesson duration is ${formatSeconds(target)}s — adjust the scene timings.`
    );
  }

  const hookScene = stored.find((scene) => scene.type === 'hook');
  if (hookScene && lesson.hook.trim() && hookScene.title.trim() !== lesson.hook.trim()) {
    issues.push('The storyboard hook no longer matches the lesson hook — rebuild the storyboard.');
  }

  return issues;
}

/** Everything that has to be true before a lesson may be rendered. */
export function lessonIssues(lesson: LessonInput, concept: ConceptInput): string[] {
  const issues: string[] = [];

  if (lesson.concept_id && concept.id && lesson.concept_id !== concept.id) {
    issues.push('The lesson points at a different concept than the one loaded — recreate the lesson from its concept.');
  }
  if (!String(lesson.hook || '').trim()) issues.push('The lesson needs a hook: the first line on screen.');
  if (!String(lesson.objective || '').trim()) issues.push('The lesson needs a learning objective.');
  if (!String(lesson.key_takeaway || '').trim()) issues.push('The lesson needs a key takeaway.');
  if (!concept.reference_code.trim() && !concept.pseudocode.trim()) {
    issues.push('The concept needs pseudocode or a reference implementation.');
  }

  const seconds = Number(lesson.duration_seconds);
  const durationValid = Number.isFinite(seconds) && seconds >= 10 && seconds <= 60;
  if (!durationValid) issues.push('The lesson duration must be between 10 and 60 seconds.');

  const config = readAnimationConfig(concept);
  const run = runConcept(concept);
  if (!run.supported) {
    issues.push('This concept has no animation configuration yet, so no trace can be verified.');
    return Array.from(new Set(issues));
  }

  issues.push(...run.errors);
  if (run.validation.failures.length > 0) issues.push(...run.validation.failures);
  else if (!run.validation.ok) {
    issues.push('The trace could not be verified against the trusted implementation, so the lesson cannot render.');
  }
  if (!hasExpectation(config)) {
    issues.push(
      `The ${run.kind === 'binary-search' ? 'binary search' : 'stack'} animation configuration has no expected result to verify against.`
    );
  }

  if (durationValid) issues.push(...storyboardIssues(lesson, concept, run, seconds));

  return Array.from(new Set(issues));
}

export { DEFAULT_STACK_OPS };
