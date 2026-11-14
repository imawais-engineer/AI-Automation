/**
 * The four rotating visual themes.
 *
 * A theme is a full palette (background, panel, ink, accent) — not just an accent
 * colour — and the renderer receives it through the same `PlanBrand` palette the
 * Style screen writes, so a theme never needs a second drawing path.
 *
 * The assignment is per lesson and stored on the lesson record, so a retry,
 * rerender, page refresh or download can never move a video to another theme.
 *
 * Keep this module dependency-free: the renderer and the API both read it, so it
 * may not import the database.
 */

export type ThemeId = 'theme_01' | 'theme_02' | 'theme_03' | 'theme_04';

export type Theme = {
  id: ThemeId;
  index: number;
  name: string;
  tagline: string;
  /** Background, panel, ink and accent tokens used by the renderer. */
  background: string;
  panel: string;
  ink: string;
  accent: string;
  /** Light surfaces need inverted scrims and gradients; dark ones keep the stage. */
  dark: boolean;
  detail: string;
};

export const THEMES: Theme[] = [
  {
    id: 'theme_01',
    index: 0,
    name: 'Midnight Circuit',
    tagline: 'Deep navy · cyan highlights · technical grid',
    background: '#081226',
    panel: '#102138',
    ink: '#e6f2ff',
    accent: '#22d3ee',
    dark: true,
    detail: 'The stage the renderer was built on: navy depth, a cyan signal colour and the floor grid.'
  },
  {
    id: 'theme_02',
    index: 1,
    name: 'Warm Editorial',
    tagline: 'Warm paper · charcoal ink · orange focus',
    background: '#f4ecdd',
    panel: '#fffaf1',
    ink: '#241f1a',
    accent: '#d9531e',
    dark: false,
    detail: 'Printed-page surfaces with charcoal text and a single warm accent for state changes.'
  },
  {
    id: 'theme_03',
    index: 2,
    name: 'Neon Gradient',
    tagline: 'Violet · indigo gradients · luminous states',
    background: '#150a2e',
    panel: '#241148',
    ink: '#f0e9ff',
    accent: '#a855f7',
    dark: true,
    detail: 'Indigo depth with a luminous violet accent; highlights read as light rather than paint.'
  },
  {
    id: 'theme_04',
    index: 3,
    name: 'Clean Lab',
    tagline: 'Soft green · off-white · precise diagrams',
    background: '#eef4ec',
    panel: '#ffffff',
    ink: '#15251b',
    accent: '#1f8f5f',
    dark: false,
    detail: 'Off-white surfaces and a measured green accent, for diagram-first lessons.'
  }
];

const BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

/** A stored theme id, or the first theme when the value is unknown. */
export function themeById(id: string | null | undefined): Theme {
  return BY_ID.get(String(id || '').trim() as ThemeId) || THEMES[0];
}

export function isThemeId(value: unknown): value is ThemeId {
  return BY_ID.has(String(value || '') as ThemeId);
}

/** The palette fields a render needs, in the shape the brand row already uses. */
export function themePalette(theme: Theme): {
  background: string;
  panel: string;
  ink: string;
  accent: string;
} {
  return {
    background: theme.background,
    panel: theme.panel,
    ink: theme.ink,
    accent: theme.accent
  };
}

/**
 * Deterministic rotation: the theme with the fewest assignments wins, ties broken
 * by theme order. New content therefore walks theme_01 → theme_02 → theme_03 →
 * theme_04 → theme_01 … while existing lessons keep whatever they were given.
 */
export function nextThemeId(counts: Partial<Record<ThemeId, number>>): ThemeId {
  let best = THEMES[0];
  for (const theme of THEMES) {
    const current = Number(counts[theme.id] || 0);
    const bestCount = Number(counts[best.id] || 0);
    if (current < bestCount) best = theme;
  }
  return best.id;
}

/** Whether a light theme needs the inverted treatment in the frame renderer. */
export function isDarkTheme(id: string | null | undefined): boolean {
  return themeById(id).dark;
}
