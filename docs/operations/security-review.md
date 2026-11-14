# Security and administration review

Scope: authentication, sessions, role permissions, administrative API, uploads, secrets, and the
accounts that exist in the current database. Read-only review — **no account was changed, deleted
or disabled** by this task.

Verified against this branch's code and against the running database (`/data/lab.db`, read-only
queries) on 2026-11-14.

## 1. Accounts found (production data)

| id | email | name | role | created | Assessment |
| --- | --- | --- | --- | --- | --- |
| `5e6da71e92cfca048cda4a70` | `studio@visual-cs.local` | Batch 1 Review | `admin` | 2026-10-29 | Local-domain operational account; admin rights. Confirm it is still needed and whether it should be `reviewer` instead. |
| `536b50d43f023d8043162293` | `admin@mail.com` | Admin | `admin` | 2026-10-29 | **Legacy placeholder.** Generic mailbox, no owner, full admin. Decision required (see §7). |
| `44da450df04493107d0e0c8e` | `admin@visual-cs-lab.com` | Visual CS Lab Admin | `admin` | 2026-10-29 | Product-branded admin; confirm the mailbox exists and who owns it. |
| `c8e357d0c59fb7ef2cd274b2` | `essarian920@gmail.com` | Qazi Mustafa | `learner` | 2026-11-10 | A real learner account; least privilege, no action. |

Related state: **12 rows in `sessions`** (each is an active 30-day session cookie). Several probably
belong to the accounts above.

Nothing in the code creates a default or demo account: the first privileged account comes from
`POST /api/auth/bootstrap`, which is open **only** while no non-learner account exists
(`409 An administrator already exists` afterwards — covered by a contract test). Every other account
is created by an admin through `POST /api/admin/users`.

## 2. Authentication and password handling — reviewed, sound

- Hashing: `scrypt` with a 16-byte random per-password salt and a 64-byte key, stored as
  `scrypt$<salt-hex>$<hash-hex>`; verification uses `timingSafeEqual` and rejects malformed or
  wrong-length records instead of throwing. No plaintext or reversible storage anywhere.
- Policy: 8–200 characters, at least one letter and one digit (`passwordProblem()` is shared by the
  API and every form).
- Sign-in: one error message for both unknown email and wrong password; failure throttle of 5 per
  email per 60 s, in memory.
- Registration: role is forced from the route (`register` → `learner`, `bootstrap` → `admin`); a
  request cannot choose its own role.
- Email is normalised (trim + lowercase) before every lookup, so `Admin@` and `admin@` are one
  account.

Limits (documented, not changed):

- The throttle is per process and resets on restart; it is not a shared lockout.
- No password reset flow, no password change endpoint, and therefore no rotation for an exposed
  password other than re-creating the account.

## 3. Sessions

- A session id is 32 random bytes (256 bits) hex-encoded, stored server-side in `sessions` with an
  expiry (30 days). The cookie carries the id only; there is no signed payload to forge.
- Cookie attributes: `HttpOnly`, `Path=/`, `SameSite=Lax`, `Max-Age=30d`, and `Secure` when the
  request is HTTPS (`x-forwarded-proto: https`) or when `BASE44_PREVIEW_MODE` is exactly `"1"`
  (the sandbox preview is served over HTTPS through the platform proxy).
- Sign-out deletes the row server-side, so a copied cookie stops working.
- Expired sessions are rejected and deleted on first use.
- Sessions are **not** rotated on sign-in or role change, and there is no "sign out everywhere"
  action. If an account is suspected compromised, the operational remedy is
  `DELETE FROM sessions WHERE user_id = '<id>';` (run by an operator, not by this task).

## 4. Authorization — verified, unchanged by the router split

- One decision function: `can(role, action)` in `server/roles.ts`. Role order:
  `learner < editor < reviewer < admin`.
- Every Studio route is mounted behind `requireAction(...)`; 401 when anonymous, 403 when the role
  is too low. The public learning API reads published content only and gates learner writes
  (`/api/learn/me`, `/api/learn/progress`, `/api/learn/bookmarks`, `PATCH /api/auth/me`) behind
  `requireUser`.
- The new contract suite pins this for **all 84 Studio-protected routes (of 95 route entries pinned in total)**: 401 for anonymous, 403 for every
  role below the minimum action role, and "not 401/403" at and above it. Narrower gates are tested
  explicitly (an editor cannot publish, approve, or manage users).

## 5. Administrative API, uploads, secrets

- **Admin API**: role-gated per route, not by URL obscurity; the same rules apply whether or not a
  navigation item is shown. Users cannot delete themselves, the last admin cannot be demoted or
  deleted, and an unknown role is rejected (all covered by tests).
