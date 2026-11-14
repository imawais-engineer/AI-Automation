/**
 * Helpers every Studio route module shares: field allow-lists, small input
 * coercion and the two lookups that decide whether a row exists at all.
 *
 * Kept in one place so a route module never reaches into another one.
 */
import { db } from '../db.ts';
import type { ConceptInput, LessonInput } from '../scenes.ts';

export const CONCEPT_FIELDS = [
  'name', 'category', 'summary', 'objectives', 'prerequisites', 'plain_explanation',
  'technical_explanation', 'pseudocode', 'reference_language', 'reference_code',
  'complexity_time', 'complexity_space', 'example_input', 'expected_output',
  'status'
] as const;

export const LESSON_FIELDS = [
  'title', 'audience', 'objective', 'duration_seconds', 'hook', 'narration',
  'on_screen_text', 'key_takeaway', 'cta', 'sources', 'review_status'
] as const;

export const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube'] as const;

export function pick<T extends object>(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in source) out[field] = source[field];
  }
  return out;
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || `concept-${Date.now()}`;
}

export function requireLesson(id: string): (LessonInput & { scenes: string }) | null {
  return (db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as LessonInput & { scenes: string }) || null;
}

export function requireConcept(id: string): ConceptInput | null {
  return (db.prepare('SELECT * FROM concepts WHERE id = ?').get(id) as ConceptInput) || null;
}

export function conceptBySlug(slug: string): ConceptInput | null {
  return (db.prepare('SELECT * FROM concepts WHERE slug = ?').get(slug) as ConceptInput) || null;
}
