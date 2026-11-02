/**
 * Roles, permissions and password hashing.
 *
 * The permission table lives here, away from Express and the database, so the
 * API middleware and the tests read the same rules. Every protected server
 * action asks `can()` — a hidden navigation item is never the boundary.
 *
 * Keep this module dependency-free (no db, no express).
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export type Role = 'learner' | 'editor' | 'reviewer' | 'admin';

export const ROLES: Role[] = ['learner', 'editor', 'reviewer', 'admin'];

const RANK: Record<Role, number> = { learner: 0, editor: 1, reviewer: 2, admin: 3 };

export type Action =
  | 'content:read'
  | 'content:write'
  | 'render:run'
  | 'review:decide'
  | 'content:publish'
  | 'users:manage'
  | 'audio:manage'
  | 'theme:override';

/** The minimum role each action needs. */
const MINIMUM: Record<Action, Role> = {
  'content:read': 'editor',
  'content:write': 'editor',
  'render:run': 'editor',
  'review:decide': 'reviewer',
  'content:publish': 'reviewer',
  'users:manage': 'admin',
  'audio:manage': 'reviewer',
  'theme:override': 'editor'
};

export function isRole(value: unknown): value is Role {
  return ROLES.includes(String(value || '') as Role);
}

export function atLeast(role: string | null | undefined, minimum: Role): boolean {
  if (!isRole(role)) return false;
  return RANK[role] >= RANK[minimum];
}

/** The one place an authorization decision is made. */
export function can(role: string | null | undefined, action: Action): boolean {
  if (!isRole(role)) return false;
  return atLeast(role, MINIMUM[action]);
}

/** Actions a role may perform, for rendering a navigation that matches the API. */
export function actionsFor(role: string | null | undefined): Action[] {
  return (Object.keys(MINIMUM) as Action[]).filter((action) => can(role, action));
}

/* ------------------------------------------------------------------ passwords */

const KEY_LEN = 64;
const SALT_LEN = 16;

/** scrypt with a per-password salt; the format carries everything verification needs. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(String(password), salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return false;
  const actual = scryptSync(String(password), salt, KEY_LEN);
  return timingSafeEqual(actual, expected);
}

export type PasswordProblem = string | null;

/** Shared with the sign-up and password forms so the rules cannot drift. */
export function passwordProblem(password: string): PasswordProblem {
  const value = String(password || '');
  if (value.length < 8) return 'Use at least 8 characters.';
  if (value.length > 200) return 'Keep the password under 200 characters.';
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Include at least one letter and one number.';
  }
  return null;
}

export function normaliseEmail(email: unknown): string {
  return String(email || '').trim().toLowerCase();
}
