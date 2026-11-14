# Curriculum structure

Content is data: concepts and lessons live in SQLite, and the roadmap is a set of ordered
modules and items. Updating the curriculum needs no deployment.

## Current shape

| Level | Count |
| --- | --- |
| Concepts (topics) | 28 |
| Lessons | 28 (23 published, 5 draft) |
| Roadmaps | 1 — *DSA Foundations* |
| Roadmap modules | 4 |
| Roadmap items | 23 |
| Slides | 84 across 11 decks |
| Rendered videos | 33 vertical (1080×1920) and 23 horizontal (1920×1080); the remaining horizontal copies are still rendering |

## Three levels

1. **Concept** — one topic: name, category, plain and technical explanation, pseudocode,
   reference implementation, complexity, an example input and its expected output, plus the
   animation configuration that binds it to a trace.
2. **Lesson** — the teachable instance of a concept: objective, hook, narration, storyboard,
   tutorial sections, practice questions, review status. A concept can own several lessons.
3. **Roadmap** — the order a learner should meet the concepts in, grouped into modules.
   *DSA Foundations* currently has four modules and 23 items.

## Families in the current catalogue

| Family | Concepts |
| --- | --- |
| Linear structures | Arrays, linked lists, stacks, queues, hash tables |
| Trees and heaps | Binary search trees, trees, heaps, traversal |
| Graphs | Graph representation, depth-first search |
| Searching | Linear search, binary search |
| Sorting | Bubble, selection, insertion, merge, quick |
| Technique | Recursion, dynamic programming, two pointers, sliding window, prefix sums, strings, complexity analysis |

## Draft work

Five lessons exist but are not published: prefix sums, selection sort, sliding window, strings
and two pointers. They have traces and renders; they are held back on content review, not on
capability.

## Rules for adding to the curriculum

- A concept must have a verified trace before it can have a lesson that animates.
- A lesson ships only when its sections read as a tutorial on their own, its practice questions
  are answerable from the text, and its video passed the quality gate.
- Order matters: a roadmap item may not depend on a concept that appears later in the path.
- One concept per lesson. If a lesson needs two ideas to make sense, the concept list is wrong.
