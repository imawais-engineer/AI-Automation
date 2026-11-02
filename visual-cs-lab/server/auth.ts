/**
 * Session authentication and server-side authorization.
 *
 * The boundary for protected operations is here, in Express middleware, and in
 * `can()` from `roles.ts` — never in the navigation. Every admin route is mounted
 * behind `requireAction(...)`, so hiding a link changes nothing about access.
 *
 * Sessions are opaque random tokens in an httpOnly, SameSite=Lax cookie; the
 * token is stored hashed nowhere (it is only a random 256-bit id), and the row
 * carries the expiry, so signing out deletes the server-side session.
 */

import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { db, nowIso } from './db.ts';
import {
  can,
  hashPassword,
  isRole,
  normaliseEmail,
  passwordProblem,
  verifyPassword,
  type Action,
  type Role
} from './roles.ts';

const COOKIE = 'vc_session';
const TTL_DAYS = 30;

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  default_language: string;
  audio_mode: string;
  captions: number;
  reduced_motion: number;
};

export type AuthedRequest = Request & { user?: PublicUser | null };

export function publicUser(id: string): PublicUser | null {
  const row = db
    .prepare(
      'SELECT id, email, name, role, default_language, audio_mode, captions, reduced_motion FROM users WHERE id = ?'
    )
    .get(id) as PublicUser | undefined;
  return row || null;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionUser(req: Request): PublicUser | null {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
    .get(token) as { user_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
    return null;
  }
  return publicUser(row.user_id);
}

/** Makes the signed-in user available to every route without requiring one. */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  (req as AuthedRequest).user = sessionUser(req);
  next();
}

function isSecure(req: Request): boolean {
  return req.headers['x-forwarded-proto'] === 'https' || Boolean(process.env.BASE44_PREVIEW_MODE === '1');
}

export function startSession(req: Request, res: Response, userId: string): string {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TTL_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    nowIso(),
    expires
  );
  const attributes = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${TTL_DAYS * 86400}`
  ];
  if (isSecure(req)) attributes.push('Secure');
  res.append('Set-Cookie', attributes.join('; '));
  return token;
}

export function endSession(req: Request, res: Response): void {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ------------------------------------------------------------------- accounts */

export function userCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

/** True while nobody holds a role above learner: the first admin is created by hand. */
export function needsBootstrapAdmin(): boolean {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role != 'learner'").get() as { n: number };
  return row.n === 0;
}

export type AuthResult = { user?: PublicUser; error?: string };

export function createUser(input: {
  email: unknown;
  name: unknown;
  password: unknown;
  role?: unknown;
}): AuthResult {
  const email = normaliseEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' };
  const problem = passwordProblem(String(input.password || ''));
  if (problem) return { error: problem };
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return { error: 'An account with that email already exists.' };
  }
  const role: Role = isRole(input.role) ? input.role : 'learner';
  const id = randomBytes(12).toString('hex');
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, email, String(input.name || email.split('@')[0]).slice(0, 80), role, hashPassword(String(input.password)), stamp, stamp);
  return { user: publicUser(id) || undefined };
}

const attempts = new Map<string, { count: number; until: number }>();

/** A small in-memory throttle: five failures per email holds for a minute. */
function throttled(key: string): boolean {
  const entry = attempts.get(key);
  return Boolean(entry && entry.count >= 5 && entry.until > Date.now());
}

function noteFailure(key: string): void {
  const entry = attempts.get(key) || { count: 0, until: 0 };
  entry.count += 1;
  entry.until = Date.now() + 60_000;
  attempts.set(key, entry);
}

export function signIn(emailInput: unknown, password: unknown): AuthResult {
  const email = normaliseEmail(emailInput);
  if (throttled(email)) return { error: 'Too many attempts. Wait a minute and try again.' };
  const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as
    | { id: string; password_hash: string }
    | undefined;
  if (!row || !verifyPassword(String(password || ''), row.password_hash)) {
    noteFailure(email);
    return { error: 'That email and password do not match an account.' };
  }
  attempts.delete(email);
  return { user: publicUser(row.id) || undefined };
}

/* ------------------------------------------------------------------ middleware */

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthedRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return;
  }
  next();
}

/** The authorization gate: 401 when anonymous, 403 when the role is too low. */
export function requireAction(action: Action) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: 'Sign in with an editor account to use the studio.' });
      return;
    }
    if (!can(user.role, action)) {
      res.status(403).json({ error: `Your role (${user.role}) cannot perform this action.` });
      return;
    }
    next();
  };
}
