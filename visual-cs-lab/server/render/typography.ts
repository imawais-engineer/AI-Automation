import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GlobalFonts } from '@napi-rs/canvas';

/**
 * The video's typographic system.
 *
 * Three roles, each with a fixed set of weights, and every face is bundled with
 * the app (see `public/fonts/README.md`) instead of relying on fonts installed in
 * the container. Each weight is registered under its own family alias, so a
 * `700` request can never be answered with a `400` face: text metrics — and
 * therefore every containment decision in `layout.ts` — are deterministic.
 */

export type FontRole = 'display' | 'text' | 'mono';

type Face = { role: FontRole; weight: number; alias: string; file: string };

const FONT_DIR = fileURLToPath(new URL('../../public/fonts/', import.meta.url));

const FACES: Face[] = [
  { role: 'display', weight: 600, alias: 'VL Display 600', file: 'space-grotesk-600.ttf' },
  { role: 'display', weight: 700, alias: 'VL Display 700', file: 'space-grotesk-700.ttf' },
  { role: 'text', weight: 400, alias: 'VL Text 400', file: 'inter-400.ttf' },
  { role: 'text', weight: 500, alias: 'VL Text 500', file: 'inter-500.ttf' },
  { role: 'text', weight: 600, alias: 'VL Text 600', file: 'inter-600.ttf' },
  { role: 'mono', weight: 400, alias: 'VL Mono 400', file: 'jetbrains-mono-400.ttf' },
  { role: 'mono', weight: 600, alias: 'VL Mono 600', file: 'jetbrains-mono-600.ttf' }
];

const FALLBACK: Record<FontRole, string> = {
  display: '"Space Grotesk", system-ui, sans-serif',
  text: 'Inter, system-ui, -apple-system, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'
};

const registered = new Map<string, string>();
const failures: string[] = [];

for (const face of FACES) {
  try {
    GlobalFonts.registerFromPath(path.join(FONT_DIR, face.file), face.alias);
    registered.set(`${face.role}:${face.weight}`, face.alias);
  } catch (error) {
    failures.push(`${face.file} (${(error as Error).message})`);
  }
}

/** The closest bundled weight for a role: display 600/700, text 400–600, mono 400/600. */
export function snapWeight(role: FontRole, weight: number): number {
  if (role === 'display') return weight >= 650 ? 700 : 600;
  if (role === 'mono') return weight >= 550 ? 600 : 400;
  if (weight >= 550) return 600;
  if (weight >= 450) return 500;
  return 400;
}

/**
 * The exact family alias for a role and weight, plus the web fallback stack. The
 * numeric weight is kept in the CSS font shorthand because Skia applies it to
 * synthetic emphasis, but the alias is what guarantees the bundled face.
 */
export function familyFor(role: FontRole, weight = 400): string {
  const exact = registered.get(`${role}:${snapWeight(role, weight)}`);
  const name = exact ? `"${exact}"` : FALLBACK[role];
  return `${name}, ${FALLBACK[role]}`;
}

export function fontString(role: FontRole, weight: number, size: number): string {
  return `${snapWeight(role, weight)} ${Math.max(1, Math.round(size))}px ${familyFor(role, weight)}`;
}

/** True when every bundled face registered; a partial set would cause substitution. */
export function fontsLoaded(): boolean {
  return failures.length === 0 && registered.size === FACES.length;
}

export function fontStatus(): { ok: boolean; faces: number; failures: string[] } {
  return { ok: fontsLoaded(), faces: registered.size, failures: [...failures] };
}

/**
 * Called once at boot. A missing bundled face is a deployment error: rendering
 * would silently swap in a different typeface and break every fitted text box.
 */
export function assertFontsLoaded(): void {
  const status = fontStatus();
  if (!status.ok) {
    throw new Error(
      `The bundled video fonts could not be registered (${status.failures.join('; ') || 'missing faces'}). ` +
        'Rendering would fall back to a subtitute typeface, so it is refused.'
    );
  }
}
