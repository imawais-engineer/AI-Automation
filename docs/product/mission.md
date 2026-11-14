# Mission

**Visual CS Lab — computer science, one concept at a time.**

Most learners meet algorithms twice: once as a wall of text and pseudocode, once as a video
that shows a shape moving without saying what the numbers mean. Both leave the same gap —
nothing connects the explanation to an execution you can check.

Visual CS Lab closes that gap by building every lesson from a **real run of the algorithm**:

1. The learner reads the concept in plain language and works through an example by hand.
2. The same input is executed by an implementation that already passes tests.
3. The resulting state changes become the lesson's step-by-step walkthrough and the short
   animation that closes it.
4. The animation is rendered from that same trace, so what a learner watches cannot drift from
   what the lesson claims.

## What the product is for

- **Learners** who want a structured path through data structures and algorithms, with
  practice and something visual to check their understanding against.
- **Educators and creators** who need to produce accurate short-form explanations without
  hand-animating each one — the Studio turns a verified trace into a branded MP4.

## Principles

| Principle | Consequence in the product |
| --- | --- |
| Truth over polish | A render is only publishable when the trace validated **and** the encoded file passed its quality gate |
| One source of truth | The lesson, the interactive animation and the video all read the same trace |
| Teaching first | The animation complements the tutorial; it never replaces the explanation, the worked example or the practice |
| Calm craft | One concept per lesson; content-driven timing; no filler beats to hit a duration |
| Earned complexity | No browser renderer, no ORM, no queue server — the smallest system that reliably produces correct videos |

## What it is not

- Not a video generator that invents content: inputs are constrained and verified before a
  frame is painted.
- Not a course marketplace: there is one roadmap, authored in the Studio, and it is curated.
- Not a real-time collaborative editor.
