import { parseOps, trace, validate, DEFAULT_STACK_OPS, type StackEvent } from './algorithms/stack.ts';

export type SceneType = 'hook' | 'concept' | 'code' | 'execution' | 'complexity' | 'summary' | 'brand';

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

export type Scene = {
  id: string;
  type: SceneType;
  durationMs: number;
  title: string;
  subtitle: string;
  caption: string;
  code?: { language: string; lines: string[]; highlight: number };
  visual?: StackVisual;
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
};

export type ConceptInput = {
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
  events: StackEvent[];
  errors: string[];
  validation: { ok: boolean; failures: string[] };
  supported: boolean;
};

/** Runs the concept's trusted animation configuration, if it has one. */
export function runConcept(concept: ConceptInput): ConceptRun {
  const config = safeJson<{ ops?: unknown; expect?: Record<string, unknown> }>(concept.animation_config, {});
  const ops = config.ops ? parseOps(config.ops) : [];
  const supported = ops.length > 0;
  if (!supported) {
    return { events: [], errors: [], validation: { ok: false, failures: [] }, supported: false };
  }
  const { events, errors } = trace(ops);
  const validation = validate(events, (config.expect || {}) as Parameters<typeof validate>[1]);
  return { events, errors, validation, supported: true };
}

export function safeJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw || '');
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function lessonIssues(lesson: LessonInput, concept: ConceptInput): string[] {
  const issues: string[] = [];
  if (!lesson.hook.trim()) issues.push('The lesson needs a hook.');
  if (!lesson.objective.trim()) issues.push('The lesson needs a learning objective.');
  if (!lesson.key_takeaway.trim()) issues.push('The lesson needs a key takeaway.');
  if (!concept.reference_code.trim() && !concept.pseudocode.trim()) {
    issues.push('The concept needs pseudocode or a reference implementation.');
  }
  const run = runConcept(concept);
  if (!run.supported) {
    issues.push('This concept has no animation configuration yet, so no trace can be verified.');
  } else if (!run.validation.ok) {
    issues.push(...run.validation.failures);
  }
  return issues;
}

const CODE_LINE_LIMIT = 16;

function codeLines(concept: ConceptInput): string[] {
  const source = (concept.reference_code || concept.pseudocode || '').split('\n');
  return source.slice(0, CODE_LINE_LIMIT).map((line) => line.replace(/\t/g, '  ').slice(0, 46));
}

/**
 * Turns a lesson into the structured scene list the renderer draws. Every scene
 * carries its own duration, so the timeline is data, not code per video.
 */
export function buildScenes(lesson: LessonInput, concept: ConceptInput): Scene[] {
  const totalSeconds = Math.max(10, Math.min(60, Number(lesson.duration_seconds) || 20));
  const run = runConcept(concept);
  const events = run.supported ? run.events : [];

  const weights: { key: string; weight: number }[] = [
    { key: 'hook', weight: 1 },
    { key: 'concept', weight: 1.2 }
  ];
  if (concept.reference_code.trim()) weights.push({ key: 'code', weight: 1.3 });
  events.forEach((_, index) => weights.push({ key: `step-${index}`, weight: 1 }));
  weights.push({ key: 'complexity', weight: 0.9 });
  weights.push({ key: 'summary', weight: 1.1 });
  weights.push({ key: 'brand', weight: 0.6 });

  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
  const ms = (weight: number) => Math.max(600, Math.round((totalSeconds * 1000 * weight) / totalWeight));
  const scenes: Scene[] = [];
  const push = (scene: Omit<Scene, 'id'>) => scenes.push({ ...scene, id: `s${scenes.length + 1}` });

  push({
    type: 'hook',
    durationMs: ms(1),
    title: lesson.hook || `${concept.name}: the idea in one line`,
    subtitle: lesson.objective || concept.summary,
    caption: lesson.on_screen_text || ''
  });

  push({
    type: 'concept',
    durationMs: ms(1.2),
    title: concept.name,
    subtitle: concept.plain_explanation || concept.summary,
    caption: lesson.narration.split('\n')[0] || ''
  });

  if (concept.reference_code.trim()) {
    push({
      type: 'code',
      durationMs: ms(1.3),
      title: `${concept.name} — reference implementation`,
      subtitle: concept.reference_language ? concept.reference_language.toUpperCase() : '',
      caption: 'Read the implementation, then watch the trace below.',
      code: { language: concept.reference_language || 'text', lines: codeLines(concept), highlight: -1 }
    });
  }

  events.forEach((event, index) => {
    push({
      type: 'execution',
      durationMs: ms(1),
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
    });
  });

  push({
    type: 'complexity',
    durationMs: ms(0.9),
    title: 'Complexity',
    subtitle: concept.complexity_time,
    caption: `${concept.complexity_time}. Space: ${concept.complexity_space}.`
  });

  push({
    type: 'summary',
    durationMs: ms(1.1),
    title: lesson.key_takeaway || concept.summary,
    subtitle: concept.example_input ? `Input: ${concept.example_input}` : '',
    caption: lesson.cta || lesson.key_takeaway
  });

  push({
    type: 'brand',
    durationMs: ms(0.6),
    title: 'Visual CS Lab',
    subtitle: 'Concept → verified trace → short',
    caption: ''
  });

  return scenes;
}

export { DEFAULT_STACK_OPS };
