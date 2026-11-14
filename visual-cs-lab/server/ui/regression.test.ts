/**
 * Browser regression suite: the React app is rendered in a real DOM (jsdom)
 * against stubbed API responses, then checked the way a person would see it.
 *
 * This is deliberately the lightest thing that still exercises the real
 * components: no browser download, no separate E2E server. It catches the two
 * failures that hurt most after a refactor — a page that no longer renders, and
 * a public page that starts showing Studio controls — plus the interactions the
 * pages depend on (search, sign-in, the render table).
 *
 * What it does NOT do: paint pixels, run CSS, or verify the API's own answers.
 * Those are covered by the route contract tests and the preview checks.
 */

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { JSDOM } from 'jsdom';

/* ------------------------------------------------------------ DOM plumbing */

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true
});
const win = dom.window as unknown as Window & typeof globalThis;
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = win;
globals.document = win.document;
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
globals.HTMLElement = win.HTMLElement;
globals.HTMLInputElement = win.HTMLInputElement;
globals.Node = win.Node;
globals.Element = win.Element;
globals.Event = win.Event;
globals.MouseEvent = win.MouseEvent;
globals.KeyboardEvent = win.KeyboardEvent;
globals.getComputedStyle = win.getComputedStyle.bind(win);
globals.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0);
globals.cancelAnimationFrame = (handle: number) => clearTimeout(handle);
// Tells React that state updates here are wrapped in act().
globals.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = await import('react-dom/test-utils');
const { MemoryRouter } = await import('react-router-dom');
const { SessionProvider } = await import('../../src/session.tsx');
const App = (await import('../../src/App.tsx')).default;

/* --------------------------------------------------------------- fixtures */

type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: 'learner' | 'editor' | 'reviewer' | 'admin';
  default_language: string;
  audio_mode: string;
  captions: number;
  reduced_motion: number;
};

const EDITOR: SessionUser = {
  id: 'user-editor',
  email: 'editor@test.local',
  name: 'Studio Editor',
  role: 'editor',
  default_language: 'en',
  audio_mode: 'silent',
  captions: 1,
  reduced_motion: 0
};
const LEARNER: SessionUser = { ...EDITOR, id: 'user-learner', email: 'learner@test.local', name: 'Ayesha', role: 'learner' };

const CARD = {
  id: 'lesson-1',
  slug: 'stacks',
  title: 'Stacks: last in, first out',
  summary: 'Push, peek and pop on one tower.',
  difficulty: 'beginner',
  topics: ['Stacks'],
  minutes: 8,
  concept: 'Stack',
  conceptSlug: 'stacks',
  category: 'Data Structures',
  complexity: 'O(1)',
  theme: 'theme_01',
  hasVideo: true
};
const CARD_2 = { ...CARD, id: 'lesson-2', slug: 'queues', title: 'Queues: first in, first out', concept: 'Queue' };

