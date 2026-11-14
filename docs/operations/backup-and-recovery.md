# Backup and recovery

Status: implemented in this branch. Tools live in `visual-cs-lab/server/ops/backup.ts`
(library) and `visual-cs-lab/server/ops/backup-cli.ts` (command line). Tests:
`visual-cs-lab/server/ops/backup.test.ts`.

Nothing here has been run against the production data yet: the restore drill in this document is
the procedure, the automated tests exercise it against disposable copies.

## 1. What has to be backed up

| Item | Location (inside the container) | Why it matters | In a backup |
| --- | --- | --- | --- |
| Database | `DATA_DIR/lab.db` (WAL: `-wal`, `-shm` handled by SQLite) | concepts, lessons, sections, quizzes, render metadata, users, sessions, progress, publishing queue | **yes** (consistent snapshot) |
| Finished renders | `MEDIA_DIR/*.mp4` | the videos themselves; often the only copy | recorded always, copied in `--media full` |
| Narration takes | `MEDIA_DIR/narration/` | recorded voice-over audio | same |
| Audio variant masters | `MEDIA_DIR/variants/` | remux sources for voiced renders | same |
| Thumbnails | `MEDIA_DIR/thumbnails/` | poster frames on the learning pages (regenerable, but slow) | same |
| Scene preview cache | `MEDIA_DIR/clips/` | regenerable in seconds | **no** — excluded |
| Half-written encodes | `MEDIA_DIR/*.partial.mp4` | never a finished render | **no** — excluded |
| Runtime configuration | environment: `PORT`, `DATA_DIR`, `MEDIA_DIR`, provider keys | the app cannot boot without the paths and keys | **names only** in the manifest (`configured` lists which were present) |
| Secrets | Base44 encrypted secret store → `/run/base44/app.env` | provider keys | **never** in a backup |

The current production-like tree is about **984 MB**, dominated by 60 MP4s; the database is ~7 MB.
That is why the default is a *metadata* backup (database + a hashed inventory of media) and the
full copy is opt-in.

## 2. Commands

All commands run inside the app container, from `visual-cs-lab/`:

```bash
# 1. Database + media inventory (fast, default). Keeps the newest 7 sets.
npm run backup -- create

# 2. Self-contained set: database + every media file (large, slow, but restorable alone)
npm run backup -- create --media full --keep 3

# 3. Verify a set: manifest, SQLite integrity + foreign keys, row counts, hashes
npm run backup -- verify /data/backups/vcsl-20261114-120000

# 4. List sets (an entry with an empty timestamp is incomplete)
npm run backup -- list

# 5. Restore into an EMPTY directory (or a disposable one for a drill)
npm run backup -- restore /data/backups/vcsl-20261114-120000 /tmp/restore-drill
```

Useful flags: `--out DIR` (backup root, default `$BACKUP_DIR` or `DATA_DIR/backups`),
`--data DIR`, `--media-dir DIR`, `--no-hash` (skip media hashing), `--force` (restore over a
non-empty target).

Exit codes: `0` success, `1` failure (create/verify), `2` usage error. A scheduler can alert on
non-zero.

## 3. Guarantees, and how they are achieved

**Consistent database copy.** The snapshot is taken through SQLite's online backup API
(`db.backup()`), which copies pages inside one read transaction. The app keeps writing (WAL mode)
while the copy runs; the result is a transactionally consistent database, not a torn file.

**Atomic creation.** A run builds everything in `<out>/.tmp-vcsl-<stamp>-<pid>/`, writes
`manifest.json` **last**, then `rename()`s the directory to `vcsl-YYYYMMDD-HHMMSS`. A reader
therefore sees either no directory or a complete one. If anything fails, the temporary directory is
deleted. A directory with a `lab.db` but no `manifest.json` is reported as incomplete by `list` and
rejected by `verify`.

**Integrity verification.** `verify` checks: manifest parses and its version is supported; the
snapshot's SHA-256 and size match the manifest; `PRAGMA integrity_check` returns `ok`;
`PRAGMA foreign_key_check` is empty; every table's row count matches the manifest; in full mode
every media file exists with the recorded size and hash. `--media metadata` sets are honest about
their limit: they can prove the inventory, not the media bytes.

