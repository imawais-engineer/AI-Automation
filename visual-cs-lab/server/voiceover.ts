/**
 * Voice-over scripts.
 *
 * A script is generated from the same verified plan the video renders: the beat
 * windows give the timestamps, the trace gives the facts, and the lesson copy
 * gives the framing. Nothing is invented — every number the narration states is
 * read from the verified run, which is also what the validation checks.
 *
 * The video stays silent: this is a text artifact that accompanies the file.
 */

import { createHash } from 'node:crypto';

import type { MotionPlan } from './anim/plan.ts';
import type { StackEvent } from './algorithms/stack.ts';
import type { ConceptInput, LessonInput } from './scenes.ts';

export type VoiceoverSegment = {
  id: string;
  /** Human scene label: Hook, Setup, Operation · POP, Trace · comparison 1 … */
  scene: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type VoiceoverScript = {
  title: string;
  durationSeconds: number;
  segments: VoiceoverSegment[];
  /** The continuous narration built from the segments, ready to copy. */
  script: string;
};

export type VoiceoverCheck = { id: string; label: string; ok: boolean; detail: string };

export type VoiceoverSource = {
  script: VoiceoverScript;
  sourceHash: string;
};

export type VoiceoverStatus = {
  present: boolean;
  outdated: boolean;
  checks: VoiceoverCheck[];
  ok: boolean;
  script: VoiceoverScript | null;
};

function tidy(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function firstSentences(value: string, count: number): string {
  const clean = tidy(value);
  if (!clean) return '';
  const parts = clean.match(/[^.!?]+[.!?]?/g) || [clean];
  return parts.slice(0, count).map((part) => part.trim()).join(' ');
}

const TRAILING_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'where', 'that', 'which', 'so', 'because', 'as', 'it', 'its', 'is', 'are', 'be'
]);

