# Environment configuration

`server/env.ts` loads a `.env` file from `visual-cs-lab/.env` before any other module reads
`process.env`. Real environment variables always win over the file, so a host's configuration
is never overridden by a checked-out `.env`. Nothing here is committed: `.env` is ignored, and
`.env.example` documents the shape with empty values.

## Variables

| Variable | Default | Required | Purpose |
| --- | --- | --- | --- |
| `PORT` | `3000` | no | HTTP port; the server binds `0.0.0.0` |
| `DATA_DIR` | `/tmp/visual-cs-lab` | no | Directory holding `lab.db` |
| `MEDIA_DIR` | `$DATA_DIR/media` | no | Rendered MP4s, thumbnails, clips, audio |
| `NODE_ENV` | — | no | `production` serves the compiled `dist/` client instead of Vite middleware |
| `DEEPGRAM_API_KEY` | — | for narration | Text-to-speech provider |
| `DEEPGRAM_BASE_URL` | `https://api.deepgram.com` | no | Alternate endpoint |
| `DEEPGRAM_TTS_MODEL` | provider default | no | Voice model |
| `OPENAI_API_KEY` | — | no | Reserved for AI-assisted drafting; nothing reads it yet |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | no | OpenAI-compatible endpoint |

The application boots, renders and passes its tests with **none** of these set. Narration is
the only feature that needs a credential, and the Studio reports "provider not configured"
instead of failing.

## Secrets policy

- Secrets are read from the environment only — never from a file in the repository, never
  logged, never returned by an API.
- The deployment injects them at runtime (compose `env_file`, the platform's managed env file,
  or the container environment).
- If a key is exposed, rotate it first, then remove it from history. Pushes are scanned with
  gitleaks (`.github/workflows/security-scan.yml`).

## Sandbox / preview notes

The development preview runs the app from the cloned source through a process manager with a
Compose file maintained outside this repository. Two rules follow from that:

- **Bind to `0.0.0.0`** and let the environment supply the public host. Nothing in the source
  hardcodes a preview hostname: Vite reads `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` from the
  environment for its allowed-host list, and the server mounts Vite in middleware mode behind
  the proxy.
- **Preview-only overrides are gated on `BASE44_PREVIEW_MODE === '1'`.** When the variable is
  absent or any other value, the original behaviour is preserved. No preview mode ever
  bypasses authentication, authorization or TLS verification.

## Production

Set at minimum `NODE_ENV=production`, `DATA_DIR` and `MEDIA_DIR` (both on a persistent volume),
plus `DEEPGRAM_API_KEY` if narration is used. See [deployment.md](deployment.md).
