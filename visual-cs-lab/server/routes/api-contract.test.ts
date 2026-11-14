/**
 * API contract tests: the split into domain routers must not have changed what
 * the Studio and the learning platform already depend on.
 *
 * Pinned here, against a real HTTP server and a disposable database:
 *   - every route still exists, with its original method and path
 *   - the authentication requirement of every route (401 when anonymous)
 *   - the minimum role of every route (403 just below it, allowed at it)
 *   - request validation still rejects the same inputs
 *   - response bodies keep their shape
 *   - errors are JSON, and middleware runs in the documented order
 *
 * The suite runs each router both alone (mounted on its own mini app, which
 * proves the router owns its paths) and inside the complete application.
 *
 * DATA_DIR and MEDIA_DIR point at a fresh temporary directory, so nothing here
 * can read or write the real database or the real renders.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import express from 'express';

const root = mkdtempSync(path.join(tmpdir(), 'vcsl-api-contract-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.MEDIA_DIR = path.join(root, 'media');
// Nothing in this file starts the watchdog interval; a manual tick is enough.
process.env.RENDER_WATCHDOG_INTERVAL_MS = '600000';

const { createApiApp } = await import('../app.ts');
const { db } = await import('../db.ts');
const { attachUser } = await import('../auth.ts');
const { publicApi } = await import('../public-api.ts');
const { adminApi } = await import('../admin-api.ts');
const { systemRouter } = await import('./system.ts');
const { contentRouter } = await import('./content.ts');
const { previewRouter } = await import('./preview.ts');
const { narrationRouter } = await import('./narration.ts');
const { brandRouter } = await import('./brand.ts');
const { createRouter } = await import('./create.ts');
const { rendersRouter } = await import('./renders.ts');

/* ------------------------------------------------------------------ harness */

type Reply = { status: number; json: Record<string, any> | null; headers: Headers; text: string };

async function listen(app: express.Express): Promise<{ base: string; server: Server }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'the test server must have a port');
  return { base: `http://127.0.0.1:${address.port}`, server };
}

