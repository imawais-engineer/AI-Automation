# Deployment

Production is one container: Node runs the Express API and serves the compiled client from
`dist/`, with SQLite and media on a mounted volume.

## Build and run

```bash
cd visual-cs-lab
docker build -t visual-cs-lab .
docker run -d --name visual-cs-lab \
  -p 3000:3000 \
  -v vcsl-data:/data \
  -e NODE_ENV=production \
  visual-cs-lab
```

The image (`visual-cs-lab/Dockerfile`):

1. `node:22-bookworm-slim` base.
2. `npm ci --include=dev` from the lockfile — the runtime needs `tsx`, and the build needs Vite,
   so the whole lockfile is installed even under `NODE_ENV=production`.
3. `npm run build` → `dist/`.
4. `ENV DATA_DIR=/data MEDIA_DIR=/data/media`, `VOLUME /data`, `EXPOSE 3000`, `CMD npm start`.

`NODE_ENV=production` switches the server from Vite middleware to `express.static(dist)` with an
SPA fallback for non-`/api` GET requests.

## Configuration

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATA_DIR` | `/data` (on the volume) |
| `MEDIA_DIR` | `/data/media` (on the volume) |
| `DEEPGRAM_API_KEY` | only if narration is used |

Inject secrets at runtime, never into the image. Do not bake a `.env` into the build.

## Health

`GET /api/health` returns `200` with `{ ok: true, service: "visual-cs-lab", fonts: true }`.
Use it for the container healthcheck and for the load balancer. It checks that the bundled fonts
loaded, which is the one startup condition rendering cannot survive without.

## Persistence and backup

- `/data/lab.db` — all content, jobs, users and progress.
- `/data/media` — every rendered MP4, thumbnail, clip and narration take.

Back up the volume, not the repository:

```bash
docker run --rm -v vcsl-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/vcsl-$(date +%F).tar.gz -C /data .
```

Restore by extracting into a fresh volume before starting the container. Losing the volume means
re-rendering every video.

## Upgrading

1. Back up the volume.
2. Build the new image.
3. Stop the old container, start the new one on the same volume.
4. Schema changes run at boot (`server/db.ts` is idempotent); additive columns keep existing rows.
5. Verify `GET /api/health`, open one public lesson, and open one Studio page.

## Reverse proxy / HTTPS

Terminate TLS in front of the container (a platform proxy, Caddy, nginx, a load balancer). The
app does not manage certificates. Session cookies are HttpOnly; if the app is served over HTTPS
by a proxy, ensure `X-Forwarded-Proto` is preserved so secure-cookie behaviour is correct.

## This workspace

The development preview in this sandbox runs the app **from the cloned source** through a Compose
file kept in the platform's environment repository (not in this Git tree), with the repository
bind-mounted, a live dev server on port 3000 and the database/media on a named volume. That file
is the runbook for local preview only; the Dockerfile above is the production path.