- **Uploads**: the only user-supplied file is a lesson thumbnail, sent as a
  `data:image/(png|jpeg|webp);base64,…` string. It is restricted to those three types, capped at
  4 MB, decoded by the image library, redrawn into a fixed 1080×1920 canvas and re-encoded to PNG
  before being written — an uploaded file is never stored or served byte-for-byte, and SVG (and
  therefore script-bearing images) is not accepted. There is no general-purpose file upload.
  Narration audio and video variants are generated server-side.
- **Secrets**: provider keys (`DEEPGRAM_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`) live in the
  platform's encrypted store and reach the process through `/run/base44/app.env`; they are not in
  the repository (`*.env` is gitignored, `.env.example` contains names and empty values only). The
  backup manifest records configuration **names** and which of them were present, never values.
- **Error responses**: the API now answers JSON for every failure, and a thrown handler returns a
  generic `500 {"error":"That request could not be completed."}` with the detail only in the server
  log — previously an unhandled error in development returned Express's HTML page with a stack
  trace. Client errors raised by the body parser keep their own 4xx status.

## 6. Findings

| # | Severity | Finding | Recommendation | Status |
| --- | --- | --- | --- | --- |
| 1 | **High** | `admin@mail.com` is a full admin on a generic mailbox nobody demonstrably owns. | Owner decision required (§7). If not theirs: delete after confirming another admin can sign in. | Open — needs the account owner |
| 2 | Medium | Two more admin accounts (`studio@visual-cs.local`, `admin@visual-cs-lab.com`) whose ownership/mailbox is unverified; all three were created the same day (2026-10-29), the first two within 90 minutes. | Confirm each owner; downgrade to `reviewer` if the account only approves content. | Open — needs the owner |
| 3 | Medium | 12 live session rows, several possibly from those accounts; sessions live 30 days and are not rotated. | After deciding on the accounts, delete their sessions (`DELETE FROM sessions WHERE user_id = …`). | Open |
| 4 | Medium | No CSRF token on state-changing requests. `SameSite=Lax` blocks cross-site cookie-bearing POSTs from other sites, which is the main protection; a same-site XSS would bypass it. | Accept for now (single-origin app, JSON API); revisit if a second origin is ever allowed. | Documented |
| 5 | Medium | No security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`) and no HSTS policy in the app. The preview proxy handles framing; the app does not set its own policy. | Add headers at the reverse proxy for production, or in `server/app.ts` with a CSP that matches the Vite build. Not added here to avoid breaking the preview's framing. | Open |
| 6 | Low | Async route handlers rely on internal try/catch; Express 4 does not forward a rejected promise to the JSON error handler, so an unexpected async throw could become an unhandled rejection. | Wrap async handlers (or move to Express 5). Behaviour unchanged in this task. | Open |
| 7 | Low | Sign-in throttle is per process and per email only; no IP-based limit, no lockout after long campaigns. | Fine for a single-instance Studio; add a shared limiter if the API is ever scaled. | Documented |
| 8 | Low | `x-powered-by: Express` advertised the framework. | `app.disable('x-powered-by')` added, with a contract test. | **Fixed** |
| 9 | Low | No audit trail of admin actions (role changes, deletes, publishes). | Out of scope here; consider an `audit_log` table if more than one operator gets Studio access. | Open |
| 10 | Info | Learner content is public by design; the public API never returns drafts, render internals, sessions or password material (contract tests assert the response shapes). | Keep the public/Studio split as-is. | Verified |

## 7. Required administrative decision — `admin@mail.com`

This task did not touch the account. To close it, the owner of the deployment must answer one
question: **was `admin@mail.com` created by you (or someone you authorised) on 2026-10-29?**

- **If yes:** keep it if needed, but change its password (there is no password-change endpoint yet —
  create a replacement admin, then remove this one), or downgrade it to `reviewer`.
- **If no / unknown:** treat it as unauthorised access. The safe sequence is:
  1. confirm you can still sign in as another admin (`admin@visual-cs-lab.com` or
     `studio@visual-cs.local`);
  2. delete the sessions of the unknown account:
     `DELETE FROM sessions WHERE user_id = '536b50d43f023d8043162293';`
  3. delete the account through the API as an admin —
     `DELETE /api/admin/users/536b50d43f023d8043162293` — or with
     `DELETE FROM users WHERE id = '536b50d43f023d8043162293';`
  4. review what changed under that account (lessons, renders, publish entries) using
     `updated_at`/`created_at`, and check `render_jobs`/`publish_jobs` for entries you do not
     recognise;
  5. rotate the provider keys (`DEEPGRAM_API_KEY`, `OPENAI_API_KEY`) in the dashboard.

Do the same review for the other two admin accounts, and decide whether
`studio@visual-cs.local` (a non-routable local address) should remain an admin at all.
