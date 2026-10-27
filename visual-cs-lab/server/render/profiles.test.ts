import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocateFrames,
  durationToleranceSeconds,
  evenDimension,
  framesToSeconds,
  PROFILES,
  totalFrames
} from './profiles.ts';

const PLAN = [2500, 3500, 7000, 4000, 3000];

test('the 20 second plan is exactly 600 frames at 30 fps', () => {
  assert.deepEqual(allocateFrames(PLAN, 30), [75, 105, 210, 120, 90]);
  assert.equal(
    allocateFrames(PLAN, 30).reduce((sum, frames) => sum + frames, 0),
    600
  );
});

test('frame allocation always matches the storyboard total, for every lesson length', () => {
  for (const seconds of [10, 20, 30, 45, 60]) {
    const totalMs = seconds * 1000;
    const durations = PLAN.map((ms) => (ms * seconds) / 20);
    const frames = allocateFrames(durations, 30);
    assert.equal(
      frames.reduce((sum, value) => sum + value, 0),
      totalFrames(totalMs, 30),
      `${seconds}s lesson should add up to ${totalFrames(totalMs, 30)} frames`
    );
    assert.ok(frames.every((value) => value >= 1), 'every scene keeps at least one frame');
    assert.equal(framesToSeconds(frames.reduce((sum, value) => sum + value, 0), 30), seconds);
  }
});

test('uneven durations do not lose a frame to rounding', () => {
  const frames = allocateFrames([1000, 1000, 1000], 30);
  assert.deepEqual(frames, [30, 30, 30]);
  const odd = allocateFrames([333, 333, 334], 30);
  assert.equal(
    odd.reduce((sum, value) => sum + value, 0),
    30
  );
});

test('every profile is vertical, even and 30 fps', () => {
  for (const profile of Object.values(PROFILES)) {
    assert.equal(profile.width % 2, 0);
    assert.equal(profile.height % 2, 0);
    assert.equal(profile.fps, 30);
    assert.ok(profile.height > profile.width, 'vertical 9:16 composition');
    assert.equal(evenDimension(profile.width), profile.width);
  }
  assert.deepEqual(
    [PROFILES.preview.width, PROFILES.preview.height],
    [540, 960]
  );
  assert.deepEqual([PROFILES.hd.width, PROFILES.hd.height], [1080, 1920]);
  assert.deepEqual([PROFILES['4k'].width, PROFILES['4k'].height], [2160, 3840]);
});

test('duration tolerance is at most one frame', () => {
  assert.ok(durationToleranceSeconds(30) <= 2 / 30 + 0.01);
  assert.ok(durationToleranceSeconds(30) < 0.1);
});
