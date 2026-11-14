#!/usr/bin/env node
/**
 * Command-line entry point for backups: create, verify, list, restore.
 *
 *   npm run backup -- create [--out DIR] [--keep 7] [--media metadata|full|skip] [--data DIR] [--media-dir DIR]
 *   npm run backup -- verify <backup-dir>
 *   npm run backup -- list [--out DIR]
 *   npm run backup -- restore <backup-dir> <target-dir> [--force]
 *
 * Every command prints plain text; `create` and `verify` exit non-zero on failure
 * so a scheduler can alert on them. Nothing here writes to the live data
 * directory — `restore` requires the target to be empty unless `--force` is given.
 */

import path from 'node:path';

import {
  BackupError,
  createBackup,
  defaultBackupRoot,
  defaultDataDir,
  defaultMediaDir,
  listBackups,
  mediaUsage,
  restoreBackup,
  verifyBackup,
  type MediaMode
} from './backup.ts';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function main(): Promise<number> {
  const [command = 'create', ...rest] = process.argv.slice(2);
  const positional = rest.filter((value, index) => !value.startsWith('--') && !rest[index - 1]?.startsWith('--'));

  if (command === 'create') {
    const dataDir = flag(rest, '--data') || defaultDataDir();
    const mediaDir = flag(rest, '--media-dir') || defaultMediaDir();
    const media = (flag(rest, '--media') as MediaMode) || 'metadata';
    if (!['metadata', 'full', 'skip'].includes(media)) {
      console.error('--media must be metadata, full or skip');
      return 2;
    }
    const result = await createBackup({
      dataDir,
      mediaDir,
      outDir: flag(rest, '--out') || defaultBackupRoot(),
      keep: Number(flag(rest, '--keep') ?? 7),
      media,
      hashMedia: !rest.includes('--no-hash')
    });
    const usage = mediaUsage(mediaDir);
    console.log(`backup created: ${result.dir}`);
    console.log(
      `database: ${megabytes(result.manifest.database.bytes)} · ${Object.entries(result.manifest.database.tables)
        .map(([table, count]) => `${table}=${count}`)
        .join(' ')}`
    );
    console.log(
      `media (${result.manifest.media.mode}): ${result.manifest.media.files.length} file(s) tracked, live tree is ${mediaUsage(mediaDir).files} file(s) / ${megabytes(usage.bytes)}`
    );
    if (result.manifest.media.mode === 'metadata') {
      console.log('note: metadata mode records sizes/hashes but copies no media bytes; pass --media full for a self-contained set');
    }
    console.log(`retention: removed ${result.removed.length} older set(s)`);
    return 0;
  }

  if (command === 'verify') {
    const dir = positional[0];
    if (!dir) {
      console.error('usage: backup verify <backup-dir>');
      return 2;
    }
    const result = await verifyBackup(path.resolve(dir));
    console.log(result.ok ? `backup verified: ${result.dir}` : `backup FAILED verification: ${result.dir}`);
    for (const issue of result.issues) console.log(`  - ${issue}`);
    return result.ok ? 0 : 1;
  }

  if (command === 'list') {
    const sets = listBackups(flag(rest, '--out') || defaultBackupRoot());
    if (sets.length === 0) {
      console.log('no backups found');
      return 0;
    }
    for (const set of sets) console.log(`${set.createdAt || 'incomplete'}  ${megabytes(set.megabytes * 1048576)}  ${set.dir}`);
    return 0;
  }

  if (command === 'restore') {
    const [dir, target] = positional;
    if (!dir || !target) {
      console.error('usage: backup restore <backup-dir> <empty-target-dir> [--force]');
      return 2;
    }
    const result = await restoreBackup(path.resolve(dir), path.resolve(target), { force: rest.includes('--force') });
    console.log(`restored into ${result.targetDir} (integrity ${result.integrity})`);
    console.log(
      Object.entries(result.counts)
        .map(([table, count]) => `${table}=${count}`)
        .join(' ')
    );
    return 0;
  }

  console.error(`unknown command: ${command}`);
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof BackupError) {
      console.error(`backup error: ${error.message}`);
      process.exit(1);
    }
    console.error(error);
    process.exit(1);
  });
