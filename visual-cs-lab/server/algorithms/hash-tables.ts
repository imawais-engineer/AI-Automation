/**
 * Hash table operations: the verified trace behind the Hash Tables short.
 *
 * The hash is deliberately the simplest honest one — `key mod bucketCount` —
 * because the lesson is about what a hash function buys you, not about a
 * cryptographic digest. Collisions are resolved by chaining, and the trace
 * records the bucket the key mapped to and how many keys had to be compared to
 * find it, so the animation can only show lookups that really happened.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type HashOp = { op: 'put'; key: number } | { op: 'get'; key: number };

export type HashStep = {
  /** 1-based operation number. */
  n: number;
  op: HashOp['op'];
  key: number;
  /** The bucket the hash function chose. */
  bucket: number;
  /** The chain in that bucket for this operation. */
  chain: number[];
  /** Where the key sits in the chain, or null when a lookup missed. */
  slot: number | null;
  /** Keys compared to find the slot (a miss compares the whole chain). */
  probes: number;
  found: boolean | null;
  /** Every bucket after the operation, collision chains included. */
  buckets: number[][];
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type HashTrace = {
  size: number;
  buckets: number[][];
  steps: HashStep[];
  keys: number[];
  found: number | null;
  probes: number;
  collisions: number;
};

export type HashExpectation = {
  found?: number | null;
  bucket?: number;
  probes?: number;
};

export type HashConfig = {
  kind: 'hash-table';
  size: number;
  ops: HashOp[];
  expect?: HashExpectation;
};

export function isHashConfig(config: unknown): config is HashConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'hash-table' && Array.isArray(record.ops);
}

/** A non-negative bucket index, so negative keys stay inside the table. */
export function hashBucket(key: number, size: number): number {
  const buckets = Math.max(1, Math.round(Number(size) || 1));
  return ((Math.round(Number(key) || 0) % buckets) + buckets) % buckets;
}

export function parseHashOps(raw: unknown): HashOp[] {
  if (!Array.isArray(raw)) return [];
  const ops: HashOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const op = String(record.op || '').toLowerCase();
    const key = Number(record.key);
    if (!Number.isFinite(key)) continue;
    if (op === 'put' || op === 'get') ops.push({ op, key } as HashOp);
  }
  return ops;
}

export function parseHashSize(raw: unknown): number {
  const value = Math.round(Number(raw));
  if (!Number.isFinite(value)) return 5;
  return Math.max(2, Math.min(6, value));
}

function describe(items: number[]): string {
  return items.length === 0 ? 'empty' : `[${items.join(', ')}]`;
}

function probeSentence(chain: number[], slot: number | null): string {
  if (chain.length === 0) return 'the bucket is empty';
  if (slot === null) return `compare ${chain.join(', ')} — none match`;
  return `compare ${chain.slice(0, slot + 1).join(', ')} — match at position ${slot + 1}`;
}

/** Inserts and looks up keys with chaining, recording every bucket state. */
export function traceHashTable(input: { size: number; ops: HashOp[] }): HashTrace {
  const size = parseHashSize(input.size);
  const ops = parseHashOps(input.ops);
  const buckets: number[][] = Array.from({ length: size }, () => []);
  const steps: HashStep[] = [];
  const keys: number[] = [];
  let found: number | null = null;
  let probes = 0;
  let collisions = 0;

  const snapshot = () => buckets.map((bucket) => [...bucket]);

  ops.forEach((operation, index) => {
    const n = index + 1;
    const bucket = hashBucket(operation.key, size);

    if (operation.op === 'put') {
      const chain = buckets[bucket];
      const collision = chain.length > 0;
      if (collision) collisions += 1;
      chain.push(operation.key);
      if (!keys.includes(operation.key)) keys.push(operation.key);
      steps.push({
        n,
        op: 'put',
        key: operation.key,
        bucket,
        chain: [...chain],
        slot: chain.length - 1,
        probes: chain.length - 1,
        found: null,
        buckets: snapshot(),
        message: collision
          ? `${operation.key} mod ${size} = ${bucket} — bucket ${bucket} already holds ${describe(chain.slice(0, -1))}, so ${operation.key} chains behind it.`
          : `${operation.key} mod ${size} = ${bucket} — bucket ${bucket} is free, so ${operation.key} takes the first slot.`,
        hudLabel: `PUT ${operation.key} · h = ${bucket}`,
        hudDetail: collision
          ? `collision · bucket ${bucket} now holds ${describe(chain)}`
          : `bucket ${bucket} · one step, no searching`
      });
      return;
    }

    const chain = buckets[bucket];
    const slot = chain.indexOf(operation.key);
    const compared = slot >= 0 ? slot + 1 : chain.length;
    probes += compared;
    if (slot >= 0) found = operation.key;
    steps.push({
      n,
      op: 'get',
      key: operation.key,
      bucket,
      chain: [...chain],
      slot: slot >= 0 ? slot : null,
      probes: compared,
      found: slot >= 0,
      buckets: snapshot(),
      message:
        slot >= 0
          ? `${operation.key} mod ${size} = ${bucket} — ${probeSentence(chain, slot)}.`
          : `${operation.key} mod ${size} = ${bucket} — ${probeSentence(chain, null)}; the key is not stored.`,
      hudLabel: slot >= 0 ? `GET ${operation.key} · found` : `GET ${operation.key} · miss`,
      hudDetail:
        slot >= 0
          ? `bucket ${bucket} ${describe(chain)} · ${compared} comparison${compared === 1 ? '' : 's'}`
          : `bucket ${bucket} ${describe(chain)} · ${compared} comparison${compared === 1 ? '' : 's'}`
    });
  });

  return { size, buckets: snapshot(), steps, keys, found, probes, collisions };
}

