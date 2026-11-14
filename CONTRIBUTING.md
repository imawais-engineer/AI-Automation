# Contributing to Visual CS Lab

Thanks for helping improve a Computer Science learning platform where every number on
screen comes from a real algorithm run.

## Ground rules

- **Never invent a result.** A displayed value must originate from an executed trace.
- **Preserve the separation of concerns** described in
  [docs/architecture/overview.md](docs/architecture/overview.md): algorithms do not paint,
  the renderer does not decide correctness, the client does not re-implement an algorithm.
- **Do not commit data or media**: no `.db` files, no rendered MP4s, no `.env`.
- **Keep the app bootable.** A change that leaves the dev server unable to start is not
  ready for review.

## Development

```bash
cd visual-cs-lab
npm ci
npm run dev
```

Full setup, environment and troubleshooting notes:
[docs/development/setup.md](docs/development/setup.md).

## Before you open a pull request

Run all three inside `visual-cs-lab/` and paste the outcome in the PR description:

```bash
npm test           # algorithms, traces, rendering, quality, captions
npm run typecheck  # tsc --noEmit
npm run build      # production client build
```

Then check the behaviour in the running app:

- Public routes you touched render real content (not an empty shell).
- Studio routes you touched still work with an editor or admin account.
- A rendering change was verified by rendering a lesson, not only by reading the diff.
- If you changed the storyboard or animation model, note whether existing lessons need a
  storyboard rebuild from the Studio (Brand → regenerate).

## Pull request conventions

- Conventional commit titles: `feat(scene): …`, `fix(render): …`, `docs: …`,
  `refactor(routes): …`.
- One concern per pull request. Schema changes ship with a migration in `server/db.ts`.
- Describe what you verified and how. Unverified claims are rejected, not merged.

## Adding a lesson

Lessons are content, not code: create it in the Studio (`/admin/content`), write the
sections and practice questions, generate the storyboard, then render. A new *algorithm*
is code — see [docs/architecture/visualization-engine.md](docs/architecture/visualization-engine.md)
for the trace contract and the test expectations.

## Reporting problems

Security issues: follow [SECURITY.md](SECURITY.md) — never a public issue.
Everything else: open an issue with steps to reproduce and the lesson or render id that
shows the problem.
