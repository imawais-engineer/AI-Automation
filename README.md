# Visual CS Lab

**Computer science, one concept at a time.**

An interactive Computer Science learning platform built around structured tutorials,
executable examples, verified algorithm traces and visual explanations — plus a Studio
that turns those same traces into branded MP4 lessons.

The application lives in [`visual-cs-lab/`](visual-cs-lab/). This repository root holds the
product documentation, the security policy and the CI workflow.

---

## What the product is

Two audiences, one codebase, one source of truth for every number shown on screen:

| Surface | Who it is for | What it does |
| --- | --- | --- |
| **Learning platform** (`/`, `/explore`, `/roadmaps`, `/learn/:slug`, `/my-learning`) | Learners | Tutorials in plain language, worked examples, real execution output, complexity analysis, practice questions, and a short animation of the trace |
| **Creator Studio** (`/admin/*`) | Editors and reviewers | Content management, storyboard editing, narration, render queue, quality reports, per-platform captions, publishing queue |
| **Rendering engine** | Internal | Verified trace → animation timeline → Skia frames → H.264 MP4 → automated quality gate → thumbnail |

Every value in an animation comes from a real algorithm run. A render is only marked
`done` after the encoded file passes the quality checks that measure the file itself.

## Key capabilities

- **Verified traces** — 27 algorithm modules (arrays, linked lists, stacks, queues, hash
  tables, trees, heaps, graphs, sorts, searching, recursion, dynamic programming,
  patterns) each produce a deterministic, testable event trace.
- **One trace, two consumers** — the same trace powers the interactive lesson animation
  and the rendered video; neither re-implements the algorithm.
- **Content-driven timing** — a video is as long as its beats and narration need; no fixed
  duration slot.
- **Five output profiles** — Preview 540×960, HD Shorts 1080×1920, Master 1080×1920,
  4K vertical 2160×3840 and HD Long 1920×1080.
- **Quality gate** — container, codec, pixel format, resolution, even dimensions, audio,
  frame-accurate duration and sampled frame checks run on the finished MP4.
- **Roles** — learner, editor, reviewer and admin, enforced per action on the server.
- **Content** — 28 concepts, 28 lessons (23 published), 1 roadmap with 4 modules,
  84 slides across 11 decks.

## Technology stack

Node.js 20.19+ · TypeScript · Express 4 · React 18 · Vite 6 · React Router 6 ·
SQLite via `better-sqlite3` · `@napi-rs/canvas` (Skia) for frame painting · `ffmpeg-static`
for encoding · `tsx` to run TypeScript on the server. No browser renderer, no database
server, no external asset pipeline.

## Installation

```bash
git clone https://github.com/imawais-engineer/AI-Automation.git
cd AI-Automation/visual-cs-lab
npm ci
npm run dev          # API + UI + video downloads on http://localhost:3000
```

`ffmpeg` ships as a package and the video fonts are committed, so Node.js is the only
prerequisite.

## Development commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Server + Vite middleware on port 3000 (live reload) |
| `npm run build` | Production client build into `dist/` |
| `npm start` | Run the server (serves `dist/` when `NODE_ENV=production`) |
| `npm test` | 149 tests across algorithms, traces, rendering, quality and voice-over |
| `npm run typecheck` | `tsc --noEmit` over server, client and tests |

## Environment configuration

Every variable is optional; the app boots, renders and passes its tests with none of them.
Copy `visual-cs-lab/.env.example` to `.env` to override. The ones that change behaviour:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Server port |
| `DATA_DIR` | `/tmp/visual-cs-lab` | SQLite database |
| `MEDIA_DIR` | `$DATA_DIR/media` | Rendered MP4s, thumbnails, clips, audio |
| `DEEPGRAM_API_KEY` | — | Voice-over narration |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | — | Optional OpenAI-compatible drafting |

Secrets are read from the environment only; nothing is committed. See
[docs/development/environment.md](docs/development/environment.md).

## Testing

```bash
cd visual-cs-lab
npm test
npm run typecheck
npm run build
```

Tests cover algorithm output against hand-checked expectations, trace determinism, frame
allocation, caption contrast at 1080×1920, quality-report parsing, video captions,
publishing copy, branding and voice-over — plus the API contract of every route, the render
queue's watchdog and crash recovery, backup/restore, and the public pages in a DOM harness.
Focused runs: `npm run test:api`, `test:queue`, `test:backup`, `test:ui`.

Operations guides (queue reliability, backup and recovery, security review, production
readiness) live in [docs/operations/](docs/operations/). Backups:

```bash
npm run backup -- create --media full   # database + media into DATA_DIR/backups
npm run backup -- verify <set>
```

## Deployment

The repository ships a single-container production image:

```bash
cd visual-cs-lab
docker build -t visual-cs-lab .
docker run -p 3000:3000 -v vcsl-data:/data visual-cs-lab
```

The container runs `npm run build` at image build time and serves the compiled client from
`dist/` plus the API from Express, with SQLite and media on the `/data` volume. Details:
[docs/development/deployment.md](docs/development/deployment.md).

## Project structure

```
.
├── docs/                      product, architecture and engineering documentation
├── .github/workflows/         secret scanning (gitleaks)
├── visual-cs-lab/
│   ├── server/
│   │   ├── algorithms/        verified algorithm implementations + traces
│   │   ├── anim/              visualization primitives and frame painting
│   │   ├── render/            scene planning, encoding, validation, thumbnails
│   │   ├── routes/            Studio HTTP surface, one domain per router
│   │   ├── tts/               narration providers
│   │   ├── db.ts              schema and migrations
│   │   ├── scenes.ts          storyboard model and validation
│   │   ├── admin-api.ts       role-gated Studio administration
│   │   ├── public-api.ts      published content and learner writes
│   │   └── index.ts           wiring: middleware, routers, client, boot
│   ├── src/                   React client (public site + Studio)
│   └── public/                fonts and static assets
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```

## Documentation

- [Mission](docs/product/mission.md) · [Learning experience](docs/product/learning-experience.md) · [Curriculum](docs/product/curriculum-structure.md)
- [Architecture](docs/architecture/overview.md) · [Repository audit](docs/architecture/repository-audit.md) · [Visualization engine](docs/architecture/visualization-engine.md) · [Rendering pipeline](docs/architecture/rendering-pipeline.md) · [Database](docs/architecture/database.md)
- [Setup](docs/development/setup.md) · [Environment](docs/development/environment.md) · [Testing](docs/development/testing.md) · [Deployment](docs/development/deployment.md) · [Contributing](docs/development/contributing.md)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm test`, `npm run typecheck` and
`npm run build` inside `visual-cs-lab/` before opening a pull request.

## License

MIT — see [LICENSE](LICENSE).