const FIXTURES: Record<string, unknown> = {
  '/api/learn/home': {
    user: null,
    topics: ['Data Structures'],
    featured: { slug: 'foundations', title: 'Foundations', description: 'Start here.', lessonCount: 2 },
    recent: [CARD, CARD_2],
    recommended: [CARD],
    continueLearning: [],
    stats: { lessons: 13, roadmaps: 1, withVideo: 12 }
  },
  '/api/learn/concepts': { lessons: [CARD, CARD_2], topics: ['Data Structures'], difficulties: ['beginner'], total: 2 },
  '/api/learn/roadmaps': {
    roadmaps: [
      {
        id: 'roadmap-1',
        slug: 'foundations',
        title: 'Foundations roadmap',
        description: 'Linear structures first.',
        prerequisites: 'None',
        outcomes: 'Trace a stack',
        lessonCount: 2
      }
    ]
  },
  '/api/learn/roadmaps/foundations': {
    roadmap: {
      slug: 'foundations',
      title: 'Foundations roadmap',
      description: 'Linear structures first.',
      prerequisites: 'None',
      outcomes: 'Trace a stack'
    },
    modules: [
      {
        id: 'module-1',
        title: 'Linear structures',
        summary: 'Stacks and queues',
        lessons: [
          { id: 'lesson-1', slug: 'stacks', title: 'Stacks', summary: '', difficulty: 'beginner', minutes: 8, state: 'available' }
        ]
      }
    ],
    total: 1,
    completed: 0,
    next: { slug: 'stacks', title: 'Stacks' }
  },
  '/api/learn/lessons/stacks': {
    lesson: { ...CARD, objectives: ['Explain LIFO'], prerequisites: 'None', hook: 'One tower.', takeaway: 'LIFO.', version: 1, publishedAt: '' },
    concept: {
      name: 'Stack',
      category: 'Data Structures',
      plain: 'A stack keeps the newest item on top.',
      technical: 'Push and pop act on the head only.',
      pseudocode: 'push(x)',
      exampleInput: '[1, 2]',
      expectedOutput: '2',
      complexityTime: 'O(1)',
      complexitySpace: 'O(n)'
    },
    sections: [{ id: 'section-1', heading: 'What a stack is', body: 'A stack keeps the newest item on top.', kind: 'text' }],
    code: [],
    video: null,
    thumbnailUrl: null,
    quiz: [],
    roadmap: null,
    derived: { deck: { stale: false }, videos: { stale: false }, narration: { stale: false } },
    guest: true,
    progress: null,
    bookmarked: false
  },
  '/api/learn/me': {
    user: LEARNER,
    inProgress: [{ slug: 'stacks', title: 'Stacks', summary: '', estimated_minutes: 8, difficulty: 'beginner', state: 'started', last_mode: 'tutorial', updated_at: '' }],
    completed: [],
    saved: [],
    roadmaps: [],
    recent: []
  },
  '/api/admin/lessons?status=all': {
    lessons: [
      {
        id: 'lesson-1',
        slug: 'stacks',
        title: 'Stacks: last in, first out',
        summary: 'Push, peek and pop.',
        content_status: 'published',
        version: 2,
        difficulty: 'beginner',
        theme_id: 'theme_01',
        estimated_minutes: 8,
        updated_at: new Date('2026-11-10T10:00:00Z').toISOString(),
        published_at: new Date('2026-11-09T10:00:00Z').toISOString(),
        derived: { deck: { stale: false }, videos: { stale: false }, narration: { stale: false } },
        roadmap: { roadmap: 'Foundations', module: 'Linear structures' }
      }
    ]
  },
  '/api/renders': {
    renders: [
      {
        id: 'render-vertical',
        lesson_id: 'lesson-1',
        lesson_title: 'Stacks: last in, first out',
        preset: 'hd',
        width: 1080,
        height: 1920,
        fps: 30,
        state: 'done',
        progress: 100,
        log: '',
        error: null,
        output_path: '/tmp/render-vertical.mp4',
        bytes: 1024 * 1024,
        duration_seconds: 45,
        frames: 1350,
        expected_frames: 1350,
        expected_seconds: 45,
        storyboard_hash: 'hash-a',
        snapshot: '[]',
        validation: JSON.stringify({ ok: true, checks: [] }),
        dedupe_key: 'a',
        created_at: new Date('2026-11-10T10:00:00Z').toISOString(),
        started_at: null,
        finished_at: null
      },
      {
        id: 'render-horizontal',
        lesson_id: 'lesson-1',
        lesson_title: 'Stacks: last in, first out',
        preset: 'long',
        width: 1920,
        height: 1080,
        fps: 30,
        state: 'done',
        progress: 100,
        log: '',
        error: null,
        output_path: '/tmp/render-horizontal.mp4',
        bytes: 2 * 1024 * 1024,
        duration_seconds: 45,
        frames: 1350,
        expected_frames: 1350,
        expected_seconds: 45,
        storyboard_hash: 'hash-b',
        snapshot: '[]',
        validation: JSON.stringify({ ok: true, checks: [] }),
        dedupe_key: 'b',
        created_at: new Date('2026-11-10T11:00:00Z').toISOString(),
        started_at: null,
        finished_at: null
      }
    ],
    failures: []
  }
};

