# Rendering pipeline

An in-process worker paints Skia frames and pipes them to ffmpeg, then validates the encoded
file. No browser, no queue server, no object store.

## Output profiles (`server/render/profiles.ts`)

| Preset | Size | Purpose | Encoder |
| --- | --- | --- | --- |
| `preview` | 540×960 | Fast iteration while editing | crf 21, veryfast |
| `hd` | 1080×1920 | Default publication (Reels, Shorts, TikTok) | crf 19, veryfast |
| `master` | 1080×1920 | Near-lossless upload master | crf 15, medium, 16 Mbit/s |
| `4k` | 2160×3840 | Optional high-resolution master | crf 21, veryfast |
| `long` | 1920×1080 | 16:9 copy for YouTube and course pages | crf 18, medium |

The `animation` x264 tune keeps flat vector graphics clean; frames are allocated per scene by
largest remainder so the encoded duration equals the storyboard to the frame.

## Job lifecycle (`server/render/jobs.ts`)

```
queued → rendering → encoding → validating → done
                                   │
                                   └──► error (job dropped, notice shown)
```

- One job at a time. The pump is an in-process promise chain; a render never runs concurrently
  with another.
- Progress and log lines are written to the job row so the Studio can show what is happening.
- Failed jobs are **not** kept: the MP4 is deleted, the row removed, and the failure surfaced
  as a transient notice (`recentFailures()`), so the list never accumulates dead history.
- `resumeOnBoot()` drops jobs left in `rendering`/`encoding`/`validating` by a crash and
  restarts the pump.
- Retry and cancel act on a single job; cleanup and dedupe act on the set of finished videos.

## Quality gate (`server/render/quality.ts`)

`validate` runs on the encoded file, not on intent, and the report is stored on the job:

- container and video codec (H.264 / yuv420p), even dimensions, exact resolution per profile;
- frame-accurate duration against the storyboard frame count;
- decoded frame count and bitrate sanity;
- audio stream presence when a narration track was requested;
- sampled frame inspection for blank or repeated frames.

A render only counts as publishable when the job is `done` **and** `validation.ok` — the
Studio's "ready to publish" count requires both, plus human approval.

## Thumbnails (`server/render/thumbnails.ts`)

The poster frame is cut from the video's own opening, cached per lesson, and can be replaced
manually or recut after a brand change. JPEG and PNG variants are named for the upload field.

## Audio (`server/voiceover*.ts`, `server/tts/*`, `server/render/variants.ts`)

Voice-over scripts are generated per scene, edited in the Studio, then spoken by the configured
provider (Deepgram today). A finished take is remuxed under the validated silent master to
produce a voiced variant; the silent master is never re-encoded.

## Storage and naming

```
DATA_DIR/lab.db              content, jobs, assets
MEDIA_DIR/<job>.mp4          finished renders
MEDIA_DIR/clips/             cached scene previews
MEDIA_DIR/thumbnails/        posters
MEDIA_DIR/audio/             narration takes
```

Downloads are named for the lesson (`arrays_video.mp4`, `arrays_thumbnail.jpg`) so an upload
field can be filled without renaming. Nothing in `MEDIA_DIR` is committed to Git.

## Operational notes

- Rendering is CPU-bound; average wall time in this workspace was ~107 s per finished job.
- A hung encode blocks the queue until the service restarts (boot drops the stale job). A
  per-job heartbeat/watchdog is the recommended fix — see the repository audit.
- Media lives on one volume. Treat `/data` as the source of truth and back it up.
