import assert from 'node:assert/strict';
import test from 'node:test';

import { PROFILES } from './profiles.ts';
import { assessRender, frameDifference, frameSample, parseMediaInfo } from './quality.ts';

const PROBE = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/data/media/out.mp4':
  Metadata:
    major_brand     : isom
    encoder         : Lavf60.16.100
  Duration: 00:00:20.00, start: 0.000000, bitrate: 254 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, progressive), 1080x1920 [SAR 1:1 DAR 9:16], 245 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
`;

function frame(width: number, height: number, shift: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const lit = (x + shift) % 20 < 10 && y % 6 < 3;
    const value = lit ? 226 : 18;
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function blank(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 18;
    data[i * 4 + 1] = 18;
    data[i * 4 + 2] = 18;
    data[i * 4 + 3] = 255;
  }
  return data;
}

const goodMedia = {
  container: 'mov',
  codec: 'h264',
  pixelFormat: 'yuv420p',
  width: 1080,
  height: 1920,
  durationSeconds: 20,
  hasAudio: false
};

const samples = [
  frameSample(frame(64, 114, 0), 64, 114, 2),
  frameSample(frame(64, 114, 10), 64, 114, 10),
  frameSample(frame(64, 114, 20), 64, 114, 18)
];

function baseInput() {
  return {
    profile: PROFILES.hd,
    expectedFrames: 600,
    bytes: 640_000,
    head: Buffer.from('\u0000\u0000\u0000\u0018ftypisom', 'latin1'),
    media: goodMedia,
    decodedFrames: 600,
    samples
  };
}

test('ffmpeg probe output is parsed into real media metadata', () => {
  const media = parseMediaInfo(PROBE);
  assert.ok(media);
  assert.equal(media!.codec, 'h264');
  assert.equal(media!.pixelFormat, 'yuv420p');
  assert.equal(media!.width, 1080);
  assert.equal(media!.height, 1920);
  assert.equal(media!.durationSeconds, 20);
  assert.equal(media!.hasAudio, false);
  assert.equal(media!.container, 'mov');
});

test('a probe with an audio stream is reported as not silent', () => {
  const media = parseMediaInfo(`${PROBE}  Stream #0:1[0x2]: Audio: aac (LC), 44100 Hz, stereo, fltp, 128 kb/s\n`);
  assert.equal(media?.hasAudio, true);
});

test('frame statistics tell a blank frame from content', () => {
  const empty = frameSample(blank(64, 114), 64, 114, 0);
  const content = frameSample(frame(64, 114, 0), 64, 114, 0);
  assert.ok(empty.stddev < 1);
  assert.equal(empty.inkFraction, 0);
  assert.ok(content.stddev > 40);
  assert.ok(content.inkFraction > 0.05);
});

test('identical frames compare as a still, different frames do not', () => {
  assert.equal(frameDifference(samples[0], samples[0]), 0);
  assert.ok(frameDifference(samples[0], samples[1]) > 1.5);
});

test('a valid render passes every automated check', () => {
  const validation = assessRender(baseInput());
  const failed = validation.checks.filter((check) => !check.ok);
  assert.deepEqual(failed, []);
  assert.equal(validation.ok, true);
  assert.ok(validation.humanReview.length >= 2, 'legibility and accuracy still need a human');
});

test('a blank render fails the sampled-frame check', () => {
  const validation = assessRender({
    ...baseInput(),
    samples: [
      frameSample(blank(64, 114), 64, 114, 2),
      frameSample(blank(64, 114), 64, 114, 10),
      frameSample(blank(64, 114), 64, 114, 18)
    ]
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.checks.some((check) => check.id === 'samples' && !check.ok));
});

test('a static video fails the motion check', () => {
  const still = frameSample(frame(64, 114, 0), 64, 114, 2);
  const validation = assessRender({
    ...baseInput(),
    samples: [still, { ...still, at: 10 }, { ...still, at: 18 }]
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.checks.some((check) => check.id === 'motion' && !check.ok));
});

test('a duration that misses by several frames fails', () => {
  const validation = assessRender({
    ...baseInput(),
    media: { ...goodMedia, durationSeconds: 20.5 }
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.checks.some((check) => check.id === 'duration' && !check.ok));
});

test('a frame count short of the storyboard fails', () => {
  const validation = assessRender({ ...baseInput(), decodedFrames: 598 });
  assert.equal(validation.ok, false);
  assert.ok(validation.checks.some((check) => check.id === 'frames' && !check.ok));
});

test('wrong resolution, codec or pixel format fail', () => {
  const validation = assessRender({
    ...baseInput(),
    media: { ...goodMedia, width: 1280, height: 720, codec: 'vp9', pixelFormat: 'yuv420p10le' }
  });
  assert.equal(validation.ok, false);
  for (const id of ['resolution', 'codec', 'pixel_format']) {
    assert.ok(validation.checks.some((check) => check.id === id && !check.ok), `${id} should fail`);
  }
});

test('an empty file fails before anything else is believed', () => {
  const validation = assessRender({
    ...baseInput(),
    bytes: 0,
    head: Buffer.alloc(0),
    media: null,
    decodedFrames: 0,
    samples: []
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.checks.filter((check) => !check.ok).length >= 5);
});