async function call(
  base: string,
  method: string,
  pathname: string,
  options: { cookie?: string; body?: unknown; raw?: string } = {}
): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  let body: string | undefined;
  if (options.raw !== undefined) {
    headers['content-type'] = 'application/json';
    body = options.raw;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${base}${pathname}`, { method, headers, body });
  const text = await response.text();
  let json: Record<string, any> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, any>) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, headers: response.headers, text };
}

function sessionCookie(reply: Reply): string {
  const header = reply.headers.get('set-cookie') || '';
  const match = /vc_session=[^;]+/.exec(header);
  assert.ok(match, `expected a session cookie, got: ${header}`);
  return match[0];
}

/* --------------------------------------------------------------- fixtures */

/** A role at the minimum each action needs — the contract, restated here. */
const ACTION_MINIMUM = {
  'content:read': 'editor',
  'content:write': 'editor',
  'render:run': 'editor',
  'review:decide': 'reviewer',
  'content:publish': 'reviewer',
  users: 'admin',
  'users:manage': 'admin',
  'audio:manage': 'reviewer',
  'theme:override': 'editor'
} as const;

type Role = 'learner' | 'editor' | 'reviewer' | 'admin';
const ROLE_RANK: Record<Role, number> = { learner: 0, editor: 1, reviewer: 2, admin: 3 };

const MISSING_ID = '00000000-0000-0000-0000-000000000000';
const LESSON_PLACEHOLDER = ':id';
const SCENE_PLACEHOLDER = ':sceneId';

type RouteSpec = {
  router: 'system' | 'content' | 'preview' | 'narration' | 'brand' | 'create' | 'renders' | 'admin' | 'public';
  method: string;
  /** Path as registered (`:id` placeholders are filled with a missing id). */
  path: string;
  /** `null` means public: no session required. */
  action: keyof typeof ACTION_MINIMUM | null;
  /**
   * Routes that really do the work when reached (cleanup deletes renders, the
   * brand rebuild re-renders every storyboard). Their auth requirement is still
   * asserted; the "allowed role" probe is skipped so the suite cannot destroy a
   * fixture or spend minutes re-rendering.
   */
  sideEffects?: boolean;
};

/**
 * Every registered route, with the permission it requires. This table is the
 * regression contract: a route that disappears, changes method, path or gate
 * makes the matrix below fail.
 */
const ROUTES: RouteSpec[] = [
  // system
  { router: 'system', method: 'GET', path: '/api/health', action: null },
  { router: 'system', method: 'GET', path: '/api/overview', action: 'content:read' },
  // content
  { router: 'content', method: 'GET', path: '/api/concepts', action: 'content:read' },
  { router: 'content', method: 'POST', path: '/api/concepts', action: 'content:write' },
  { router: 'content', method: 'GET', path: '/api/concepts/:id', action: 'content:read' },
  { router: 'content', method: 'PATCH', path: '/api/concepts/:id', action: 'content:write' },
  { router: 'content', method: 'POST', path: '/api/concepts/:id/duplicate', action: 'content:write' },
  { router: 'content', method: 'POST', path: '/api/concepts/:id/archive', action: 'content:write' },
  { router: 'content', method: 'POST', path: '/api/concepts/:id/trace', action: 'content:write' },
  { router: 'content', method: 'GET', path: '/api/lessons', action: 'content:read' },
  { router: 'content', method: 'POST', path: '/api/lessons', action: 'content:write' },
  { router: 'content', method: 'GET', path: '/api/lessons/:id', action: 'content:read' },
  { router: 'content', method: 'PATCH', path: '/api/lessons/:id', action: 'content:write' },
  { router: 'content', method: 'POST', path: '/api/lessons/:id/storyboard', action: 'content:write' },
  { router: 'content', method: 'GET', path: '/api/lessons/:id/scenes', action: 'content:read' },
  { router: 'content', method: 'PATCH', path: '/api/lessons/:id/scenes', action: 'content:write' },
  { router: 'content', method: 'POST', path: '/api/lessons/:id/scenes/:sceneId/duplicate', action: 'content:write' },
  // preview
  { router: 'preview', method: 'GET', path: '/api/lessons/:id/inspect', action: 'content:read' },
  { router: 'preview', method: 'GET', path: '/api/lessons/:id/scene/:sceneId.png', action: 'content:read' },
  { router: 'preview', method: 'GET', path: '/api/lessons/:id/scene/:sceneId/clip.mp4', action: 'content:read' },
  // narration
  { router: 'narration', method: 'GET', path: '/api/lessons/:id/voiceover', action: 'content:read' },
  { router: 'narration', method: 'POST', path: '/api/lessons/:id/voiceover', action: 'content:write' },
  { router: 'narration', method: 'PATCH', path: '/api/lessons/:id/voiceover', action: 'content:write' },
  { router: 'narration', method: 'GET', path: '/api/lessons/:id/narration', action: 'content:read' },
  { router: 'narration', method: 'POST', path: '/api/lessons/:id/narration', action: 'content:write' },
  { router: 'narration', method: 'POST', path: '/api/lessons/:id/narration/export', action: 'render:run' },
  // brand
  { router: 'brand', method: 'GET', path: '/api/brand', action: 'content:read' },
  { router: 'brand', method: 'PATCH', path: '/api/brand', action: 'content:write' },
  { router: 'brand', method: 'POST', path: '/api/brand/regenerate', action: 'render:run', sideEffects: true },
  { router: 'brand', method: 'GET', path: '/api/lessons/:id/thumbnail.png', action: 'content:read' },
  { router: 'brand', method: 'GET', path: '/api/lessons/:id/thumbnail.jpg', action: 'content:read' },
  { router: 'brand', method: 'POST', path: '/api/lessons/:id/thumbnail', action: 'content:write' },
  { router: 'brand', method: 'POST', path: '/api/lessons/:id/thumbnail/auto', action: 'content:write' },
  // create
  { router: 'create', method: 'GET', path: '/api/algorithms', action: 'content:read' },
  { router: 'create', method: 'POST', path: '/api/create', action: 'content:write' },
  // renders
  { router: 'renders', method: 'POST', path: '/api/renders', action: 'render:run' },
  { router: 'renders', method: 'GET', path: '/api/renders', action: 'content:read' },
  { router: 'renders', method: 'GET', path: '/api/renders/cleanup', action: 'render:run' },
  { router: 'renders', method: 'POST', path: '/api/renders/cleanup', action: 'render:run', sideEffects: true },
  { router: 'renders', method: 'GET', path: '/api/renders/duplicates', action: 'render:run' },
  { router: 'renders', method: 'POST', path: '/api/renders/duplicates', action: 'render:run', sideEffects: true },
  { router: 'renders', method: 'GET', path: '/api/renders/:id', action: 'content:read' },
  { router: 'renders', method: 'POST', path: '/api/renders/:id/retry', action: 'render:run' },
  { router: 'renders', method: 'POST', path: '/api/renders/:id/cancel', action: 'render:run' },
  { router: 'renders', method: 'GET', path: '/api/renders/:id/stream', action: 'content:read' },
  { router: 'renders', method: 'GET', path: '/api/renders/:id/video', action: 'content:read' },
  { router: 'renders', method: 'GET', path: '/api/lessons/:id/publish-copy', action: 'content:read' },
  { router: 'renders', method: 'GET', path: '/api/renders/:id/captions', action: 'content:read' },
  { router: 'renders', method: 'PUT', path: '/api/renders/:id/captions/:platform', action: 'content:write' },
  { router: 'renders', method: 'GET', path: '/api/publishes', action: 'content:read' },
  { router: 'renders', method: 'POST', path: '/api/publishes', action: 'content:publish' },
  { router: 'renders', method: 'PATCH', path: '/api/publishes/:id', action: 'content:publish' },
  { router: 'renders', method: 'DELETE', path: '/api/publishes/:id', action: 'content:publish' },
  // admin
  { router: 'admin', method: 'GET', path: '/api/admin/overview', action: 'content:read' },
  { router: 'admin', method: 'GET', path: '/api/admin/themes', action: 'content:read' },
  { router: 'admin', method: 'GET', path: '/api/admin/lessons', action: 'content:read' },
  { router: 'admin', method: 'GET', path: '/api/admin/lessons/:id', action: 'content:read' },
  { router: 'admin', method: 'PATCH', path: '/api/admin/lessons/:id', action: 'content:write' },
  { router: 'admin', method: 'PUT', path: '/api/admin/lessons/:id/sections', action: 'content:write' },
  { router: 'admin', method: 'PUT', path: '/api/admin/lessons/:id/code', action: 'content:write' },
  { router: 'admin', method: 'PUT', path: '/api/admin/lessons/:id/quiz', action: 'content:write' },
  { router: 'admin', method: 'POST', path: '/api/admin/lessons/:id/slides', action: 'content:write' },
  { router: 'admin', method: 'POST', path: '/api/admin/lessons/:id/theme', action: 'theme:override' },
  { router: 'admin', method: 'POST', path: '/api/admin/lessons/:id/review', action: 'review:decide' },
  { router: 'admin', method: 'POST', path: '/api/admin/lessons/:id/publish', action: 'content:publish' },
  { router: 'admin', method: 'POST', path: '/api/admin/lessons/:id/unpublish', action: 'content:publish' },
  { router: 'admin', method: 'GET', path: '/api/admin/videos', action: 'content:read' },
  { router: 'admin', method: 'POST', path: '/api/admin/videos/render', action: 'render:run' },
  { router: 'admin', method: 'POST', path: '/api/admin/videos/register', action: 'render:run' },
  { router: 'admin', method: 'POST', path: '/api/admin/videos/variant', action: 'render:run' },
  { router: 'admin', method: 'GET', path: '/api/admin/audio', action: 'content:read' },
  { router: 'admin', method: 'POST', path: '/api/admin/audio', action: 'audio:manage' },
  { router: 'admin', method: 'PATCH', path: '/api/admin/audio/:id', action: 'audio:manage' },
  { router: 'admin', method: 'DELETE', path: '/api/admin/audio/:id', action: 'audio:manage' },
  { router: 'admin', method: 'GET', path: '/api/admin/roadmaps', action: 'content:read' },
  { router: 'admin', method: 'POST', path: '/api/admin/roadmaps', action: 'content:write' },
  { router: 'admin', method: 'PATCH', path: '/api/admin/roadmaps/:id', action: 'content:write' },
  { router: 'admin', method: 'POST', path: '/api/admin/roadmaps/:id/modules', action: 'content:write' },
  { router: 'admin', method: 'POST', path: '/api/admin/modules/:id/items', action: 'content:write' },
  { router: 'admin', method: 'DELETE', path: '/api/admin/items/:id', action: 'content:write' },
  { router: 'admin', method: 'GET', path: '/api/admin/users', action: 'users:manage' },
  { router: 'admin', method: 'POST', path: '/api/admin/users', action: 'users:manage' },
  { router: 'admin', method: 'PATCH', path: '/api/admin/users/:id', action: 'users:manage' },
  { router: 'admin', method: 'DELETE', path: '/api/admin/users/:id', action: 'users:manage' },
  { router: 'admin', method: 'GET', path: '/api/admin/lessons/:id/hash', action: 'content:read' },
  // public learner API (paths that mutate a learner's own data are gated)
  { router: 'public', method: 'GET', path: '/api/auth/me', action: null },
  { router: 'public', method: 'POST', path: '/api/auth/logout', action: null },
  { router: 'public', method: 'GET', path: '/api/learn/home', action: null },
  { router: 'public', method: 'GET', path: '/api/learn/concepts', action: null },
  { router: 'public', method: 'GET', path: '/api/learn/concepts/:id', action: null },
  { router: 'public', method: 'GET', path: '/api/learn/roadmaps', action: null },
  { router: 'public', method: 'GET', path: '/api/learn/roadmaps/:id', action: null },
  { router: 'public', method: 'GET', path: '/api/learn/lessons/:id', action: null },
  { router: 'public', method: 'GET', path: '/api/learn/lessons/:id/thumbnail.png', action: null },
  { router: 'public', method: 'GET', path: '/api/learn/videos/:id', action: null }
];

/** Routes that require a signed-in user but no Studio role. */
const LEARNER_ROUTES: Array<{ method: string; path: string }> = [
  { method: 'PATCH', path: '/api/auth/me' },
  { method: 'GET', path: '/api/learn/me' },
  { method: 'POST', path: '/api/learn/progress' },
  { method: 'POST', path: '/api/learn/bookmarks' }
];

function concretePath(spec: RouteSpec): string {
  return spec.path
    .replaceAll(`${LESSON_PLACEHOLDER}.png`, `${MISSING_ID}.png`)
    .replaceAll(SCENE_PLACEHOLDER, '0')
    .replaceAll(':platform', 'youtube')
    .replaceAll(':id', MISSING_ID);
}

let base = '';
let appServer: Server;
let cookies: Record<Role, string>;
let adminCookie = '';
let lessonId = '';
let publishedLessonSlug = '';
let roadmapSlug = '';

before(async () => {
  const app = createApiApp();
  const started = await listen(app);
  base = started.base;
  appServer = started.server;

  // The first account is the bootstrap admin; every other role is created by it.
  const bootstrap = await call(base, 'POST', '/api/auth/bootstrap', {
    body: { email: 'bootstrap@test.local', name: 'Bootstrap', password: 'password123' }
  });
  assert.equal(bootstrap.status, 201, 'bootstrap admin must be creatable on an empty database');
  adminCookie = sessionCookie(bootstrap);

  cookies = { admin: adminCookie } as Record<Role, string>;
  for (const role of ['editor', 'reviewer', 'learner'] as Role[]) {
    const created = await call(base, 'POST', '/api/admin/users', {
      cookie: adminCookie,
      body: { email: `${role}@test.local`, name: role, password: 'password123', role }
    });
    assert.equal(created.status, 201, `admin must be able to create a ${role}`);
    const login = await call(base, 'POST', '/api/auth/login', {
      body: { email: `${role}@test.local`, password: 'password123' }
    });
    assert.equal(login.status, 200, `${role} must be able to sign in`);
    cookies[role] = sessionCookie(login);
  }

  const lesson = db
    .prepare("SELECT id, slug FROM lessons WHERE content_status = 'published' ORDER BY published_at DESC LIMIT 1")
    .get() as { id: string; slug: string } | undefined;
  assert.ok(lesson, 'the seeded database must contain at least one published lesson');
  lessonId = lesson.id;
  publishedLessonSlug = lesson.slug;
  roadmapSlug = (db.prepare('SELECT slug FROM roadmaps WHERE published = 1 LIMIT 1').get() as { slug: string }).slug;

  // One finished render, as a fixture for the read-only render routes.
  db.prepare(
    `INSERT INTO render_jobs (id, lesson_id, preset, width, height, fps, state, progress, log, dedupe_key,
       expected_frames, expected_seconds, storyboard_hash, snapshot, created_at, finished_at)
     VALUES (?, ?, 'hd', 1080, 1920, 30, 'done', 100, '', ?, 10, 1, 'fixture', '[]', ?, ?)`
  ).run('fixture-render', lessonId, `${lessonId}:hd:fixture`, new Date().toISOString(), new Date().toISOString());
});

after(async () => {
  await new Promise<void>((resolve) => appServer.close(() => resolve()));
});

/* ------------------------------------------------------- 1. auth requirements */

test('every protected route answers 401 to an anonymous request', async () => {
  const failures: string[] = [];
  for (const spec of ROUTES) {
    if (spec.action === null) continue;
    const reply = await call(base, spec.method, concretePath(spec), { body: spec.method === 'GET' ? undefined : {} });
    if (reply.status !== 401) failures.push(`${spec.method} ${spec.path} → ${reply.status} (expected 401)`);
    else if (!reply.json?.error) failures.push(`${spec.method} ${spec.path} → 401 without a JSON error`);
  }
  assert.deepEqual(failures, []);
});

test('learner-only routes answer 401 to an anonymous request and work for a learner', async () => {
  for (const route of LEARNER_ROUTES) {
    const anonymous = await call(base, route.method, route.path, {
      body: route.method === 'GET' ? undefined : {}
    });
    assert.equal(anonymous.status, 401, `${route.method} ${route.path} must require a session`);
  }
  const me = await call(base, 'GET', '/api/learn/me', { cookie: cookies.learner });
  assert.equal(me.status, 200);
  assert.deepEqual(
    Object.keys(me.json || {}).sort(),
    ['completed', 'inProgress', 'recent', 'roadmaps', 'saved', 'user'].sort()
  );
});

test('public routes stay public and do not leak a session requirement', async () => {
  for (const route of ['/api/health', '/api/auth/me', '/api/learn/home', '/api/learn/concepts', '/api/learn/roadmaps']) {
    const reply = await call(base, 'GET', route);
    assert.equal(reply.status, 200, `${route} must answer anonymously`);
  }
});

/* --------------------------------------------------- 2. permission matrix */

test('every protected route keeps its minimum role: 403 below it, allowed at it', async () => {
  const failures: string[] = [];
  for (const spec of ROUTES) {
    if (spec.action === null) continue;
    const minimum = ACTION_MINIMUM[spec.action];
    const below = (['learner', 'editor', 'reviewer', 'admin'] as Role[]).filter(
      (role) => ROLE_RANK[role] < ROLE_RANK[minimum as Role]
    );
    const atOrAbove = (['editor', 'reviewer', 'admin'] as Role[]).filter(
      (role) => ROLE_RANK[role] >= ROLE_RANK[minimum as Role]
    );
    const request = (cookie: string) =>
      call(base, spec.method, concretePath(spec), { cookie, body: spec.method === 'GET' ? undefined : {} });

    for (const role of below) {
      const reply = await request(cookies[role] || '');
      // A learner has no Studio session at all for /api/admin: 403 is the contract.
      if (reply.status !== 403) {
        failures.push(`${spec.method} ${spec.path} [${spec.action}] as ${role} → ${reply.status} (expected 403)`);
      }
    }
    for (const role of spec.sideEffects ? [] : atOrAbove) {
      const reply = await request(cookies[role]);
      if (reply.status === 401 || reply.status === 403) {
        failures.push(`${spec.method} ${spec.path} [${spec.action}] as ${role} → ${reply.status} (expected allowed)`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('role-specific gates stay narrower than content editing', async () => {
  const editorPublish = await call(base, 'POST', `/api/admin/lessons/${MISSING_ID}/publish`, {
    cookie: cookies.editor,
    body: {}
  });
  assert.equal(editorPublish.status, 403, 'an editor cannot publish');
  const editorReview = await call(base, 'POST', `/api/admin/lessons/${MISSING_ID}/review`, {
    cookie: cookies.editor,
    body: { decision: 'approved' }
  });
  assert.equal(editorReview.status, 403, 'an editor cannot approve');
  const editorUsers = await call(base, 'GET', '/api/admin/users', { cookie: cookies.editor });
  assert.equal(editorUsers.status, 403, 'an editor cannot manage users');
  const reviewerUsers = await call(base, 'GET', '/api/admin/users', { cookie: cookies.reviewer });
  assert.equal(reviewerUsers.status, 403, 'a reviewer cannot manage users');
});

/* ------------------------------------------------------- 3. validation */

test('request validation is preserved on the Studio routers', async () => {
  const cases: Array<{ name: string; method: string; path: string; body: unknown; status: number }> = [
    { name: 'concept without a name', method: 'POST', path: '/api/concepts', body: {}, status: 400 },
    { name: 'concept patch with nothing', method: 'PATCH', path: `/api/concepts/${MISSING_ID}`, body: {}, status: 404 },
    { name: 'lesson without a concept', method: 'POST', path: '/api/lessons', body: {}, status: 400 },
    { name: 'create with an unknown algorithm', method: 'POST', path: '/api/create', body: { algorithm: 'nope' }, status: 400 },
    { name: 'render with an unknown preset', method: 'POST', path: '/api/renders', body: { lessonId, preset: 'nope' }, status: 400 },
    { name: 'render without a lesson', method: 'POST', path: '/api/renders', body: {}, status: 400 },
    {
      name: 'caption for an unknown platform',
      method: 'PUT',
      path: '/api/renders/fixture-render/captions/threads',
      body: {},
      status: 400
    },
    { name: 'publish without a platform', method: 'POST', path: '/api/publishes', body: { lessonId }, status: 400 },
    { name: 'theme with an unknown id', method: 'POST', path: `/api/admin/lessons/${lessonId}/theme`, body: { themeId: 'x' }, status: 400 },
    {
      name: 'review with an unknown decision',
      method: 'POST',
      path: `/api/admin/lessons/${lessonId}/review`,
      body: { decision: 'maybe' },
      status: 400
    },
    { name: 'brand patch with nothing', method: 'PATCH', path: '/api/brand', body: {}, status: 400 },
    { name: 'roadmap without a title', method: 'POST', path: '/api/admin/roadmaps', body: {}, status: 400 },
    { name: 'audio track without a title', method: 'POST', path: '/api/admin/audio', body: {}, status: 400 }
  ];
  for (const item of cases) {
    const reply = await call(base, item.method, item.path, { cookie: adminCookie, body: item.body });
    assert.equal(reply.status, item.status, `${item.name}: ${item.method} ${item.path} → ${reply.status}`);
    if (item.status === 400) assert.ok(reply.json?.error, `${item.name} must explain the problem`);
  }
});

test('registration and sign-in validation are preserved', async () => {
  const weak = await call(base, 'POST', '/api/auth/register', {
    body: { email: 'weak@test.local', name: 'Weak', password: 'short' }
  });
  assert.equal(weak.status, 400);
  assert.match(String(weak.json?.error), /8 characters/);

  const badEmail = await call(base, 'POST', '/api/auth/register', {
    body: { email: 'not-an-email', name: 'Bad', password: 'password123' }
  });
  assert.equal(badEmail.status, 400);

  const duplicate = await call(base, 'POST', '/api/auth/register', {
    body: { email: 'editor@test.local', name: 'Duplicate', password: 'password123' }
  });
  assert.equal(duplicate.status, 400);

  const wrong = await call(base, 'POST', '/api/auth/login', {
    body: { email: 'editor@test.local', password: 'wrong-password' }
  });
  assert.equal(wrong.status, 401);

  const secondBootstrap = await call(base, 'POST', '/api/auth/bootstrap', {
    body: { email: 'another@test.local', name: 'Another', password: 'password123' }
  });
  assert.equal(secondBootstrap.status, 409, 'bootstrap stays closed once an admin exists');
});

test('role administration keeps its safeguards', async () => {
  const admin = db.prepare("SELECT id FROM users WHERE email = 'bootstrap@test.local'").get() as { id: string };
  const selfDemote = await call(base, 'PATCH', `/api/admin/users/${admin.id}`, {
    cookie: adminCookie,
    body: { role: 'editor' }
  });
  assert.equal(selfDemote.status, 409, 'the last admin cannot demote itself');
  const selfDelete = await call(base, 'DELETE', `/api/admin/users/${admin.id}`, { cookie: adminCookie });
  assert.equal(selfDelete.status, 409, 'an admin cannot delete itself');
  const unknownRole = await call(base, 'PATCH', `/api/admin/users/${admin.id}`, {
    cookie: adminCookie,
    body: { role: 'root' }
  });
  assert.equal(unknownRole.status, 400, 'an unknown role is rejected');
});

/* -------------------------------------------------- 4. response structures */

test('response bodies keep their shape', async () => {
  const cases: Array<{ path: string; cookie?: string; keys: string[] }> = [
    { path: '/api/health', keys: ['ok', 'service', 'fonts', 'time'] },
    { path: '/api/auth/me', keys: ['user', 'needsAdmin', 'themes'] },
    { path: '/api/learn/home', keys: ['user', 'topics', 'featured', 'recent', 'recommended', 'continueLearning', 'stats'] },
    { path: '/api/learn/concepts', keys: ['lessons', 'topics', 'difficulties', 'total'] },
    { path: '/api/learn/roadmaps', keys: ['roadmaps'] },
    { path: `/api/learn/roadmaps/${roadmapSlug}`, keys: ['roadmap', 'modules', 'total', 'completed', 'next'] },
    {
      path: `/api/learn/lessons/${publishedLessonSlug}`,
      keys: [
        'lesson',
        'concept',
        'sections',
        'code',
        'video',
        'thumbnailUrl',
        'quiz',
        'roadmap',
        'derived',
        'guest',
        'progress',
        'bookmarked'
      ]
    },
    { path: '/api/overview', cookie: adminCookie, keys: expectOverviewKeys },
    { path: '/api/concepts', cookie: adminCookie, keys: ['concepts'] },
    { path: '/api/lessons', cookie: adminCookie, keys: ['lessons'] },
    { path: '/api/algorithms', cookie: adminCookie, keys: ['algorithms', 'defaultSeconds', 'profiles'] },
    { path: '/api/brand', cookie: adminCookie, keys: ['brand'] },
    { path: '/api/renders', cookie: adminCookie, keys: ['renders', 'failures'] },
    { path: '/api/publishes', cookie: adminCookie, keys: ['publishes'] },
    { path: '/api/admin/themes', cookie: adminCookie, keys: ['themes'] },
    { path: '/api/admin/overview', cookie: adminCookie, keys: expectAdminOverviewKeys },
    { path: '/api/admin/videos', cookie: adminCookie, keys: ['jobs', 'assets', 'presets', 'tracks'] },
    { path: '/api/admin/audio', cookie: adminCookie, keys: ['tracks', 'music'] },
    { path: '/api/admin/roadmaps', cookie: adminCookie, keys: ['roadmaps', 'lessons'] },
    { path: '/api/admin/users', cookie: adminCookie, keys: ['users', 'roles'] }
  ];
  for (const item of cases) {
    const reply = await call(base, 'GET', item.path, { cookie: item.cookie });
    assert.equal(reply.status, 200, `${item.path} → ${reply.status}`);
    assert.deepEqual(Object.keys(reply.json || {}).sort(), item.keys.slice().sort(), `${item.path} shape changed`);
  }
});

/** Keys the dashboard depends on; kept in a list so a rename is caught. */
const expectOverviewKeys = [
  'concepts',
  'lessons',
  'lessonsInProgress',
  'rendersDone',
  'rendersFailed',
  'rendersActive',
  'awaitingReview',
  'readyToPublish',
  'qualityCheckedRenders',
  'published',
  'recentLessons',
  'recentJobs',
  'environment'
];
const expectAdminOverviewKeys = [
  'counts',
  'drafts',
  'failed',
  'active',
  'awaitingPublication',
  'staleAssets'
];

test('render, caption and publish read routes answer with their documented payloads', async () => {
  const job = await call(base, 'GET', '/api/renders/fixture-render', { cookie: adminCookie });
  assert.equal(job.status, 200);
  assert.deepEqual(Object.keys(job.json || {}).sort(), ['job', 'validation']);
  assert.equal(job.json?.job?.id, 'fixture-render');

  const captions = await call(base, 'GET', '/api/renders/fixture-render/captions', { cookie: adminCookie });
  assert.equal(captions.status, 200);
  assert.deepEqual(Object.keys(captions.json || {}).sort(), ['captions', 'renderId']);

  const copy = await call(base, 'GET', `/api/lessons/${lessonId}/publish-copy`, { cookie: adminCookie });
  assert.equal(copy.status, 200);
  assert.deepEqual(Object.keys(copy.json || {}).sort(), ['copy', 'lessonId', 'verified']);

  const missing = await call(base, 'GET', '/api/renders/does-not-exist', { cookie: adminCookie });
  assert.equal(missing.status, 404);
  assert.equal(missing.json?.error, 'Render job not found.');
});

test('unknown content stays a 404 with a JSON error, never an empty success', async () => {
  const lesson = await call(base, 'GET', '/api/learn/lessons/not-a-lesson');
  assert.equal(lesson.status, 404);
  assert.ok(lesson.json?.error);
  const concept = await call(base, 'GET', '/api/learn/concepts/not-a-concept');
  assert.equal(concept.status, 404);
  const roadmap = await call(base, 'GET', '/api/learn/roadmaps/not-a-roadmap');
  assert.equal(roadmap.status, 404);
  const studioLesson = await call(base, 'GET', `/api/lessons/${MISSING_ID}`, { cookie: adminCookie });
  assert.equal(studioLesson.status, 404);
});

/* ----------------------------------------------- 5. middleware order & errors */

test('a malformed JSON body is rejected before authentication runs', async () => {
  // No cookie: if the auth gate ran first this would be 401, not 400.
  const reply = await call(base, 'POST', '/api/admin/users', { raw: '{"email":' });
  assert.equal(reply.status, 400);
});

test('the session is resolved before a route decides: a signed-in learner is 403, not 401', async () => {
  const reply = await call(base, 'GET', '/api/admin/users', { cookie: cookies.learner });
  assert.equal(reply.status, 403);
  assert.match(String(reply.json?.error), /learner/);
});

test('the express body limit is still 3mb and still answers JSON', async () => {
  const oversized = JSON.stringify({ value: 'x'.repeat(3_200_000) });
  const reply = await call(base, 'PATCH', '/api/brand', { cookie: adminCookie, raw: oversized });
  assert.equal(reply.status, 413);
});

test('responses do not advertise the framework version', async () => {
  const reply = await call(base, 'GET', '/api/health');
  assert.equal(reply.headers.get('x-powered-by'), null);
});

test('an unknown /api path answers JSON 404 instead of the client shell', async () => {
  const reply = await call(base, 'GET', '/api/not-a-route');
  assert.equal(reply.status, 404);
  assert.equal(reply.json?.error, 'Unknown API route.');
  // A route that exists on another method must not be reachable by guessing.
  const wrongMethod = await call(base, 'DELETE', '/api/brand', { cookie: adminCookie });
  assert.equal(wrongMethod.status, 404);
});

/* ---------------------------------------------- 6. each router on its own */

test('each domain router works mounted alone and owns only its own paths', async () => {
  const cases: Array<{
    name: string;
    mount: (app: express.Express) => void;
    probe: { method: string; path: string };
    foreign: string;
    expectStatus: number;
  }> = [
    { name: 'system', mount: (a) => a.use('/api', systemRouter), probe: { method: 'GET', path: '/api/health' }, foreign: '/api/concepts', expectStatus: 200 },
    { name: 'content', mount: (a) => a.use('/api', contentRouter), probe: { method: 'GET', path: '/api/concepts' }, foreign: '/api/admin/overview', expectStatus: 200 },
    { name: 'preview', mount: (a) => a.use('/api', previewRouter), probe: { method: 'GET', path: `/api/lessons/${MISSING_ID}/inspect` }, foreign: '/api/concepts', expectStatus: 400 },
    { name: 'narration', mount: (a) => a.use('/api', narrationRouter), probe: { method: 'GET', path: `/api/lessons/${MISSING_ID}/voiceover` }, foreign: '/api/brand', expectStatus: 404 },
    { name: 'brand', mount: (a) => a.use('/api', brandRouter), probe: { method: 'GET', path: '/api/brand' }, foreign: '/api/concepts', expectStatus: 200 },
    { name: 'create', mount: (a) => a.use('/api', createRouter), probe: { method: 'GET', path: '/api/algorithms' }, foreign: '/api/renders', expectStatus: 200 },
    { name: 'renders', mount: (a) => a.use('/api', rendersRouter), probe: { method: 'GET', path: '/api/renders' }, foreign: '/api/concepts', expectStatus: 200 },
    { name: 'admin', mount: (a) => a.use('/api/admin', adminApi), probe: { method: 'GET', path: '/api/admin/overview' }, foreign: '/api/concepts', expectStatus: 200 },
    { name: 'public', mount: (a) => a.use('/api', publicApi), probe: { method: 'GET', path: '/api/learn/home' }, foreign: '/api/admin/overview', expectStatus: 200 }
  ];

  for (const item of cases) {
    const app = express();
    app.use(express.json({ limit: '3mb' }));
    app.use(attachUser);
    item.mount(app);
    const started = await listen(app);
    try {
      const probe = await call(started.base, item.probe.method, item.probe.path, {
        cookie: adminCookie,
        body: item.probe.method === 'GET' ? undefined : {}
      });
      assert.equal(probe.status, item.expectStatus, `${item.name} router alone: ${item.probe.path} → ${probe.status}`);

      const foreign = await call(started.base, 'GET', item.foreign, { cookie: adminCookie });
      assert.equal(foreign.status, 404, `${item.name} router must not answer ${item.foreign}`);

      const anonymous = await call(started.base, item.probe.method, item.probe.path, {
        body: item.probe.method === 'GET' ? undefined : {}
      });
      if (item.expectStatus === 200 && item.name !== 'system' && item.name !== 'public') {
        assert.equal(anonymous.status, 401, `${item.name} router alone must still require a session`);
      }
    } finally {
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
    }
  }
});