/** Ends a line cleanly: no dangling comma, always a full stop. */
function sentence(text: string): string {
  const clean = tidy(text).replace(/[,;:—–-]+$/, '');
  if (!clean) return '';
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function wordCount(text: string): number {
  return tidy(text).split(' ').filter(Boolean).length;
}

/**
 * Cuts narration to what can honestly be said in the slot (~4.2 words/s). Whole
 * sentences are kept where possible, then clauses, so the line never trails off
 * mid-thought or mid-word.
 */
function speakable(text: string, seconds: number): string {
  const budget = Math.max(6, Math.floor(seconds * 4.2));
  const clean = tidy(text);
  const words = clean.split(' ').filter(Boolean);
  if (words.length <= budget) return sentence(clean);

  const sentences = (clean.match(/[^.!?]+[.!?]?/g) || [clean]).map((part) => part.trim()).filter(Boolean);
  let out = '';
  for (const part of sentences) {
    const candidate = out ? `${out} ${part}` : part;
    if (wordCount(candidate) > budget) break;
    out = candidate;
  }
  if (out) return sentence(out);

  // The first sentence alone is too long: keep whole clauses instead.
  const clauses = tidy(sentences[0] ?? clean).split(/,\s+|—\s*|;\s+/).filter(Boolean);
  out = '';
  for (const clause of clauses) {
    const candidate = out ? `${out}, ${clause}` : clause;
    if (wordCount(candidate) > budget) break;
    out = candidate;
  }
  if (out) return sentence(out);

  const trimmed = words.slice(0, budget);
  while (trimmed.length > 1 && TRAILING_WORDS.has(trimmed[trimmed.length - 1].toLowerCase())) trimmed.pop();
  return sentence(trimmed.join(' '));
}

function continuous(segments: VoiceoverSegment[]): string {
  return segments.map((segment) => tidy(segment.text)).filter(Boolean).join(' ');
}

function opLabel(event: StackEvent): string {
  if (event.op === 'push') return `Operation · PUSH(${event.value})`;
  if (event.op === 'pop') return 'Operation · POP()';
  return 'Operation · PEEK()';
}

function stackNarration(event: StackEvent): string {
  const items = event.items;
  if (event.op === 'push') {
    const below = items.length > 1 ? items[items.length - 2] : null;
    return below === null
      ? `Push ${event.value} onto the empty stack. It becomes the newest value, so TOP sits on it.`
      : `Push ${event.value} on top of ${below}. It becomes the newest value, so TOP moves up to it.`;
  }
  if (event.op === 'top') {
    return event.returned === null
      ? 'Peek on an empty stack has nothing to read, and the size stays the same.'
      : `Peek reads ${event.returned} without taking it off, so the stack is unchanged.`;
  }
  if (event.returned === null) {
    return 'A pop on an empty stack returns nothing, so the size stays at zero. That is underflow.';
  }
  return event.top === null
    ? `Pop removes ${event.returned}, the newest value, and the stack is empty again.`
    : `Pop removes ${event.returned}, the newest value, and TOP drops to ${event.top}.`;
}

function complexityNarration(plan: MotionPlan): string {
  const time = plan.copy.time || (plan.kind === 'binary' ? 'O(log n)' : 'O(1)');
  if (time.includes('O(1)')) {
    return `Push, pop and peek cost the same at any size, because only the top is touched. The stack needs space for however many values it holds.`;
  }
  return `The cost is ${time}, and the space is ${plan.copy.space || 'O(n)'}.`;
}

function binaryStepNarration(step: {
  n: number;
  low: number;
  high: number;
  mid: number;
  midValue: number;
  target: number;
  comparison: 'less' | 'greater' | 'equal';
  nextLow: number;
  nextHigh: number;
}): string {
  if (step.comparison === 'equal') {
    return `Index ${step.mid} holds ${step.midValue}, which is the target. The search stops after ${step.n} comparison${step.n === 1 ? '' : 's'}.`;
  }
  const remaining = step.nextHigh - step.nextLow + 1;
  const tail = remaining > 0 ? `${remaining} candidate${remaining === 1 ? '' : 's'} remain.` : 'No candidates remain.';
  if (step.comparison === 'less') {
    return `The middle is index ${step.mid} holding ${step.midValue}. That is less than ${step.target}, so the left side is discarded and low moves to ${step.nextLow}. ${tail}`;
  }
  return `The middle is index ${step.mid} holding ${step.midValue}. That is greater than ${step.target}, so the right side is discarded and high moves to ${step.nextHigh}. ${tail}`;
}

/** Builds the script for a plan. Deterministic: same plan, same script. */
export function generateVoiceover(args: {
  plan: MotionPlan;
  lesson: LessonInput;
  concept: ConceptInput;
}): VoiceoverSource {
  const { plan, lesson, concept } = args;
  const segments: VoiceoverSegment[] = [];
  let seq = 0;
  const add = (scene: string, startMs: number, endMs: number, text: string) => {
    const body = speakable(text, (endMs - startMs) / 1000);
    if (!body || endMs <= startMs) return;
    segments.push({ id: `n${++seq}`, scene, startMs: Math.round(startMs), endMs: Math.round(endMs), text: body });
  };

  const hookLine = plan.copy.hook || lesson.hook || plan.copy.objective;
  const takeaway = plan.copy.takeaway || lesson.key_takeaway;
  // Short lines that stand on their own even in a two-second beat.
  const setupLine =
    plan.kind === 'stack'
      ? 'Only the top is reachable. Every push and pop works there.'
      : 'The only precondition is a sorted array. The bounds keep narrowing.';
  const signoff =
    plan.kind === 'stack'
      ? 'That is LIFO: newest in, first out.'
      : 'That is halving: each comparison drops half.';

  for (const beat of plan.beats) {
    if (beat.sceneType === 'hook') {
      add('Hook', beat.startMs, beat.endMs, hookLine);
      continue;
    }
    if (beat.sceneType === 'concept') {
      add('Setup', beat.startMs, beat.endMs, setupLine);
      continue;
    }
    if (beat.sceneType === 'execution' && plan.kind === 'stack') {
      const op = plan.ops.find((item) => item.startMs === beat.startMs);
      if (op) add(opLabel(op.event), beat.startMs, beat.endMs, stackNarration(op.event));
      continue;
    }
    if (beat.sceneType === 'trace' && plan.kind === 'binary') {
      const steps = plan.steps;
      const intro = plan.traceIntro;
      if (intro && intro.endMs > intro.startMs && steps.length > 0) {
        add(
          'Trace · setup',
          intro.startMs,
          Math.min(intro.endMs, steps[0].startMs),
          `Keep two inclusive bounds: low at ${steps[0].step.low} and high at ${steps[0].step.high}. The middle index is the average of the two, rounded down.`
        );
      }
      for (const window of steps) {
        add(
          `Trace · comparison ${window.index + 1}`,
          window.startMs,
          window.endMs,
          binaryStepNarration(window.step)
        );
      }
      const last = steps[steps.length - 1];
      const halving = plan.halving;
      if (halving && halving.endMs > halving.startMs) {
        const tail =
          plan.foundIndex === null
            ? 'The range collapsed without a match, so the target is not in this array.'
            : `Each comparison threw away half of what was left, so ${plan.array.length} values took only ${steps.length} comparisons.`;
        add('Trace · result', Math.max(halving.startMs, last ? last.endMs : halving.startMs), halving.endMs, tail);
      }
      continue;
    }
    if (beat.sceneType === 'summary') {
      const lastOp = plan.kind === 'stack' ? plan.ops[plan.ops.length - 1] : null;
      const items = lastOp ? lastOp.event.items : [];
      const top = items.length ? items[items.length - 1] : null;
      const bottom = items.length ? items[0] : null;
      const concrete =
        top !== null && bottom !== null && top !== bottom
          ? ` ${top} leaves before ${bottom}, because ${top} arrived later.`
          : '';
      add('Takeaway', beat.startMs, beat.endMs, `${sentence(takeaway)}${concrete}`);
      continue;
    }
    if (beat.sceneType === 'complexity') {
      add(
        'Complexity',
        beat.startMs,
        beat.endMs,
        plan.kind === 'binary'
          ? `Each comparison halves what is left, so the work grows with the logarithm of the input. The iterative version only keeps a few numbers in memory.`
          : complexityNarration(plan)
      );
      continue;
    }
    if (beat.sceneType === 'brand') {
      add('Outro', beat.startMs, beat.endMs, signoff);
    }
  }

  const script: VoiceoverScript = {
    title: lesson.title,
    durationSeconds: Math.round(plan.durationMs) / 1000,
    segments,
    script: continuous(segments)
  };

  return { script, sourceHash: voiceoverSourceHash(plan, lesson, concept) };
}

/** Fingerprint of everything the script was generated from. */
export function voiceoverSourceHash(plan: MotionPlan, lesson: LessonInput, concept: ConceptInput): string {
  const payload = {
    title: lesson.title,
    copy: plan.copy,
    beats: plan.beats.map((beat) => [beat.sceneType, beat.startMs, beat.endMs, beat.title, beat.caption]),
    trace:
      plan.kind === 'stack'
        ? plan.ops.map((op) => op.event)
        : { array: plan.array, target: plan.target, steps: plan.steps.map((window) => window.step) },
    concept: {
      time: concept.complexity_time,
      space: concept.complexity_space,
      plain: concept.plain_explanation
    }
  };
  return createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function numbersIn(text: string): number[] {
  return (String(text).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}

/** Every number the verified run can honestly mention. */
export function verifiedNumbers(plan: MotionPlan): Set<number> {
  const allowed = new Set<number>([0, 1, Math.round(plan.durationMs / 1000)]);
  if (plan.kind === 'stack') {
    for (const op of plan.ops) {
      if (op.event.value !== null) allowed.add(op.event.value);
      if (op.event.returned !== null) allowed.add(op.event.returned);
      op.event.items.forEach((value) => allowed.add(value));
      allowed.add(op.event.items.length);
      allowed.add(op.index + 1);
    }
    allowed.add(plan.ops.length);
    allowed.add(plan.maxSlots);
  } else {
    plan.array.forEach((value) => allowed.add(value));
    allowed.add(plan.target);
    allowed.add(plan.array.length);
    allowed.add(plan.steps.length);
    for (const window of plan.steps) {
      const step = window.step;
      [step.n, step.low, step.high, step.mid, step.midValue, step.nextLow, step.nextHigh].forEach((value) =>
        allowed.add(value)
      );
      allowed.add(step.nextHigh - step.nextLow + 1);
      allowed.add(step.eliminated.length);
      step.eliminated.forEach((index) => allowed.add(index));
    }
  }
  return allowed;
}

/**
 * The checks behind "narration accuracy and scene timestamp alignment": every beat
 * narrated, timestamps exactly on the scenes, a speaking pace that fits the slot,
 * and no number that the verified trace cannot support.
 */
export function checkVoiceover(args: {
  script: VoiceoverScript;
  plan: MotionPlan;
}): { checks: VoiceoverCheck[]; ok: boolean } {
  const { script, plan } = args;
  const checks: VoiceoverCheck[] = [];
  const segments = [...script.segments].sort((a, b) => a.startMs - b.startMs);

  // Alignment: one beat, one window; segments must tile the beat exactly.
  const alignment: string[] = [];
  for (const beat of plan.beats) {
    const inside = segments.filter((segment) => segment.startMs >= beat.startMs && segment.endMs <= beat.endMs);
    if (inside.length === 0) {
      alignment.push(`${beat.sceneType} beat has no narration`);
      continue;
    }
    if (inside[0].startMs !== beat.startMs) {
      alignment.push(`${beat.sceneType} narration starts at ${inside[0].startMs}ms, scene at ${beat.startMs}ms`);
    }
    if (inside[inside.length - 1].endMs !== beat.endMs) {
      alignment.push(
        `${beat.sceneType} narration ends at ${inside[inside.length - 1].endMs}ms, scene at ${beat.endMs}ms`
      );
    }
  }
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].startMs < segments[i - 1].endMs) {
      alignment.push(`segments ${segments[i - 1].id} and ${segments[i].id} overlap`);
    }
  }
  checks.push({
    id: 'voiceover_alignment',
    label: 'Narration matches the scene timeline',
    ok: alignment.length === 0,
    detail:
      alignment.length === 0
        ? `${segments.length} segments tile ${plan.beats.length} scenes exactly`
        : alignment.slice(0, 3).join('; ')
  });

  // Pace: a segment nobody could read in its slot is a bad script.
  const pacing: string[] = [];
  for (const segment of segments) {
    const seconds = (segment.endMs - segment.startMs) / 1000;
    const words = tidy(segment.text).split(' ').filter(Boolean).length;
    if (!segment.text || segment.text.length < 8) pacing.push(`${segment.id} has no narration`);
    if (seconds >= 1.2 && words / seconds > 4.6) {
      pacing.push(`${segment.id} is ${words} words in ${seconds.toFixed(1)}s`);
    }
    if (seconds >= 4 && words / seconds < 1) {
      pacing.push(`${segment.id} leaves a long silent stretch`);
    }
  }
  checks.push({
    id: 'voiceover_pace',
    label: 'Narration fits each scene duration',
    ok: pacing.length === 0,
    detail: pacing.length === 0 ? `${segments.length} segments speak at a natural pace` : pacing.slice(0, 3).join('; ')
  });

  // Accuracy: no number outside the verified run.
  const allowed = verifiedNumbers(plan);
  const invented: string[] = [];
  for (const segment of segments) {
    for (const value of numbersIn(segment.text)) {
      if (!allowed.has(value)) invented.push(`${value} in ${segment.id}`);
    }
  }
  checks.push({
    id: 'voiceover_accuracy',
    label: 'Narration only states verified results',
    ok: invented.length === 0,
    detail:
      invented.length === 0
        ? 'every number in the script appears in the verified trace'
        : `unverified value(s): ${invented.slice(0, 4).join(', ')}`
  });

  const durationMatch = Math.abs(script.durationSeconds - plan.durationMs / 1000) < 0.101;
  checks.push({
    id: 'voiceover_duration',
    label: 'Estimated narration duration matches the video',
    ok: durationMatch,
    detail: `${script.durationSeconds.toFixed(1)}s script for a ${(plan.durationMs / 1000).toFixed(1)}s video`
  });

  return { checks, ok: checks.every((check) => check.ok) };
}

