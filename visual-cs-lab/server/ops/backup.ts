/**
 * Backup, verification and restore for the Visual CS Lab data directory.
 *
 * What has to survive a lost container:
 *   DATA_DIR/lab.db        — concepts, lessons, render metadata, users, progress
 *   MEDIA_DIR/*.mp4        — finished renders (the only copy of the videos)
 *   MEDIA_DIR/narration    — recorded narration takes
 *   MEDIA_DIR/thumbnails   — poster frames used by the learning pages
 *   MEDIA_DIR/variants     — audio-variant masters (remux sources)
 *   MEDIA_DIR/clips        — regenerable scene previews (cache, never backed up)
 *   runtime configuration  — DATA_DIR, MEDIA_DIR and provider keys: recorded by
 *                            NAME only; the values stay in the secret store
 *
 * A backup is built in a hidden temporary directory and renamed into place only
 * after the database snapshot and the manifest are complete, so an interrupted
 * run never leaves something that looks like a finished backup. The database
 * copy itself is taken through SQLite's online backup API, which produces a
 * transactionally consistent file while the app keeps writing (WAL mode).
 *
 * This module never deletes or overwrites the live data directory: the only
 * directories it removes are the retention candidates inside the backup root.
 * Restoring writes to a caller-supplied target directory.
 */

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';

export const BACKUP_VERSION = 1;
const MANIFEST = 'manifest.json';
const DB_FILE = 'lab.db';
/** Regenerable from the storyboard, so it is never part of a backup set. */
const CACHE_DIRS = new Set(['clips']);
const PARTIAL_SUFFIX = '.partial.mp4';

/** Configuration the app needs at boot. Names only — values live in secrets. */
export const RUNTIME_CONFIGURATION = ['PORT', 'DATA_DIR', 'MEDIA_DIR', 'DEEPGRAM_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'];

export type MediaMode = 'metadata' | 'full' | 'skip';

export type MediaEntry = { path: string; bytes: number; sha256?: string };

export type BackupManifest = {
  version: number;
  createdAt: string;
  app: string;
  database: {
    file: string;
    bytes: number;
    sha256: string;
    /** Result of `PRAGMA integrity_check` on the snapshot. */
    integrity: string;
    foreignKeyViolations: number;
    tables: Record<string, number>;
  };
  media: {
    mode: MediaMode;
    files: MediaEntry[];
    skipped: string[];
    totalBytes: number;
  };
  runtime: {
    node: string;
    platform: string;
    requiredConfiguration: string[];
    /** Which of the required names were present when the backup was taken. */
    configured: string[];
  };
};

export type BackupResult = {
  dir: string;
  manifest: BackupManifest;
  removed: string[];
};

export type VerifyResult = {
  ok: boolean;
  dir: string;
  issues: string[];
  manifest: BackupManifest | null;
};

export class BackupError extends Error {}

function stamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/** A backup directory this tool owns: `vcsl-YYYYMMDD-HHMMSS`. */
const BACKUP_NAME = /^vcsl-\d{8}-\d{6}$/;

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

function userTables(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function tableCounts(db: Database.Database): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of userTables(db)) {
    counts[table] = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
  }
  return counts;
}

function integrity(db: Database.Database): { check: string; foreignKeyViolations: number } {
  const check = (db.pragma('integrity_check', { simple: true }) as string) || 'unknown';
  const violations = db.pragma('foreign_key_check') as unknown[];
  return { check, foreignKeyViolations: violations.length };
}

function emptyDir(dir: string): boolean {
  if (!existsSync(dir)) return true;
  return readdirSync(dir).length === 0;
}

/** Walks a media directory, skipping the regenerable cache and partial encodes. */
function walkMedia(root: string, dir = root, out: string[] = [], skipped: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (dir === root && CACHE_DIRS.has(entry.name)) {
        skipped.push(`${relative}/`);
        continue;
      }
      walkMedia(root, absolute, out, skipped);
      continue;
    }
    if (entry.name.endsWith(PARTIAL_SUFFIX)) {
      skipped.push(relative);
      continue;
    }
    out.push(relative);
  }
  return out;
}

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATA_DIR || '/tmp/visual-cs-lab';
}