/* ------------------------------------------------------------ fetch stub */

type Call = { method: string; url: string; body?: string };
let calls: Call[] = [];
let session: SessionUser | null = null;
/** Set to false to simulate a rejected sign-in. */
let allowSignIn = true;

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = (init?.method || 'GET').toUpperCase();
  calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : undefined });

  if (url === '/api/auth/me') {
    return json(200, { user: session, needsAdmin: false, themes: [] });
  }
  if (url === '/api/auth/login') {
    if (!allowSignIn) return json(401, { error: 'That email and password do not match an account.' });
    session = LEARNER;
    return json(200, { user: LEARNER });
  }
  if (url === '/api/auth/logout') {
    session = null;
    return json(200, { ok: true });
  }
  if (url.startsWith('/api/learn/me')) {
    return session ? json(200, FIXTURES['/api/learn/me']) : json(401, { error: 'Sign in to continue.' });
  }
  if (url.startsWith('/api/learn/concepts')) {
    return json(200, FIXTURES['/api/learn/concepts']);
  }
  if (url.startsWith('/api/admin/lessons')) {
    return json(200, FIXTURES['/api/admin/lessons?status=all']);
  }
  const exact = FIXTURES[url];
  if (exact) return json(200, exact);
  return json(404, { error: `no fixture for ${url}` });
}) as typeof fetch;

/* --------------------------------------------------------------- harness */

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function flush(times = 4): Promise<void> {
  for (let index = 0; index < times; index++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Renders one route the way main.tsx does, inside the router and session provider. */
async function renderRoute(route: string): Promise<void> {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [route] },
        React.createElement(SessionProvider, null, React.createElement(App))
      )
    );
  });
  await flush();
}

function text(): string {
  return (container.textContent || '').replace(/\s+/g, ' ');
}

function links(): string[] {
  return [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href') || '');
}

/** The public shell must never offer a Studio entry point. */
function assertNoStudioControls(page: string): void {
  const visible = text();
  for (const forbidden of ['Admin Studio', 'Created videos', 'Projected work']) {
    assert.equal(visible.includes(forbidden), false, `${page} must not show "${forbidden}"`);
  }
  assert.equal(links().some((href) => href.startsWith('/admin')), false, `${page} must not link into /admin`);
}

before(() => {
  calls = [];
});

after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
});

/* ---------------------------------------------------------------- the suite */

test('Home renders the public landing page without Studio controls', async () => {
  session = null;
  calls = [];
  await renderRoute('/');
  const visible = text();
  assert.match(visible, /Understand the idea, not just the definition\./);
  assert.equal(visible.includes('Stacks: last in, first out'), true, 'recent lessons must render');
  assert.match(visible, /13/);
  assertNoStudioControls('Home');
  assert.ok(calls.some((call) => call.url === '/api/learn/home'));
});

test('Explore lists lessons and the search box drives a filtered request', async () => {
  session = null;
  calls = [];
  await renderRoute('/explore');
  assert.match(text(), /2 published lessons/);
  assert.equal(text().includes('Queues: first in, first out'), true);

  const input = container.querySelector('input[type="search"], input[placeholder*="Search" i]') as HTMLInputElement | null;
  assert.ok(input, 'Explore must offer a search box');

  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(input, 'stacks');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await flush();

  assert.ok(
    calls.some((call) => call.url.startsWith('/api/learn/concepts?') && call.url.includes('q=stacks')),
    `search must ask the API for the typed term, saw: ${calls.map((call) => call.url).join(', ')}`
  );
  assertNoStudioControls('Explore');
});

