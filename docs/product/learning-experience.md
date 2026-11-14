# Learning experience

## Entry points

| Route | What the learner gets |
| --- | --- |
| `/` | Hero with the current catalogue count and "continue learning", recent lessons |
| `/explore` | Every published concept, searchable and grouped by category |
| `/roadmaps` · `/roadmaps/:slug` | The curated path and its modules, in order |
| `/learn/:slug` | The lesson itself |
| `/my-learning` | Progress and bookmarks for the signed-in learner |
| `/settings` | Account and preferences |

Navigation is four items — Home, Explore, Roadmaps, My Learning — plus Studio for staff. The
public shell never shows production controls.

## Anatomy of a lesson

Each lesson is authored as ordered sections (they are data, `lesson_sections`, not code), and
the intended rhythm is:

1. **Concept in plain language** — the idea before the vocabulary.
2. **Intuition** — a mental model a reader can hold without symbols.
3. **Worked example** — a small, checkable case walked by hand.
4. **Step-by-step reasoning** — the same case, one state change at a time.
5. **Implementation** — reference code, with the language stated.
6. **Real execution output** — what the verified implementation actually produced.
7. **Complexity analysis** — time and space, when the topic has them.
8. **Practice** — questions from `quiz_questions`, answered in place.
9. **Visual demonstration** — the trace animation, and the rendered video where one exists.

The animation is deliberately last in the reading order: it is a check on the explanation, not a
substitute for it.

## The animation in the lesson

- Frames come from the lesson's stored storyboard, so the lesson and the video cannot disagree.
- The same trace drives the interactive animation and the MP4; the video adds branding, timing
  and narration, not different data.
- Captions are readable at the small end of the range: a 1080×1920 contrast regression test
  measures real painted frames per theme.

## Progress and bookmarks

Signed-in learners write progress and bookmarks (`POST /api/learn/progress`,
`POST /api/learn/bookmarks`). Anonymous visitors can read every published lesson; nothing
learner-specific is required to learn.

## What good looks like

- A first-time reader can explain the concept after section 3, without the animation.
- Every number a learner sees can be traced to the execution described in the lesson.
- A learner coming back a week later sees where they stopped and what they saved.
- Nothing on the page claims a video exists unless a validated render does.
