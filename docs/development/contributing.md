# Contributing (engineering)

The short version lives in the repository's [CONTRIBUTING.md](../../CONTRIBUTING.md). This page
covers the conventions that matter when you change code.

## Workflow

1. Branch from the application branch; keep one concern per branch.
2. Implement, then verify in the running app (not only in tests).
3. `npm test`, `npm run typecheck`, `npm run build` inside `visual-cs-lab/`.
4. Open a pull request describing **what you verified and how**. Unverified claims are not merged.

## Code conventions

- **TypeScript everywhere, strict.** No `any` in new code; prefer explicit types at module
  boundaries. External input is validated where it enters (route handlers), not deep in logic.
- **Prepared statements only.** SQL is visible in the module that owns the table; no ORM.
- **Domain boundaries hold.** `algorithms/` never imports `render/` or Express; `anim/` never
  imports routes; routes never paint. If a change needs to cross a boundary, propose the
  boundary change first.
- **Routers stay thin.** A route validates input, calls a domain function and shapes a response.
  Business rules live in domain modules so they can be tested without HTTP.
- **No new dependency without justification.** The current set (Express, React, Vite,
  `better-sqlite3`, `@napi-rs/canvas`, `ffmpeg-static`) is deliberate: everything renders without
  a browser and without a database server.
- **Never commit** `.env`, `*.db`, rendered media, or generated `dist/`.

## Adding a lesson (content, not code)

Studio → Content management → new lesson on an existing concept → write sections and practice
questions → generate the storyboard → render. Content is data; it needs no deployment.

## Adding an algorithm (code)

See [visualization-engine.md](../architecture/visualization-engine.md#adding-an-algorithm). In
short: trace + validator + tests, dispatch through `runConcept`, reuse existing animation
primitives unless the visual vocabulary is genuinely new.

## Schema changes

Follow [database.md](../architecture/database.md#changing-the-schema). Backup, additive
migration, test against a copy, never reset production data.

## Rendering changes

Rendering bugs are proven by rendering. Render one vertical and one horizontal lesson, confirm the
quality report is clean, and say which lesson and profile you inspected. Frame arithmetic belongs in
a test (`render/profiles.test.ts`), not in a screenshot.

## Reviews

- A reviewer checks the claim, not the diff size: does the pull request do what it says, and is
  that verified?
- Comments that identify a real defect are addressed with a change and a reply saying what
  changed; a disagreement is answered with reasoning, not silence.