**Media integrity.** Every media file is hashed (SHA-256) when the set is created, unless
`--no-hash` is passed. Verification re-hashes the copies.

**Retention.** `--keep N` (default 7) keeps the newest N directories **whose names match
`vcsl-YYYYMMDD-HHMMSS`** inside the backup root, and deletes only those. Unrelated directories,
including anything else in the backup root, are never touched (tested).

**Never destructive by accident.** `create` opens the source database read-only. `restore` refuses
a non-empty target unless `--force`, refuses any set that fails verification, and re-runs
`integrity_check` on the restored copy. It writes to the target you name — it never writes to
`DATA_DIR`.

## 4. Recovery objectives (documented targets)

| Objective | Target | What it depends on |
| --- | --- | --- |
| **RPO** (data you may lose) | ≤ 1 hour | A scheduled `create` every hour. The database holds all metadata; videos are additive. |
| **RPO for renders** | Since the last set | A render finished after the last backup exists only in `MEDIA_DIR`. Take a full set after a publishing batch. |
| **RTO** (time to serve again) | ≤ 30 min for a metadata set, ≤ 2 h for a full set | Restore + boot + verify. Full-set restore is bounded by copying ~1 GB. |

These are targets, not measurements: the drill in §6 has not yet been run against production data.

## 5. Restore procedure (real recovery)

1. **Stop writers.** `docker compose -f docker-compose.base44.yml stop lab` (or scale to zero). Do
   not delete the current data: keep it aside first.
2. **Preserve the failed state.** Copy the current `DATA_DIR` to a separate volume/path
   (e.g. `/data-failed-20261114`) so nothing is lost while you investigate.
3. **Verify the chosen set** with `npm run backup -- verify <set>`; stop if it fails.
4. **Restore** with `npm run backup -- restore <set> /data/restored`. For a metadata set, copy the
   media you still have (or restore your off-box media copy) into `/data/restored/media`.
5. **Point the app at it**: set `DATA_DIR=/data/restored` (and `MEDIA_DIR=/data/restored/media`) for
   the service, so the original directory stays untouched.
6. **Start** the service and confirm `curl -s localhost:3000/api/health` returns `{"ok":true,…}` and
   that `/api/learn/home` lists lessons.
7. **Confirm content**: the Studio overview counts, one published lesson page, and one finished
   render playable from `/api/renders/<id>/stream`.
8. **Only after that**, retire the old directory.

`resumeOnBoot()` ignores `done` rows, so a restored database starts with its finished renders
intact; any job that was mid-render at backup time is requeued once (see
`render-queue-reliability.md`).

## 6. Restore drill (disposable copy — do this on a schedule)

```bash
# inside the container
SET=$(ls -d /data/backups/vcsl-* | tail -1)
npm run backup -- verify "$SET"
rm -rf /tmp/restore-drill
npm run backup -- restore "$SET" /tmp/restore-drill
# compare the important counts with the live database (read-only queries)
node -e "const D=require('better-sqlite3');
for (const f of ['/data/lab.db','/tmp/restore-drill/lab.db']) {
  const db=new D(f,{readonly:true});
  console.log(f, ['lessons','concepts','render_jobs','video_assets','users'].map(t=>t+'='+db.prepare('SELECT COUNT(*) n FROM '+t).get().n).join(' '));
}"
rm -rf /tmp/restore-drill
```

The automated suite performs exactly this against a synthetic tree, including deliberately damaged
sets (corrupt SQLite file, modified media) and a target that is not empty.

## 7. What is not covered yet

- **Off-box replication.** All sets currently live next to the data they protect; losing the volume
  loses both. Copy sets to object storage (or another host) on the same schedule, or the RPO is
  "whatever survives the disk".
- **Secrets.** Provider keys live in the platform's encrypted store; a restore needs them present,
  and the manifest only records their names.
- **Point-in-time recovery.** SQLite snapshots are interval-based; there is no WAL archiving, so a
  restore returns to the last snapshot, not to an arbitrary second.
- **Automated scheduling.** `create` is a command a scheduler must call (`cron`/compose sidecar);
  nothing in this branch installs a timer.
- **Media-only backups of a metadata set.** Choose `--media full` for sets that must restore
  without the original media directory.
