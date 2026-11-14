import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { api } from '../../api';
import { difficultyLabel, type LearnedLesson } from '../../learn';
import { useSession } from '../../session';
import LessonContents, { type ContentsItem } from '../../components/public/LessonContents';
import RichText from '../../components/public/RichText';
import CodeExamples from '../../components/public/CodeExamples';
import KnowledgeCheck from '../../components/public/KnowledgeCheck';
import VisualDemonstration from '../../components/public/VisualDemonstration';

const KNOWN_KINDS = new Set(['concept', 'example', 'complexity', 'edge', 'recap']);

type Block = {
  id: string;
  /** The heading the learner reads on the page. */
  heading: string;
  /** The structural role, shown above the heading. */
  eyebrow: string;
  body: ReactNode;
};

/**
 * One tutorial page per lesson.
 *
 * The order is the teaching order: read the idea, follow the worked example,
 * study the implementation, check the cost, avoid the mistakes, answer the
 * questions, keep the takeaway — and only then, optionally, watch the short
 * animation that replays the same trace.
 */
export default function Learn() {
  const { slug = '' } = useParams();
  const { user } = useSession();
  const [data, setData] = useState<LearnedLesson | null>(null);
  const [error, setError] = useState('');
  const [bookmarked, setBookmarked] = useState(false);
  const [progressState, setProgressState] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api<LearnedLesson>(`/api/learn/lessons/${slug}`)
      .then((payload) => {
        setData(payload);
        setBookmarked(payload.bookmarked);
        setProgressState(payload.progress?.state || '');
      })
      .catch((err: Error) => setError(err.message));
  }, [slug, user?.id]);

  useEffect(() => {
    if (!data) return;
    document.title = `${data.lesson.title} · Visual CS Lab`;
    return () => {
      document.title = 'Visual CS Lab — DSA lessons into branded shorts';
    };
  }, [data]);

  const record = async (state: 'started' | 'completed') => {
    if (!data || data.guest) return;
    try {
      await api('/api/learn/progress', {
        method: 'POST',
        body: JSON.stringify({ lessonId: data.lesson.id, state, mode: 'tutorial' })
      });
      setProgressState(state);
    } catch {
      /* progress is best-effort; the lesson still works */
    }
  };

  // Opening the lesson is what starts it, now that there are no modes to switch.
  useEffect(() => {
    if (!data || data.guest || data.progress) return;
    void record('started');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.lesson.id]);

  const toggleBookmark = async () => {
    if (!data || data.guest) return;
    try {
      const result = await api<{ bookmarked: boolean }>('/api/learn/bookmarks', {
        method: 'POST',
        body: JSON.stringify({ lessonId: data.lesson.id })
      });
      setBookmarked(result.bookmarked);
    } catch {
      /* ignore */
    }
  };

  const blocks = useMemo<Block[]>(() => {
    if (!data) return [];
    const { lesson, concept, sections } = data;
    const of = (kind: string) => sections.filter((section) => section.kind === kind);
    const extra = sections.filter((section) => !KNOWN_KINDS.has(section.kind));
    const list: Block[] = [];

    // 1 — concept and intuition, then how it works
    of('concept').forEach((section, index) => {
      list.push({
        id: index === 0 ? 'concept' : index === 1 ? 'how-it-works' : `concept-${index + 1}`,
        heading: section.heading,
        eyebrow: index === 0 ? 'Concept and intuition' : 'How it works',
        body: <RichText body={section.body} />
      });
    });

    extra.forEach((section, index) => {
      list.push({
        id: `section-${index + 1}`,
        heading: section.heading,
        eyebrow: 'Background',
        body: <RichText body={section.body} />
      });
    });

    // 2 — worked example
    of('example').forEach((section, index) => {
      list.push({
        id: index === 0 ? 'worked-example' : `worked-example-${index + 1}`,
        heading: section.heading || 'Worked example',
        eyebrow: 'Worked example',
        body: <RichText body={section.body} />
      });
    });

    // 3 — implementation
    const hasImplementation = data.code.length > 0 || Boolean(concept.pseudocode);
    if (hasImplementation) {
      list.push({
        id: 'implementation',
        heading: 'Implementation',
        eyebrow: 'Implementation',
        body: (
          <>
            <p>
              The version below is the whole algorithm, with the printed output it produces. Read it after the trace
              above: each line should map onto a step you have already followed.
            </p>
            {concept.pseudocode && (
              <div className="p-pseudo">
                <span className="p-eyebrow">Algorithm</span>
                <pre>
                  <code>{concept.pseudocode}</code>
                </pre>
              </div>
            )}
            <CodeExamples examples={data.code} />
          </>
        )
      });
    }

    // 4 — complexity
    const complexity = of('complexity');
    const hasBound = Boolean(concept.complexityTime || concept.complexitySpace);
    if (complexity.length > 0 || hasBound) {
      list.push({
        id: 'complexity',
        heading: complexity[0]?.heading || 'Time and space',
        eyebrow: 'Complexity analysis',
        body:
          complexity.length > 0 ? (
            <>
              {complexity.map((section) => (
                <RichText body={section.body} key={section.id} />
              ))}
              <ComplexityTable time={concept.complexityTime} space={concept.complexitySpace} />
            </>
          ) : (
            <>
              <ComplexityTable time={concept.complexityTime} space={concept.complexitySpace} />
            </>
          )
      });
    }

    // 5 — common mistakes
    const mistakes = of('edge');
    if (mistakes.length > 0) {
      list.push({
        id: 'common-mistakes',
        heading: mistakes.length === 1 ? mistakes[0].heading : 'Common mistakes',
        eyebrow: 'Common mistakes',
        body: (
          <>
            {mistakes.map((section) => (
              <div key={section.id}>
                {mistakes.length > 1 && <h3>{section.heading}</h3>}
                <RichText body={section.body} />
              </div>
            ))}
          </>
        )
      });
    }

    // 6 — practice
    if (data.quiz.length > 0) {
      list.push({
        id: 'practice',
        heading: 'Check your understanding',
        eyebrow: 'Practice and knowledge check',
        body: (
          <>
            <p>
              Answer before scrolling on — the explanation after each choice tells you why it is right or wrong.
            </p>
            <KnowledgeCheck questions={data.quiz} />
          </>
        )
      });
    }

    // 7 — key takeaways
    const recap = of('recap');
    if (lesson.takeaway || recap.length > 0) {
      list.push({
        id: 'key-takeaways',
        heading: 'What to remember',
        eyebrow: 'Key takeaways',
        body: (
          <>
            {lesson.takeaway && <div className="p-callout">{lesson.takeaway}</div>}
            {recap.map((section) => (
              <RichText body={section.body} key={section.id} />
            ))}
          </>
        )
      });
    }

    // 8 — the optional demonstration, after everything the learner can do without it
    if (data.video) {
      list.push({
        id: 'demonstration',
        heading: 'Watch the algorithm in action',
        eyebrow: 'Visual demonstration',
        body: <VisualDemonstration lesson={data} />
      });
    }

    return list;
  }, [data]);

  if (error) {
    return (
      <div className="p-container" style={{ paddingTop: 48 }}>
        <div className="p-error">{error}</div>
        <div className="p-row" style={{ marginTop: 18 }}>
          <Link className="p-btn" to="/explore">
            Explore other concepts
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-container" style={{ paddingTop: 48 }}>
        <div className="p-card" style={{ height: 220, opacity: 0.5 }} />
      </div>
    );
  }

  const { lesson, roadmap } = data;
  const contents: ContentsItem[] = blocks.map((block) => ({ id: block.id, label: block.heading }));

  return (
    <div className="p-container p-tutorial">
      <nav className="p-crumbs" aria-label="Breadcrumb">
        <Link to="/explore">Explore</Link>
        <span>/</span>
        <Link to={`/explore?topic=${encodeURIComponent(lesson.category)}`}>{lesson.category}</Link>
      </nav>

      <header className="p-tutorial-head">
        <h1>{lesson.title}</h1>
        <p className="p-tutorial-summary">{lesson.summary}</p>

        <div className="p-tutorial-meta">
          <span className="p-badge">{difficultyLabel(lesson.difficulty)}</span>
          {lesson.prerequisites && <span className="p-tutorial-prereq">Requires: {lesson.prerequisites}</span>}
          {roadmap && (
            <span className="p-tutorial-roadmap">
              {roadmap.roadmapTitle} · lesson {roadmap.index + 1} of {roadmap.total}
            </span>
          )}
        </div>

        {lesson.objectives.length > 0 && (
          <div className="p-objectives">
            <span className="p-eyebrow" style={{ color: 'var(--p-accent)' }}>
              Learning objectives
            </span>
            <ul>
              {lesson.objectives.map((objective) => (
                <li key={objective}>{objective}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="p-tutorial-actions">
          <button className="p-btn p-btn-sm" onClick={() => void toggleBookmark()} disabled={data.guest}>
            {bookmarked ? '★ Saved' : '☆ Save lesson'}
          </button>
          <button
            className="p-btn p-btn-sm p-btn-primary"
            onClick={() => void record('completed')}
            disabled={data.guest || progressState === 'completed'}
          >
            {progressState === 'completed' ? '✓ Completed' : 'Mark complete'}
          </button>
          {data.guest && (
            <span className="p-tutorial-signin">
              <Link to="/sign-in">Sign in</Link> to save your progress
            </span>
          )}
        </div>
      </header>

      <div className="p-tutorial-body">
        <article className="p-tutorial-main">
          {blocks.map((block) => (
            <section className="p-tutorial-section" id={block.id} key={block.id}>
              <span className="p-eyebrow">{block.eyebrow}</span>
              <h2>{block.heading}</h2>
              {block.body}
            </section>
          ))}

          <nav className="p-tutorial-next" aria-label="Lesson navigation">
            {roadmap?.prev ? (
              <Link className="p-btn p-btn-sm" to={`/learn/${roadmap.prev.slug}`}>
                ← {roadmap.prev.title}
              </Link>
            ) : (
              <span />
            )}
            <div className="p-row">
              {roadmap && (
                <Link className="p-btn p-btn-sm" to={`/roadmaps/${roadmap.roadmapSlug}`}>
                  All of {roadmap.roadmapTitle}
                </Link>
              )}
              {roadmap?.next && (
                <Link className="p-btn p-btn-sm p-btn-primary" to={`/learn/${roadmap.next.slug}`}>
                  Next: {roadmap.next.title} →
                </Link>
              )}
            </div>
          </nav>
        </article>

        <aside className="p-tutorial-aside">
          <LessonContents items={contents} />
        </aside>
      </div>
    </div>
  );
}

function ComplexityTable({ time, space }: { time: string; space: string }) {
  if (!time && !space) return null;
  return (
    <dl className="p-complexity">
      {time && (
        <div>
          <dt>Time</dt>
          <dd>{time}</dd>
        </div>
      )}
      {space && (
        <div>
          <dt>Auxiliary space</dt>
          <dd>{space}</dd>
        </div>
      )}
    </dl>
  );
}