/**
 * Proves the trace is a real chained-hash-table run: an independent replay has to
 * agree with every bucket snapshot, chain, slot and probe count.
 */
export function validateHashTrace(trace: HashTrace, expectation: HashExpectation | undefined): Validation {
  const failures: string[] = [];
  const size = parseHashSize(trace.size);
  const ops = parseHashOps(trace.steps.map((step) => ({ op: step.op, key: step.key })));

  if (ops.length === 0) return { ok: false, failures: ['The table has no operations to trace.'] };
  if (trace.steps.length !== ops.length) {
    failures.push(`The trace has ${trace.steps.length} steps but ${ops.length} operations were given.`);
  }

  const reference: number[][] = Array.from({ length: size }, () => []);
  let lastSlot: number | null = null;
  let lastProbes = 0;
  let lastFound: boolean | null = null;
  let lastBucket = 0;

  ops.forEach((operation, index) => {
    const bucket = hashBucket(operation.key, size);
    const chain = reference[bucket];
    let slot: number | null = null;
    if (operation.op === 'put') {
      slot = chain.length;
      chain.push(operation.key);
      lastSlot = slot;
      lastProbes = chain.length - 1;
      lastFound = null;
    } else {
      const at = chain.indexOf(operation.key);
      slot = at >= 0 ? at : null;
      lastSlot = slot;
      lastProbes = slot === null ? chain.length : slot + 1;
      lastFound = slot !== null;
    }
    lastBucket = bucket;

    const step = trace.steps[index];
    if (!step) return;
    if (step.bucket !== bucket) {
      failures.push(`Step ${index + 1} hashes ${operation.key} to bucket ${step.bucket} where ${operation.key} mod ${size} is ${bucket}.`);
    }
    if (step.buckets.map((item) => item.join(',')).join('|') !== reference.map((item) => item.join(',')).join('|')) {
      failures.push(`Step ${index + 1} shows buckets that do not match the inserted keys.`);
    }
    if ((step.slot ?? null) !== lastSlot) {
      failures.push(`Step ${index + 1} places ${operation.key} in slot ${String(step.slot)} where it belongs in ${String(lastSlot)}.`);
    }
    if (step.probes !== lastProbes) {
      failures.push(`Step ${index + 1} claims ${step.probes} probes where the chain needs ${lastProbes}.`);
    }
    if (step.found !== lastFound) {
      failures.push(`Step ${index + 1} reports ${String(step.found)} where the lookup ${lastFound ? 'finds' : 'misses'} the key.`);
    }
  });

  const finalBuckets = trace.buckets.map((bucket) => bucket.join(',')).join('|');
  const referenceBuckets = reference.map((bucket) => bucket.join(',')).join('|');
  if (finalBuckets !== referenceBuckets) {
    failures.push('The final table does not match the keys the operations inserted.');
  }

  const lastStep = trace.steps[trace.steps.length - 1];
  const foundKey = lastFound ? lastStep?.key ?? null : null;
  if (expectation?.found !== undefined && expectation.found !== foundKey) {
    failures.push(
      `The last lookup ${expectation.found === null ? 'should miss' : `should find ${expectation.found}`} but the table returned ${String(foundKey)}.`
    );
  }
  if (expectation?.bucket !== undefined && expectation.bucket !== lastBucket) {
    failures.push(`The last key hashes to bucket ${lastBucket} where ${expectation.bucket} was expected.`);
  }
  if (expectation?.probes !== undefined && expectation.probes !== lastProbes) {
    failures.push(`The last lookup needs ${lastProbes} probes where ${expectation.probes} was expected.`);
  }

  return { ok: failures.length === 0, failures };
}