test('Roadmaps and a roadmap page render their lessons', async () => {
  session = null;
  await renderRoute('/roadmaps');
  assert.equal(text().includes('Foundations roadmap'), true);
  assertNoStudioControls('Roadmaps');

  await renderRoute('/roadmaps/foundations');
  assert.match(text(), /Linear structures/);
  assertNoStudioControls('Roadmap page');
});

test('the lesson reader renders the tutorial without Studio controls', async () => {
  session = null;
  await renderRoute('/learn/stacks');
  const visible = text();
  assert.equal(visible.includes('What a stack is'), true, 'the first section must render');
  assert.match(visible, /A stack keeps the newest item on top\./);
  assertNoStudioControls('Lesson reader');
});

test('My Learning asks an anonymous visitor to sign in', async () => {
  session = null;
  await renderRoute('/my-learning');
  assert.match(text(), /Sign in to track your progress/);
  assertNoStudioControls('My Learning (anonymous)');
});

test('My Learning shows a signed-in learner their own progress', async () => {
  session = LEARNER;
  await renderRoute('/my-learning');
  assert.match(text(), /Ayesha's progress/);
  assertNoStudioControls('My Learning (signed in)');
});

test('sign-in submits the form and reports a rejected password', async () => {
  session = null;
  allowSignIn = false;
  calls = [];
  await renderRoute('/sign-in');

  const email = container.querySelector('#sign-in-email, input[type="email"]') as HTMLInputElement | null;
  const password = container.querySelector('input[type="password"]') as HTMLInputElement | null;
  assert.ok(email && password, 'the sign-in form must have an email and a password field');

  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(email, 'learner@test.local');
    email.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    setValue?.call(password, 'wrong-password');
    password.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });

  const form = container.querySelector('form');
  assert.ok(form, 'the sign-in page must render a form');
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();

  const login = calls.find((call) => call.url === '/api/auth/login');
  assert.ok(login, 'submitting the form must call the login endpoint');
  assert.equal(login.method, 'POST');
  assert.match(String(login.body), /learner@test\.local/);
  assert.match(text(), /do not match an account/);
  allowSignIn = true;
});

test('the Studio is closed to anonymous visitors: a gate, not the dashboard', async () => {
  session = null;
  for (const route of ['/admin/renders', '/admin/content']) {
    await renderRoute(route);
    const visible = text();
    assert.match(visible, /The studio needs an editor account/, `${route} must show the sign-in gate`);
    assert.equal(visible.includes('Admin Studio'), false, `${route} must not render the studio shell`);
    assert.equal(links().some((href) => href === '/admin/renders'), false);
  }
});

test('a learner account cannot open the Studio either', async () => {
  session = LEARNER;
  await renderRoute('/admin/renders');
  assert.match(text(), /Your account cannot open the studio/);
  assert.equal(text().includes('Admin Studio'), false);
});

test('the Studio content editor renders for an editor account', async () => {
  session = EDITOR;
  await renderRoute('/admin/content');
  const visible = text();
  assert.equal(visible.includes('Admin Studio'), true, 'an editor sees the studio shell');
  assert.equal(visible.includes('Projected work'), true);
  assert.equal(visible.includes('Created videos'), true);
  assert.equal(visible.includes('Stacks: last in, first out'), true, 'content rows must render');
});

test('the rendering dashboard lists vertical and horizontal renders with their format', async () => {
  session = EDITOR;
  await renderRoute('/admin/renders');
  const visible = text();
  assert.equal(visible.includes('Created videos'), true);
  assert.equal(visible.includes('Vertical'), true, 'a 1080×1920 render is labelled Vertical');
  assert.equal(visible.includes('Horizontal'), true, 'a 1920×1080 render is labelled Horizontal');
  assert.equal(visible.includes('Stacks: last in, first out'), true, 'rows must name their lesson');
});