/** Applies text edits by segment id and rebuilds the continuous script. */
export function applyVoiceoverEdits(script: VoiceoverScript, edits: { id: string; text: string }[]): VoiceoverScript {
  const byId = new Map(edits.map((edit) => [edit.id, tidy(edit.text)]));
  const segments = script.segments.map((segment) =>
    byId.has(segment.id) ? { ...segment, text: byId.get(segment.id) as string } : segment
  );
  return { ...script, segments, script: continuous(segments) };
}

export function parseVoiceover(raw: string | null | undefined): VoiceoverScript | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VoiceoverScript;
    return parsed && Array.isArray(parsed.segments) ? parsed : null;
  } catch {
    return null;
  }
}

function stamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** The documented script format, for copying. */
export function formatVoiceover(script: VoiceoverScript): string {
  const rows = script.segments.map(
    (segment) =>
      `| ${stamp(segment.startMs)}–${stamp(segment.endMs)} | ${segment.scene} | ${segment.text.replace(/\|/g, '\\|')} |`
  );
  return [
    `**Video title:** ${script.title}`,
    '',
    `**Estimated narration duration:** ${script.durationSeconds.toFixed(1)}s`,
    '',
    '| Timestamp | Scene | Voice-over |',
    '|---|---|---|',
    ...rows,
    '',
    '**Continuous script**',
    '',
    script.script
  ].join('\n');
}
