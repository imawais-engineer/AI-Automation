/**
 * The pattern and paradigm shorts: concept, verified config and lesson copy.
 *
 * Each entry is one lesson the library ships for a cell-row trace — the concept
 * record with its teaching copy, the animation config a trace module verifies,
 * and the 45 second lesson the storyboard builder turns into beats. `db.ts`
 * ensures every entry once per database, so the same list seeds a fresh database
 * and backfills an existing one.
 */

export type PatternDemo = {
  concept: {
    slug: string;
    name: string;
    category: string;
    summary: string;
    objectives: string;
    prerequisites: string;
    plain: string;
    technical: string;
    pseudocode: string;
    time: string;
    space: string;
    exampleInput: string;
    expectedOutput: string;
    related: string[];
  };
  config: Record<string, unknown>;
  lesson: Record<string, string>;
};

export const PATTERN_DEMOS: PatternDemo[] = [
  {
    concept: {
      slug: 'strings',
      name: 'Strings & Character Arrays',
      category: 'Data Structures',
      summary: 'Text is a contiguous array of characters: index it in O(1), scan it in O(n).',
      objectives:
        'Index a string by character position; scan it once to count what it holds; explain why indexing is O(1) but a scan is O(n).',
      prerequisites: 'Arrays',
      plain:
        'A string stores characters in cells, exactly like an array stores numbers. text[0] is the first character. Reading one cell costs O(1); visiting every cell costs O(n).',
      technical:
        'Characters are small integers held in contiguous storage, so the address of text[i] is base + i × size — computing it is constant work. Counting what a string contains needs one pass with O(1) counters.',
      pseudocode:
        'count_vowels(text):\n  vowels = 0\n  for i from 0 to n-1:\n    if text[i] in {a,e,i,o,u}: vowels += 1\n  return vowels',
      time: 'O(1) index · O(n) scan',
      space: 'O(1)',
      exampleInput: 'VISUAL',
      expectedOutput: '3 vowels in 6 characters',
      related: ['arrays', 'hash-tables']
    },
    config: { kind: 'strings', text: 'VISUAL', expect: { vowels: 3, consonants: 3, length: 6 } },
    lesson: {
      title: 'Strings & Character Arrays',
      audience: 'Beginner software engineering students',
      objective: 'Read a string as an array of characters and count what it contains in one pass.',
      hook: 'Text is just an array of characters.',
      narration:
        'A string is an array of characters in contiguous cells, so text zero is a constant-time read. Walking the whole string once and testing each character costs O of n time and O of one extra space. Here the scan counts the vowels in VISUAL — three of the six characters.',
      on_screen_text: 'A string is an array of characters — index in O(1), scan in O(n).',
      key_takeaway: 'Index a character in O(1); counting what a string holds takes one O(n) pass.',
      cta: "Understand the algorithm. Don't just memorize it.",
      sources: 'CLRS §11.1 (direct-address tables) for array indexing; MDN String.prototype.charAt.'
    }
  }
];
