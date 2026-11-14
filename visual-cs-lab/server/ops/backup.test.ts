/**
 * Backup and restore tests, run entirely inside a temporary directory.
 *
 * The fixture is a small but realistic data tree: a SQLite database with a
 * foreign key, finished renders, narration takes, thumbnails, a scene-clip cache
 * and a leftover partial encode. The suite proves the properties the operations
 * document promises: a consistent snapshot, atomic creation, verifiable
 * integrity, retention that only touches its own directories, and a restore that
 * refuses to overwrite anything unless told to.
 *
 * No production path is used: DATA_DIR/MEDIA_DIR are ignored here on purpose,
 * every call passes explicit directories.
 */

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  BackupError,
  createBackup,
  listBackups,
  restoreBackup,
  verifyBackup
} from './backup.ts';

const root = mkdtempSync(path.join(tmpdir(), 'vcsl-backup-'));
const dataDir = path.join(root, 'data');
const mediaDir = path.join(dataDir, 'media');
const outDir = path.join(root, 'backups');

function buildFixture(): void {
  mkdirSync(path.join(mediaDir, 'narration'), { recursive: true });
  mkdirSync(path.join(mediaDir, 'thumbnails'), { recursive: true });
  mkdirSync(path.join(mediaDir, 'clips'), { recursive: true });
  mkdirSync(path.join(mediaDir, 'variants'), { recursive: true });

  const db = new Database(path.join(dataDir, 'lab.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE lessons (id TEXT PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE video_assets (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL
    );
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
  `);
  db.prepare('INSERT INTO lessons (id, title) VALUES (?, ?)').run('lesson-1', 'Stacks');
  db.prepare('INSERT INTO lessons (id, title) VALUES (?, ?)').run('lesson-2', 'Queues');
  db.prepare('INSERT INTO video_assets (id, lesson_id, file_path) VALUES (?, ?, ?)').run(
    'asset-1',
    'lesson-1',
    path.join(mediaDir, 'render-1.mp4')
  );
  db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('user-1', 'admin@visual-cs.local');
  db.close();

  writeFileSync(path.join(mediaDir, 'render-1.mp4'), Buffer.alloc(64 * 1024, 7));
  writeFileSync(path.join(mediaDir, 'narration', 'lesson-1.mp3'), Buffer.alloc(8 * 1024, 3));
  writeFileSync(path.join(mediaDir, 'thumbnails', 'lesson-1.png'), Buffer.alloc(2 * 1024, 5));
  writeFileSync(path.join(mediaDir, 'variants', 'lesson-1-voice.mp4'), Buffer.alloc(16 * 1024, 9));
  // Must never be part of a backup: a cache and a half-written encode.
  writeFileSync(path.join(mediaDir, 'clips', 'scene-0.mp4'), Buffer.alloc(1024, 1));
  writeFileSync(path.join(mediaDir, 'render-2.partial.mp4'), Buffer.alloc(512, 2));
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

test('the fixture data tree is built once', () => {
  buildFixture();
  assert.ok(existsSync(path.join(dataDir, 'lab.db')));
  assert.ok(existsSync(path.join(mediaDir, 'render-1.mp4')));
});

test('a backup is created atomically with a consistent, verified snapshot', async () => {
  const sourceDbHash = sha256(path.join(dataDir, 'lab.db'));
  const result = await createBackup({
    dataDir,
    mediaDir,
    outDir,
    media: 'metadata',
    keep: 7,
    env: {},
    now: new Date('2026-02-01T00:00:01Z')
  });

  assert.equal(existsSync(path.join(result.dir, 'lab.db')), true);
  assert.equal(existsSync(path.join(result.dir, 'manifest.json')), true);
  // The snapshot is a SQLite file that passes its own integrity check.
  assert.equal(result.manifest.database.integrity, 'ok');
  assert.equal(result.manifest.database.foreignKeyViolations, 0);
  assert.equal(result.manifest.database.tables.lessons, 2);
  assert.equal(result.manifest.database.tables.video_assets, 1);
  assert.equal(result.manifest.database.tables.users, 1);

  // Media is recorded, not copied, in metadata mode — and the cache is not tracked.
  const paths = result.manifest.media.files.map((entry) => entry.path);
  assert.deepEqual(paths.sort(), [
    'narration/lesson-1.mp3',
    'render-1.mp4',
    'thumbnails/lesson-1.png',
    'variants/lesson-1-voice.mp4'
  ]);
  assert.ok(result.manifest.media.skipped.some((entry) => entry.startsWith('clips')));
  assert.ok(result.manifest.media.skipped.includes('render-2.partial.mp4'));
  assert.equal(result.manifest.media.mode, 'metadata');

  // Configuration is recorded by name only.
  assert.deepEqual(result.manifest.runtime.requiredConfiguration.includes('DATA_DIR'), true);
  assert.equal(JSON.stringify(result.manifest).includes('DEEPGRAM_API_KEY='), false);

  // Atomic creation leaves no working directory behind.
  const leftovers = readdirSync(outDir).filter((entry) => entry.startsWith('.tmp-'));
  assert.deepEqual(leftovers, []);

  // The live database was only read.
  assert.equal(sha256(path.join(dataDir, 'lab.db')), sourceDbHash);

  const verified = await verifyBackup(result.dir);
  assert.equal(verified.ok, true, verified.issues.join('; '));
});

test('verification catches a damaged database snapshot', async () => {
  const result = await createBackup({
    dataDir,
    mediaDir,
    outDir,
    media: 'metadata',
    keep: 7,
    env: {},
    now: new Date('2026-02-01T00:00:02Z')
  });
  const damaged = path.join(root, 'damaged-db');
  rmSync(damaged, { recursive: true, force: true });
  mkdirSync(damaged, { recursive: true });
  writeFileSync(path.join(damaged, 'manifest.json'), readFileSync(path.join(result.dir, 'manifest.json')));
  writeFileSync(path.join(damaged, 'lab.db'), Buffer.from('this is not a sqlite database'));

  const verified = await verifyBackup(damaged);
  assert.equal(verified.ok, false);
  assert.ok(verified.issues.length > 0);
  assert.ok(
    verified.issues.some((issue) => /hash|SQLite|integrity/.test(issue)),
    `expected a hash or integrity complaint, got: ${verified.issues.join(' | ')}`
  );
});

test('an interrupted backup is not mistaken for a complete one', async () => {
  const partial = path.join(outDir, 'vcsl-19990101-000000');
  mkdirSync(partial, { recursive: true });
  writeFileSync(path.join(partial, 'lab.db'), Buffer.alloc(1024, 0));

  const verified = await verifyBackup(partial);
  assert.equal(verified.ok, false);
  assert.match(verified.issues.join(' '), /manifest\.json is missing/);

  const listed = listBackups(outDir);
  assert.ok(
    listed.some((entry) => entry.dir === partial && entry.createdAt === ''),
    'a directory without a manifest is listed as incomplete'
  );
});

test('a restore runs against a disposable copy and reports the restored rows', async () => {
  const result = await createBackup({
    dataDir,
    mediaDir,
    outDir,
    media: 'full',
    keep: 7,
    env: {},
    now: new Date('2026-02-01T00:00:05Z')
  });

  // Full mode copies the media bytes, minus the cache and the partial encode.
  assert.equal(existsSync(path.join(result.dir, 'media', 'render-1.mp4')), true);
  assert.equal(existsSync(path.join(result.dir, 'media', 'narration', 'lesson-1.mp3')), true);
  assert.equal(existsSync(path.join(result.dir, 'media', 'clips', 'scene-0.mp4')), false);
  assert.equal(existsSync(path.join(result.dir, 'media', 'render-2.partial.mp4')), false);

  const target = path.join(root, 'restore-target');
  const restored = await restoreBackup(result.dir, target);
  assert.equal(restored.integrity, 'ok');
  assert.equal(restored.counts.lessons, 2);
  assert.equal(restored.counts.video_assets, 1);
  assert.equal(restored.counts.users, 1);
  assert.equal(existsSync(path.join(target, 'media', 'render-1.mp4')), true);

  // The restored database is a usable copy: the foreign key still resolves.
  const db = new Database(path.join(target, 'lab.db'), { readonly: true });
  try {
    const joined = db
      .prepare('SELECT lessons.title FROM video_assets JOIN lessons ON lessons.id = video_assets.lesson_id')
      .get() as { title: string };
    assert.equal(joined.title, 'Stacks');
  } finally {
    db.close();
  }
});

test('restoring refuses an existing target and any unverified backup', async () => {
  const result = await createBackup({
    dataDir,
    mediaDir,
    outDir,
    media: 'metadata',
    keep: 7,
    env: {},
    now: new Date('2026-02-01T00:00:06Z')
  });
  const target = path.join(root, 'restore-target'); // created by the previous test
  assert.ok(statSync(target).isDirectory());

  await assert.rejects(() => restoreBackup(result.dir, target), BackupError);
  const forced = await restoreBackup(result.dir, target, { force: true });
  assert.equal(forced.counts.lessons, 2);

  const damaged = path.join(root, 'damaged-db');
  await assert.rejects(() => restoreBackup(damaged, path.join(root, 'never-created')), BackupError);
  assert.equal(existsSync(path.join(root, 'never-created')), false);
});

test('retention keeps the newest sets and touches nothing it did not create', async () => {
  const retentionRoot = path.join(root, 'retention');
  mkdirSync(retentionRoot, { recursive: true });
  const decoy = path.join(retentionRoot, 'notes');
  mkdirSync(decoy);
  writeFileSync(path.join(decoy, 'keep-me.txt'), 'unrelated file');

  const stamps = [
    new Date('2026-01-01T10:00:00Z'),
    new Date('2026-01-02T10:00:00Z'),
    new Date('2026-01-03T10:00:00Z')
  ];
  const created: string[] = [];
  for (const now of stamps) {
    const result = await createBackup({ dataDir, mediaDir, outDir: retentionRoot, media: 'skip', keep: 2, env: {}, now });
    created.push(result.dir);
  }

  assert.equal(existsSync(created[0]), false, 'the oldest set is removed by retention');
  assert.equal(existsSync(created[1]), true);
  assert.equal(existsSync(created[2]), true);
  assert.equal(existsSync(path.join(decoy, 'keep-me.txt')), true, 'unrelated directories are never deleted');
});

test('verification catches damaged media in a full backup', async () => {
  const result = await createBackup({
    dataDir,
    mediaDir,
    outDir,
    media: 'full',
    keep: 7,
    env: {},
    now: new Date('2026-02-01T00:00:08Z')
  });
  writeFileSync(path.join(result.dir, 'media', 'render-1.mp4'), Buffer.alloc(64 * 1024, 0));

  const verified = await verifyBackup(result.dir);
  assert.equal(verified.ok, false);
  assert.ok(
    verified.issues.some((issue) => /media hash mismatch: render-1\.mp4/.test(issue)),
    `expected a media hash complaint, got: ${verified.issues.join(' | ')}`
  );
});

test('backup refuses to run without a database or with itself as the target', async () => {
  await assert.rejects(
    () => createBackup({ dataDir: path.join(root, 'empty'), mediaDir, outDir, env: {} }),
    BackupError
  );
  await assert.rejects(() => createBackup({ dataDir, mediaDir, outDir: dataDir, env: {} }), BackupError);
});