export function defaultMediaDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MEDIA_DIR || path.join(defaultDataDir(env), 'media');
}

export function defaultBackupRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.BACKUP_DIR || path.join(defaultDataDir(env), 'backups');
}

/**
 * Copies a live SQLite database through the online backup API.
 * The source is opened read-only; no journal mode, schema or row is changed.
 */
export async function snapshotDatabase(source: string, target: string): Promise<void> {
  if (!existsSync(source)) throw new BackupError(`database not found: ${source}`);
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    // The API copies page-by-page inside one read transaction, so the snapshot is
    // consistent even while the server writes to the WAL.
    await db.backup(target);
  } finally {
    db.close();
  }
}

/** Creates one complete backup and returns its directory and manifest. */
export async function createBackup(options: {
  dataDir?: string;
  mediaDir?: string;
  outDir?: string;
  /** How many backup sets to keep in `outDir` (0 keeps everything). */
  keep?: number;
  media?: MediaMode;
  /** Hash media files for later integrity checks (default on). */
  hashMedia?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
} = {}): Promise<BackupResult> {
  const env = options.env || process.env;
  const dataDir = path.resolve(options.dataDir || defaultDataDir(env));
  const mediaDir = path.resolve(options.mediaDir || defaultMediaDir(env));
  const outDir = path.resolve(options.outDir || defaultBackupRoot(env));
  const mediaMode: MediaMode = options.media || 'metadata';
  const keep = options.keep ?? 7;

  const sourceDb = path.join(dataDir, DB_FILE);
  if (!existsSync(sourceDb)) throw new BackupError(`nothing to back up: ${sourceDb} does not exist`);
  if (outDir === dataDir) {
    throw new BackupError('the backup root cannot be the data directory itself');
  }
  mkdirSync(outDir, { recursive: true });

  const name = `vcsl-${stamp(options.now)}`;
  const finalDir = path.join(outDir, name);
  if (existsSync(finalDir)) throw new BackupError(`${finalDir} already exists`);
  const workDir = path.join(outDir, `.tmp-${name}-${process.pid}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true, mode: 0o700 });

  try {
    // 1. Consistent database snapshot.
    const dbCopy = path.join(workDir, DB_FILE);
    await snapshotDatabase(sourceDb, dbCopy);
    const dbBytes = (await stat(dbCopy)).size;

    // 2. Read the snapshot back: it must already pass an integrity check before
    //    it is allowed to become a backup.
    const check = new Database(dbCopy, { readonly: true, fileMustExist: true });
    let integrityCheck: string;
    let foreignKeyViolations: number;
    let tables: Record<string, number>;
    try {
      const result = integrity(check);
      integrityCheck = result.check;
      foreignKeyViolations = result.foreignKeyViolations;
      tables = tableCounts(check);
    } finally {
      check.close();
    }
    if (integrityCheck !== 'ok') throw new BackupError(`snapshot integrity check failed: ${integrityCheck}`);

    // 3. Media: metadata by default, full copy on request.
    const skipped: string[] = [];
    const files = walkMedia(mediaDir, mediaDir, [], skipped);
    const entries: MediaEntry[] = [];
    let totalBytes = 0;
    for (const relative of files) {
      const absolute = path.join(mediaDir, relative);
      const info = await stat(absolute);
      const entry: MediaEntry = { path: relative, bytes: info.size };
      if (options.hashMedia !== false) entry.sha256 = await sha256File(absolute);
      entries.push(entry);
      totalBytes += info.size;
    }
    if (mediaMode === 'full' && existsSync(mediaDir)) {
      for (const relative of files) {
        const destination = path.join(workDir, 'media', relative);
        mkdirSync(path.dirname(destination), { recursive: true });
        cpSync(path.join(mediaDir, relative), destination, { preserveTimestamps: true });
      }
    }

    // 4. Manifest last: its presence is what makes the directory a backup.
    const manifest: BackupManifest = {
      version: BACKUP_VERSION,
      createdAt: (options.now || new Date()).toISOString(),
      app: 'visual-cs-lab',
      database: {
        file: DB_FILE,
        bytes: dbBytes,
        sha256: await sha256File(dbCopy),
        integrity: integrityCheck,
        foreignKeyViolations,
        tables
      },
      media: {
        mode: mediaMode,
        files: entries,
        skipped: [...new Set(skipped)],
        totalBytes
      },
      runtime: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        requiredConfiguration: RUNTIME_CONFIGURATION,
        configured: RUNTIME_CONFIGURATION.filter((key) => Boolean(env[key]))
      }
    };
    writeFileSync(path.join(workDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

    // 5. Publish atomically: one rename, so a reader sees either nothing or a
    //    complete backup.
    renameSync(workDir, finalDir);

    // 6. Retention: only directories this tool named are considered.
    const removed = keep > 0 ? pruneBackups(outDir, keep) : [];
    return { dir: finalDir, manifest, removed };
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
}

/** Deletes the oldest backup sets beyond `keep`, newest first, inside `outDir` only. */
export function pruneBackups(outDir: string, keep: number): string[] {
  if (!existsSync(outDir)) return [];
  const sets = readdirSync(outDir)
    .filter((entry) => BACKUP_NAME.test(entry))
    .sort()
    .reverse();
  const removed: string[] = [];
  for (const entry of sets.slice(Math.max(0, keep))) {
    const target = path.join(path.resolve(outDir), entry);
    if (!target.startsWith(path.resolve(outDir) + path.sep)) continue;
    rmSync(target, { recursive: true, force: true });
    removed.push(target);
  }
  return removed;
}

export function listBackups(outDir = defaultBackupRoot()): { dir: string; createdAt: string; megabytes: number }[] {
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir)
    .filter((entry) => BACKUP_NAME.test(entry))
    .sort()
    .reverse()
    .map((entry) => {
      const dir = path.join(outDir, entry);
      const manifestFile = path.join(dir, MANIFEST);
      let createdAt = '';
      let bytes = 0;
      try {
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as BackupManifest;
        createdAt = manifest.createdAt;
        bytes = manifest.database.bytes + (manifest.media.mode === 'full' ? manifest.media.totalBytes : 0);
      } catch {
        /* a directory without a manifest is reported as incomplete */
      }
      return { dir, createdAt, megabytes: Math.round((bytes / 1048576) * 10) / 10 };
    });
}

/**
 * Verifies a backup without touching the live data: the manifest must parse, the
 * snapshot must pass SQLite's integrity and foreign-key checks, its hash and row
 * counts must match the manifest, and (for a full media copy) every media file
 * must exist with the recorded size and hash.
 */
export async function verifyBackup(dir: string): Promise<VerifyResult> {
  const issues: string[] = [];
  const manifestFile = path.join(dir, MANIFEST);
  if (!existsSync(manifestFile)) {
    return { ok: false, dir, issues: [`manifest.json is missing — this is not a complete backup`], manifest: null };
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as BackupManifest;
  } catch (error) {
    return { ok: false, dir, issues: [`manifest.json is unreadable: ${(error as Error).message}`], manifest: null };
  }
  if (manifest.version !== BACKUP_VERSION) {
    issues.push(`manifest version ${manifest.version} is not supported (expected ${BACKUP_VERSION})`);
  }

  const dbFile = path.join(dir, manifest.database.file || DB_FILE);
  if (!existsSync(dbFile)) {
    issues.push('database snapshot is missing');
  } else {
    const info = await stat(dbFile);
    if (manifest.database.sha256 && (await sha256File(dbFile)) !== manifest.database.sha256) {
      issues.push('database snapshot hash does not match the manifest (file changed or damaged)');
    }
    if (manifest.database.bytes && info.size !== manifest.database.bytes) {
      issues.push(`database snapshot is ${info.size} bytes, manifest recorded ${manifest.database.bytes}`);
    }
    let check: Database.Database | null = null;
    try {
      check = new Database(dbFile, { readonly: true, fileMustExist: true });
      check.prepare('SELECT COUNT(*) FROM sqlite_master').get();
      const result = integrity(check);
      if (result.check !== 'ok') issues.push(`integrity_check: ${result.check}`);
      if (result.foreignKeyViolations > 0) {
        issues.push(`foreign_key_check reported ${result.foreignKeyViolations} violation(s)`);
      }
      const counts = tableCounts(check);
      for (const [table, expected] of Object.entries(manifest.database.tables || {})) {
        const actual = counts[table];
        if (actual === undefined) issues.push(`table ${table} is missing from the snapshot`);
        else if (actual !== expected) issues.push(`table ${table} has ${actual} rows, manifest recorded ${expected}`);
      }
    } catch (error) {
      issues.push(`the snapshot cannot be opened as a SQLite database: ${(error as Error).message}`);
    } finally {
      check?.close();
    }
  }

  if (manifest.media?.mode === 'full') {
    for (const entry of manifest.media.files) {
      const file = path.join(dir, 'media', entry.path);
      if (!existsSync(file)) {
        issues.push(`media file missing: ${entry.path}`);
        continue;
      }
      const info = await stat(file);
      if (info.size !== entry.bytes) issues.push(`media size mismatch: ${entry.path}`);
      else if (entry.sha256 && (await sha256File(file)) !== entry.sha256) {
        issues.push(`media hash mismatch: ${entry.path}`);
      }
    }
  } else if (manifest.media?.mode === 'metadata') {
    // Nothing was copied, so verification is limited to manifest structure; the
    // operator is told plainly rather than given false confidence.
    if (!Array.isArray(manifest.media.files)) issues.push('media manifest is malformed');
  }

  return { ok: issues.length === 0, dir, issues, manifest };
}

/**
 * Restores a backup into a fresh directory for a recovery test or a real move.
 *
 * It refuses a non-empty target unless `force` is set: restoring is the one
 * operation that could overwrite data, so the default is to fail loudly.
 */
export async function restoreBackup(
  dir: string,
  targetDir: string,
  options: { force?: boolean } = {}
): Promise<{ targetDir: string; counts: Record<string, number>; integrity: string }> {
  const verified = await verifyBackup(dir);
  if (!verified.ok || !verified.manifest) {
    throw new BackupError(`refusing to restore an unverified backup: ${verified.issues.join('; ')}`);
  }
  const target = path.resolve(targetDir);
  if (!emptyDir(target) && !options.force) {
    throw new BackupError(`${target} is not empty — pass force to replace its contents`);
  }
  mkdirSync(target, { recursive: true });
  cpSync(path.join(dir, DB_FILE), path.join(target, DB_FILE), { preserveTimestamps: true });
  if (verified.manifest.media.mode === 'full' && existsSync(path.join(dir, 'media'))) {
    cpSync(path.join(dir, 'media'), path.join(target, 'media'), { recursive: true, preserveTimestamps: true });
  }

  const db = new Database(path.join(target, DB_FILE), { readonly: true, fileMustExist: true });
  try {
    const result = integrity(db);
    if (result.check !== 'ok') throw new BackupError(`restored database failed integrity_check: ${result.check}`);
    return { targetDir: target, counts: tableCounts(db), integrity: result.check };
  } finally {
    db.close();
  }
}

/** Bytes of one media tree, for the readiness report. */
export function mediaUsage(mediaDir = defaultMediaDir()): { files: number; bytes: number } {
  if (!existsSync(mediaDir)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const relative of walkMedia(mediaDir)) {
    files += 1;
    try {
      bytes += statSync(path.join(mediaDir, relative)).size;
    } catch {
      /* a file removed mid-walk is not counted */
    }
  }
  return { files, bytes };
}
