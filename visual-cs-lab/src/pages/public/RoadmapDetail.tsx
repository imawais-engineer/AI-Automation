import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { api } from '../../api';
import { difficultyLabel, type RoadmapPayload } from '../../learn';
import { useSession } from '../../session';

const STATE_LABEL: Record<string, string> = {
  completed: '✓ Completed',
  'in-progress': 'In progress',
  available: 'Start',
  locked: 'Locked'
};

export default function RoadmapDetail() {
  const { slug = '' } = useParams();
  const { user } = useSession();
  const [data, setData] = useState<RoadmapPayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<RoadmapPayload>(`/api/learn/roadmaps/${slug}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [slug, user?.id]);

  if (error) {
    return (
      <div className="p-container" style={{ paddingTop: 40 }}>
        <div className="p-error">{error}</div>
        <Link className="p-btn" to="/roadmaps" style={{ marginTop: 16 }}>
          All roadmaps
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-container" style={{ paddingTop: 40 }}>
        <div className="p-card" style={{ height: 180, opacity: 0.5 }} />
      </div>
    );
  }

  const percent = data.total ? Math.round((data.completed / data.total) * 100) : 0;

  return (
    <div className="p-container">
      <header style={{ paddingTop: 40 }}>
        <span className="p-eyebrow">Roadmap</span>
        <h1 className="p-h1" style={{ fontSize: 'clamp(28px, 3.6vw, 42px)' }}>
          {data.roadmap.title}
        </h1>
        <p className="p-lede" style={{ marginTop: 12 }}>
          {data.roadmap.description}
        </p>
      </header>

      <div className="p-roadmap" style={{ marginTop: 32 }}>
        <aside>
          <div className="p-card">
            <span className="p-eyebrow">Progress</span>
            <div className="p-row" style={{ justifyContent: 'space-between', margin: '10px 0 8px' }}>
              <strong style={{ fontFamily: 'var(--p-display)', fontSize: 22 }}>
                {data.completed}/{data.total}
              </strong>
              <span className="p-mono p-muted">{percent}%</span>
            </div>
            <div className="p-progress-track">
              <span style={{ width: `${percent}%` }} />
            </div>
            {data.next ? (
              <Link className="p-btn p-btn-primary" to={`/learn/${data.next.slug}`} style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}>
                {data.completed === 0 ? 'Start' : 'Continue'}: {data.next.title}
              </Link>
            ) : (
              <div className="p-note" style={{ marginTop: 16 }}>
                Every lesson on this roadmap is complete.
              </div>
            )}
            {!user && (
              <p className="p-muted" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.55 }}>
                Progress is saved to your account. <Link to="/sign-in">Sign in</Link> to keep your place across devices.
              </p>
            )}
          </div>

          {data.roadmap.prerequisites && (
            <div className="p-card" style={{ marginTop: 14 }}>
              <span className="p-eyebrow">Before you start</span>
              <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--p-ink-soft)', margin: '8px 0 0' }}>
                {data.roadmap.prerequisites}
              </p>
            </div>
          )}

          {data.roadmap.outcomes && (
            <div className="p-card" style={{ marginTop: 14 }}>
              <span className="p-eyebrow">By the end</span>
              <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--p-ink-soft)', margin: '8px 0 0' }}>
                {data.roadmap.outcomes}
              </p>
            </div>
          )}
        </aside>

        <div>
          {data.modules.map((module, moduleIndex) => (
            <section className="p-module" key={module.id}>
              <div className="p-module-head">
                <span className="p-eyebrow">Module {moduleIndex + 1}</span>
                <h2 className="p-h3" style={{ marginTop: 6 }}>
                  {module.title}
                </h2>
                {module.summary && (
                  <p className="p-muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
                    {module.summary}
                  </p>
                )}
              </div>
              {module.lessons.map((lesson, index) => {
                const locked = lesson.state === 'locked';
                const content = (
                  <>
                    <span className="index">{String(index + 1).padStart(2, '0')}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 14 }}>{lesson.title}</strong>
                      <span className="p-muted" style={{ fontSize: 12 }}>
                        {difficultyLabel(lesson.difficulty)}
                      </span>
                    </span>
                    <span className={`state p-mono ${lesson.state === 'completed' ? 'p-badge good' : 'p-badge'}`} style={{ marginLeft: 'auto' }}>
                      {STATE_LABEL[lesson.state]}
                    </span>
                  </>
                );
                return locked ? (
                  <div className="p-lesson-row locked" key={lesson.id} title="Finish the previous lesson to unlock this one">
                    {content}
                  </div>
                ) : (
                  <Link className="p-lesson-row" key={lesson.id} to={`/learn/${lesson.slug}`}>
                    {content}
                  </Link>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
