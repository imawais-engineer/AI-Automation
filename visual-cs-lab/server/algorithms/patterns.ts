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
  },
  {
    concept: {
      slug: 'two-pointers',
      name: 'Two Pointers',
      category: 'Algorithms',
      summary: 'Walk two indices inward on a sorted array to find a pair in one pass.',
      objectives:
        'Trace L and R converging; explain why a comparison can discard a whole row of pairs; prove the O(n) bound.',
      prerequisites: 'Arrays',
      plain:
        'Start one pointer at the first cell and one at the last. If their sum is too small, only the left pointer can grow it; if it is too big, only the right pointer can shrink it.',
      technical:
        'On sorted input the pair sum is monotone in each pointer: moving L right never decreases the sum, moving R left never increases it. That monotonicity lets each comparison eliminate every pair sharing the moved pointer, so the scan costs O(n) time and O(1) space.',
      pseudocode:
        'L = 0; R = n - 1\nwhile L < R:\n  s = a[L] + a[R]\n  if s == target: return (L, R)\n  if s < target: L += 1\n  else: R -= 1\nreturn none',
      time: 'O(n)',
      space: 'O(1)',
      exampleInput: '[2, 5, 8, 11, 14, 18], target 19',
      expectedOutput: '5 + 14 = 19 in three sums',
      related: ['arrays', 'binary-search', 'sliding-window']
    },
    config: {
      kind: 'two-pointers',
      array: [2, 5, 8, 11, 14, 18],
      target: 19,
      expect: { pair: [5, 14], comparisons: 3 }
    },
    lesson: {
      title: 'Two Pointers',
      audience: 'Beginner software engineering students',
      objective: 'Find a pair that sums to a target by moving two indices inward.',
      hook: 'Two pointers walk inward on a sorted array — and every step discards half the pairs.',
      narration:
        'Two plus eighteen is twenty, which is too big for a target of nineteen, so the right pointer steps left. Now two plus fourteen is sixteen, too small, so the left pointer steps right. Five plus fourteen is nineteen, and the pair is found in three sums instead of fifteen.',
      on_screen_text: 'Too small: move L. Too big: move R. Sorted order makes each step safe.',
      key_takeaway: 'On a sorted array a converging pointer pair tests a target pair sum in O(n) time and O(1) space.',
      cta: "Understand the algorithm. Don't just memorize it.",
      sources: 'Sedgewick & Wayne, Algorithms (4th ed.), §1.4 (two-sum); CLRS §2.3 (sorted-input reasoning).'
    }
  },
  {
    concept: {
      slug: 'sliding-window',
      name: 'Sliding Window',
      category: 'Algorithms',
      summary: 'Keep a moving range valid by growing the right edge and shrinking the left.',
      objectives:
        'Maintain a window invariant; decide when to expand and when to contract; explain why the total work is still O(n).',
      prerequisites: 'Arrays, Two Pointers',
      plain:
        'A window is the stretch between two edges. Grow it on the right while it stays legal; when it breaks the rule, move the left edge in until it is legal again.',
      technical:
        'The right edge advances once per cell and the left edge only ever advances too, so each cell is added and removed at most once: O(n) total work with O(1) extra state. The pattern replaces the inner loop of the obvious O(n²) scan.',
      pseudocode:
        'L = 0; sum = 0; best = 0\nfor R in 0..n-1:\n  sum += a[R]\n  while sum > limit: sum -= a[L]; L += 1\n  best = max(best, R - L + 1)',
      time: 'O(n)',
      space: 'O(1)',
      exampleInput: '[1, 2, 3, 1, 1, 1, 4, 2], sum ≤ 10',
      expectedOutput: 'longest window 6 cells (1, 2, 3, 1, 1, 1)',
      related: ['two-pointers', 'arrays', 'prefix-sums']
    },
    config: {
      kind: 'sliding-window',
      array: [1, 2, 3, 1, 1, 1, 4, 2],
      limit: 10,
      expect: { longest: 6 }
    },
    lesson: {
      title: 'Sliding Window',
      audience: 'Beginner software engineering students',
      objective: 'Grow and shrink a window while its sum stays under a limit.',
      hook: 'One window, two edges: grow while it is legal, shrink until it is again.',
      narration:
        'The right edge adds a one, then a two, then a three. The sum is six, well under ten, so the window keeps growing. Adding a four pushes the sum to thirteen, so the left edge drops the one and the two until the sum is ten again. The longest window held six cells, and every cell was added and removed at most once.',
      on_screen_text: 'Add on the right; while the invariant breaks, remove on the left.',
      key_takeaway: 'Each cell enters and leaves the window once, so the whole scan is O(n) time and O(1) space.',
      cta: "Understand the algorithm. Don't just memorize it.",
      sources: 'Sedgewick & Wayne, Algorithms (4th ed.), §1.4; competitive-programming sliding-window notes.'
    }
  },
  {
    concept: {
      slug: 'prefix-sums',
      name: 'Prefix Sums',
      category: 'Algorithms',
      summary: 'Build running totals once so any range sum costs two reads.',
      objectives:
        'Build a prefix table by hand; derive range sum as P[r+1] − P[l]; decide when a one-time O(n) build pays off.',
      prerequisites: 'Arrays',
      plain:
        'Add the array up from the left and keep every running total. Then the sum of any stretch is the total up to its end minus the total before its start.',
      technical:
        'P[i] = a[0] + … + a[i-1] with P[0] = 0. Then sum(l..r) = P[r+1] − P[l], so one O(n) build turns every later range query into two reads. The trade is O(n) extra space, and the table is worth it as soon as there is more than one query.',
      pseudocode:
        'P[0] = 0\nfor i in 1..n: P[i] = P[i-1] + a[i-1]\nsum(l, r) = P[r+1] - P[l]',
      time: 'O(n) build · O(1) range query',
      space: 'O(n)',
      exampleInput: '[3, 1, 4, 1, 5, 9], sum(2..4)',
      expectedOutput: 'P[5] − P[2] = 14 − 4 = 10',
      related: ['arrays', 'sliding-window', 'two-pointers']
    },
    config: {
      kind: 'prefix-sums',
      array: [3, 1, 4, 1, 5, 9],
      query: { left: 2, right: 4 },
      expect: { sum: 10 }
    },
    lesson: {
      title: 'Prefix Sums',
      audience: 'Beginner software engineering students',
      objective: 'Turn any range sum into a single subtraction using running totals.',
      hook: 'Add once up front, and every later range sum is one subtraction.',
      narration:
        'The second row keeps running totals: three, four, eight, nine, fourteen, twenty-three. To sum the range from index two to index four, subtract the total before the range from the total at its end. Fourteen minus four is ten, answered in two reads instead of three additions.',
      on_screen_text: 'P[i] = P[i-1] + a[i-1]; range sum = P[r+1] − P[l].',
      key_takeaway: 'One O(n) pass builds running totals, and every range sum afterwards is two reads.',
      cta: "Understand the algorithm. Don't just memorize it.",
      sources: 'Sedgewick & Wayne, Algorithms (4th ed.), §1.4 (cumulative sums); CLRS §2.1 (loop invariants).'
    }
  },
  {
    concept: {
      slug: 'selection-sort',
      name: 'Selection Sort',
      category: 'Algorithms',
      summary: 'Find the smallest remaining value and swap it to the front, once per pass.',
      objectives:
        'Trace the minimum scan; count comparisons and swaps separately; explain why it is O(n²) even on sorted input.',
      prerequisites: 'Arrays',
      plain:
        'Scan the unsorted part for the smallest value and swap it to the front. Repeat on the shorter rest until one value is left.',
      technical:
        'Pass i scans a[i..n-1], so comparisons sum to n(n−1)/2 regardless of input order — there is no best case. Exactly one swap per pass keeps writes low, which matters when moving an element is expensive and comparing is cheap.',
      pseudocode:
        'for i in 0..n-2:\n  min = i\n  for j in i+1..n-1:\n    if a[j] < a[min]: min = j\n  swap(a[i], a[min])',
      time: 'O(n²) always',
      space: 'O(1)',
      exampleInput: '[5, 2, 8, 1, 9, 3]',
      expectedOutput: '[1, 2, 3, 5, 8, 9] in 15 comparisons and 3 swaps',
      related: ['bubble-sort', 'insertion-sort', 'merge-sort']
    },
    config: {
      kind: 'selection-sort',
      array: [5, 2, 8, 1, 9, 3],
      expect: { sorted: [1, 2, 3, 5, 8, 9], comparisons: 15, swaps: 3 }
    },
    lesson: {
      title: 'Selection Sort',
      audience: 'Beginner software engineering students',
      objective: 'Sort by repeatedly selecting the smallest remaining value.',
      hook: 'Look through everything, take the smallest, and put it where it belongs.',
      narration:
        'The first pass scans five, two, eight, one, nine and three, and finds one as the minimum, so it swaps one to the front. The next pass scans the rest and finds two is already in place. Three passes later the array reads one, two, three, five, eight, nine, using fifteen comparisons and only three swaps.',
      on_screen_text: 'Each pass settles one position: scan for the minimum, swap it in.',
      key_takeaway: 'Selection sort always makes n(n−1)/2 comparisons but at most n−1 swaps — O(n²) time, O(1) space.',
      cta: "Understand the algorithm. Don't just memorize it.",
      sources: 'CLRS §2.2 (selection sort exercise); Sedgewick & Wayne, Algorithms (4th ed.), §2.1.'
    }
  }
];
