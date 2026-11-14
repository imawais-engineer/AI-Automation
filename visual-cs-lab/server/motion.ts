/**
 * The one place a lesson is turned into an animation plan.
 *
 * Previews, scene clips, layout inspection, voice-over scripts and the final
 * encode all read their motion from here, so none of them can animate a different
 * timeline than the other.
 */

import { db, readBrand, type Brand } from './db.ts';
import { themeById, themePalette } from './themes.ts';
import { effectiveConcept, safeJson, type ConceptInput, type LessonInput, type Scene } from './scenes.ts';
import { planBrand, planFor, type MotionPlan } from './anim/index.ts';

export type LessonBundle = { lesson: LessonInput & { scenes: string }; concept: ConceptInput };

/** The theme a lesson was assigned. Stored on the lesson, never recalculated. */
export function lessonThemeId(lessonId: string): string {
  const row = db.prepare('SELECT theme_id FROM lessons WHERE id = ?').get(lessonId) as
    | { theme_id: string | null }
    | undefined;
  return themeById(row?.theme_id).id;
}

/**
 * The brand row with a theme's palette laid over it. Presenter identity, opening
 * style and timings are untouched: a theme changes the surface, never the person.
 */
export function themedBrand(brand: Brand, themeId: string | null | undefined): Brand {
  const palette = themePalette(themeById(themeId));
  return { ...brand, ...palette };
}

export function lessonBundle(lessonId: string): LessonBundle | null {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId) as
    | (LessonInput & { scenes: string })
    | undefined;
  if (!lesson) return null;
  const concept = db.prepare('SELECT * FROM concepts WHERE id = ?').get(lesson.concept_id) as ConceptInput | undefined;
  if (!concept) return null;
  return { lesson, concept };
}

export type LessonMotion = {
  motion: MotionPlan;
  lesson: LessonInput & { scenes: string };
  concept: ConceptInput;
  scenes: Scene[];
  brand: Brand;
};

/** The stored storyboard plus the concept's trusted trace, as one plan. */
export function motionForLesson(lessonId: string): LessonMotion | null {
  const stored = lessonBundle(lessonId);
  if (!stored) return null;
  const scenes = safeJson<Scene[]>(stored.lesson.scenes || '[]', []);
  if (scenes.length === 0) return null;
  const brand = themedBrand(readBrand(), lessonThemeId(lessonId));
  try {
    const motion = planFor({
      lesson: stored.lesson,
      concept: effectiveConcept(stored.lesson, stored.concept),
      scenes,
      brand: planBrand(brand)
    });
    return { motion, lesson: stored.lesson, concept: stored.concept, scenes, brand };
  } catch {
    return null;
  }
}
