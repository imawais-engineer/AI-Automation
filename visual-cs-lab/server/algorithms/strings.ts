/**
 * Strings: the verified character scan behind the Strings short.
 *
 * A string is an array of characters, so indexing is O(1) and one scan is O(n).
 * The trace walks the text left to right, marks every vowel as it finds one and
 * records the running vowel and consonant counts. `validateStringsTrace` replays
 * the same scan on a plain string, so the animation can only highlight the
 * character the scan really read.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';
import type { StepsMeta, StepsStep, StepsTrace } from './steps.ts';

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

export type StringsConfig = {
  kind: 'strings';
  text: string;
  expect?: { vowels?: number; consonants?: number; length?: number };
};

export function isStringsConfig(config: unknown): config is StringsConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'strings' && typeof record.text === 'string';
}

export function traceStrings(config: { text: string }): StepsTrace {
  const chars = [...config.text];
  const steps: StepsStep[] = [];
  let vowels = 0;
  let consonants = 0;

  chars.forEach((char, index) => {
    const lower = char.toLowerCase();
    const isVowel = VOWELS.has(lower);
    if (isVowel) vowels += 1;
    else consonants += 1;
    const scanned = index + 1;
    steps.push({
      n: scanned,
      rows: [
        {
          label: 'text',
          cells: chars,
          active: [index],
          done: chars.map((_, i) => i).filter((i) => i < index && VOWELS.has(chars[i].toLowerCase()))
        }
      ],
      pointers: [{ index, label: `i = ${index}`, place: 'above' }],
      message: `${char} at index ${index} is a ${isVowel ? 'vowel' : 'consonant'} — ${vowels} vowel${
        vowels === 1 ? '' : 's'
      } in ${scanned} character${scanned === 1 ? '' : 's'}.`,
      hudLabel: `text[${index}] = ${char} · ${isVowel ? 'VOWEL' : 'consonant'}`,
      hudDetail: `${scanned} of ${chars.length} scanned · ${vowels} vowel${vowels === 1 ? '' : 's'}`
    });
  });

  const meta: StepsMeta = {
    label: 'STRING SCAN',
    kickers: ['characters', 'one pass'],
    facts: [
      { label: 'Index', value: 'O(1)' },
      { label: 'Scan', value: 'O(n)' },
      { label: 'Space', value: 'O(1)' }
    ],
    result: { title: `${vowels} vowels`, sub: `“${config.text}” · ${chars.length} characters, one pass` },
    holdCaption: 'A string is an array of characters: index it in O(1), scan it in O(n).',
    complexity: { time: 'O(n)', space: 'O(1)' },
    copy: {
      hook: 'Text is just an array of characters.',
      setupTitle: 'Characters are cells',
      setupCaption: 'text[0] is the first character and text[n-1] the last — the same index arithmetic an array uses.',
      traceTitle: `Trace · ${chars.length} characters, one left-to-right pass`,
      traceSubtitle: 'read text[i] · test it · move i right',
      traceCaption: 'One pass reads every character exactly once, so counting is O(n) time and O(1) extra space.',
      complexityTitle: 'One pass, O(n)',
      complexityCaption: `${chars.length} characters read once — O(n) time. Only two counters are kept — O(1) space.`
    }
  };

  return { steps, meta };
}

/** Replays the scan on the plain string and compares it with the recorded steps. */
export function validateStringsTrace(trace: StepsTrace, expect?: StringsConfig['expect']): Validation {
  const failures: string[] = [];
  const first = trace.steps[0];
  const chars = first ? [...first.rows[0].cells] : [];
  if (trace.steps.length !== chars.length) {
    failures.push(`the trace has ${trace.steps.length} steps for ${chars.length} characters`);
  }

  let vowels = 0;
  let consonants = 0;
  trace.steps.forEach((step, index) => {
    const char = chars[index];
    if (step.rows[0].cells[index] !== char) failures.push(`step ${index + 1} reads the wrong cell`);
    if (step.rows[0].active?.[0] !== index) failures.push(`step ${index + 1} points at cell ${step.rows[0].active?.[0]}`);
    if (VOWELS.has(String(char).toLowerCase())) vowels += 1;
    else consonants += 1;
  });

  if (expect?.vowels !== undefined && expect.vowels !== vowels) {
    failures.push(`expected ${expect.vowels} vowels, the scan counts ${vowels}`);
  }
  if (expect?.consonants !== undefined && expect.consonants !== consonants) {
    failures.push(`expected ${expect.consonants} consonants, the scan counts ${consonants}`);
  }
  if (expect?.length !== undefined && expect.length !== chars.length) {
    failures.push(`expected ${expect.length} characters, the trace carries ${chars.length}`);
  }
  if (!trace.meta.result.title.startsWith(String(vowels))) {
    failures.push(`the result line says “${trace.meta.result.title}” but the scan found ${vowels} vowels`);
  }

  return { ok: failures.length === 0, failures: failures.slice(0, 4) };
}
