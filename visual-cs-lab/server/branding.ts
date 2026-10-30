/**
 * The personal brand identity every rendered short is presented under.
 *
 * The defaults are the exact identity the videos carry: the presenter's name, the
 * professional title and the closing line. They are stored on the `brand` row so
 * the Style screen can change them, and every derived value (the opening title,
 * the thumbnail capture point, the storyboard bookends) is computed here from that
 * one row — the renderer never reads a second source for branding.
 *
 * Keep this module dependency-free: `scenes.ts` and `db.ts` both use it, so it may
 * not import either of them back.
 */

export const BRAND_DEFAULTS = {
  presenter: 'Muhammad Awais',
  role: 'Aspiring Forward Deployed AI Engineer',
  closing: 'Building at the intersection of AI and software.',
  /** The outro's ask, and the handle a viewer can follow. */
  cta: 'Follow for more visual algorithms',
  handle: '@muhammadawais'
} as const;

export type OpeningStyle = 'cinematic' | 'minimal' | 'bold';

export const OPENING_STYLES: { key: OpeningStyle; label: string; hint: string }[] = [
  { key: 'cinematic', label: 'Cinematic', hint: 'Deep stage, staggered title rise, light sweep.' },
  { key: 'minimal', label: 'Minimal', hint: 'One quiet fade, thin rule, centred credit.' },
  { key: 'bold', label: 'Bold', hint: 'Uppercase display title that snaps into place.' }
];

export const DEFAULT_OPENING_MS = 2500;
export const DEFAULT_ENDING_MS = 2500;
/** The opening must stay inside 2–3 seconds. */
export const OPENING_MIN_MS = 2000;
export const OPENING_MAX_MS = 3000;
export const ENDING_MIN_MS = 2000;
export const ENDING_MAX_MS = 3000;

export type Branding = {
  presenter: string;
  role: string;
  closing: string;
  cta: string;
  handle: string;
  openingMs: number;
  endingMs: number;
  openingStyle: OpeningStyle;
  autoThumbnail: boolean;
};

export type BrandRowLike = {
  presenter?: string | null;
  role?: string | null;
  closing_line?: string | null;
  outro?: string | null;
  handle?: string | null;
  opening_ms?: number | null;
  ending_ms?: number | null;
  opening_style?: string | null;
  auto_thumbnail?: number | null;
};

const clampDuration = (value: unknown, fallback: number, min: number, max: number): number => {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return fallback;
  return Math.round(Math.max(min, Math.min(max, ms)));
};

function styleOf(value: unknown): OpeningStyle {
  const key = String(value || '').trim().toLowerCase();
  return OPENING_STYLES.some((style) => style.key === key) ? (key as OpeningStyle) : 'cinematic';
}

/** The branding the renderer and the storyboard builder use, from the brand row. */
export function brandingFrom(brand?: BrandRowLike | null): Branding {
  return {
    presenter: String(brand?.presenter || '').trim() || BRAND_DEFAULTS.presenter,
    role: String(brand?.role || '').trim() || BRAND_DEFAULTS.role,
    closing: String(brand?.closing_line || '').trim() || BRAND_DEFAULTS.closing,
    cta: String(brand?.outro || '').trim() || BRAND_DEFAULTS.cta,
    handle: String(brand?.handle || '').trim() || BRAND_DEFAULTS.handle,
    openingMs: clampDuration(brand?.opening_ms, DEFAULT_OPENING_MS, OPENING_MIN_MS, OPENING_MAX_MS),
    endingMs: clampDuration(brand?.ending_ms, DEFAULT_ENDING_MS, ENDING_MIN_MS, ENDING_MAX_MS),
    openingStyle: styleOf(brand?.opening_style),
    autoThumbnail: brand?.auto_thumbnail === undefined || brand?.auto_thumbnail === null ? true : Number(brand.auto_thumbnail) !== 0
  };
}

/**
 * The concise title the opening reveals. The lesson's own title is used when it
 * names the topic ("Stacks in 45 Seconds" → "Stacks"); otherwise the concept's
 * name is, which is always a short, technically accurate topic name.
 */
export function shortTitle(lesson: { title?: string }, concept: { name?: string }): string {
  const conceptName = String(concept?.name || '').trim();
  const cleaned = String(lesson?.title || '')
    .replace(/\s*[·|—–-]\s*\d+\s*(?:seconds?|secs?|s)\b.*$/i, '')
    .replace(/\s+in\s+\d+\s*(?:seconds?|secs?|s)\b.*$/i, '')
    .replace(/\b\d+\s*(?:seconds?|secs?)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s·|—–:-]+$/, '')
    .trim();
  if (!cleaned) return conceptName || 'Computer science';
  // A title that is still a sentence is not a short title.
  if (cleaned.length > 44) return conceptName || cleaned.slice(0, 44);
  return cleaned;
}

/**
 * When the opening title, the accent rule and the presenter credit have all
 * settled — the moment that becomes the video's thumbnail.
 *
 * The opening animates on absolute millisecond offsets from its own start (see
 * `OPENING_TIMING` in `anim/stage.ts`), so this is derived from the animation
 * rather than guessed, then clamped into the 1.0–1.5s window the brand spec asks
 * for and kept clear of the outgoing transition.
 */
export function openingCaptureMs(startMs: number, endMs: number, settledMs = 1150): number {
  const span = Math.max(0, endMs - startMs);
  const wanted = startMs + settledMs;
  const low = startMs + Math.min(1000, span * 0.4);
  const high = Math.min(startMs + 1500, endMs - 300);
  return Math.round(Math.max(low, Math.min(wanted, Math.max(low, high))));
}

/** Fingerprint of everything that changes how the opening and closing look. */
export function brandingHash(branding: Branding): string {
  return [
    branding.presenter,
    branding.role,
    branding.closing,
    branding.cta,
    branding.handle,
    branding.openingMs,
    branding.endingMs,
    branding.openingStyle
  ].join('|');
}

/** The opening copy stored on the storyboard and shown by the renderer. */
export function openingCopy(
  lesson: { title?: string },
  concept: { name?: string; category?: string },
  branding: Branding
): { title: string; kicker: string; credit: string } {
  return {
    title: shortTitle(lesson, concept),
    kicker: String(concept?.category || '').trim() || 'Computer science',
    credit: `Presented by ${branding.presenter}`
  };
}
