import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../../api';
import type { MyLearningPayload } from '../../learn';
import { useSession } from '../../session';

export default function MyLearning() {
  const { user, loading } = useSession();
  const [data, setData] = useState<MyLearningPayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    api<MyLearningPayload>('/api/learn/me')
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [user]);

  if (!loading && !user) {
    return (
      <div className="p-container">
        <div className="p-auth" style={{ marginTop: 80 }}>
          <div className="p-card">
            <span className="p-eyebrow">My learning</span>
            <h1 className="p-h2" style={{ marginTop: 8 }}>
              Sign in to track your progress
            </h1>
            <p className="p-lede" style={{ fontSize: 14, marginTop: 10 }}>
              Lessons and quizzes work without an account, but progress, saved lessons and roadmap position are stored on
              your account.
            </p>
            <div className="p-row" style={{ marginTop: 18 }}>
              <Link className="p-btn p-btn-primary" to="/sign-in">
                Sign in
              </Link>
              <Link className="p-btn" to="/sign-up">
                Create account
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-container">
      <header style={{ paddingTop: 40 }}>
        <span className="p-eyebrow">My learning</span>
        <h1 className="p-h1" style={{ fontSize: 'clamp(26px, 3.4vw, 38px)' }}>
          {user?.name ? `${user.name}'s progress` : 'Your progress'}
        </h1>
      </header>

      {error && <div className="p-error" style={{ marginTop: 20 }}>{error}</div>}

      {data && (
        <>
          <section className="p-section">
            <div className="p-section-head">
              <h2 className="p-h2">Continue learning</h2>
            </div>
            {data.inProgress.length === 0 ? (
              <div className="p-empty">
                <strong>Nothing in progress</strong>
                <span>
                  Open a lesson and it will appear here. <Link to="/explore">Explore concepts</Link>
                </span>
              </div>
            ) : (
              <div className="p-lesson-grid">
                {data.inProgress.map((item) => (
                  <Link className="p-lesson-card" key={item.slug} to={`/learn/${item.slug}`}>
                    <span className="p-badge accent">In progress</span>
                    <h3>{item.title}</h3>
                    <p>{item.summary}</p>
                    <div className="p-card-foot">
                      <span>Continue</span>
                      <span>→</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {data.roadmaps.length > 0 && (
            <section className="p-section">
              <div className="p-section-head">
                <h2 className="p-h2">Roadmap progress</h2>
                <Link className="p-btn p-btn-sm" to="/roadmaps">
                  All roadmaps
                </Link>
              </div>
              <div className="p-lesson-grid">
                {data.roadmaps.map((roadmap) => {
                  const percent = roadmap.total ? Math.round((roadmap.completed / roadmap.total) * 100) : 0;
                  return (
                    <div className="p-card" key={roadmap.slug}>
                      <div className="p-between">
                        <strong style={{ fontFamily: 'var(--p-display)' }}>{roadmap.title}</strong>
                        <span className="p-mono p-muted">
                          {roadmap.completed}/{roadmap.total}
                        </span>
                      </div>
                      <div className="p-progress-track" style={{ marginTop: 12 }}>
                        <span style={{ width: `${percent}%` }} />
                      </div>
                      <div className="p-row" style={{ marginTop: 14 }}>
                        {roadmap.next ? (
                          <Link className="p-btn p-btn-sm" to={`/learn/${roadmap.next.slug}`}>
                            Next: {roadmap.next.title}
                          </Link>
                        ) : (
                          <span className="p-badge good">Complete</span>
                        )}
                        <Link className="p-btn p-btn-sm" to={`/roadmaps/${roadmap.slug}`}>
                          Open
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="p-section">
            <div className="p-section-head">
              <h2 className="p-h2">Saved lessons</h2>
            </div>
            {data.saved.length === 0 ? (
              <div className="p-empty">
                <strong>No saved lessons</strong>
                <span>Use “Save lesson” on any lesson to keep it here.</span>
              </div>
            ) : (
              <div className="p-lesson-grid">
                {data.saved.map((item) => (
                  <Link className="p-lesson-card" key={item.slug} to={`/learn/${item.slug}`}>
                    <h3>{item.title}</h3>
                    <p>{item.summary}</p>
                    <div className="p-card-foot">
                      <span>Saved</span>
                      <span>→</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="p-section">
            <div className="p-section-head">
              <h2 className="p-h2">Completed</h2>
            </div>
            {data.completed.length === 0 ? (
              <div className="p-empty">
                <strong>No completed lessons yet</strong>
                <span>Mark a lesson complete to see it here.</span>
              </div>
            ) : (
              <div className="p-lesson-grid">
                {data.completed.map((item) => (
                  <Link className="p-lesson-card" key={item.slug} to={`/learn/${item.slug}`}>
                    <span className="p-badge good">Completed</span>
                    <h3>{item.title}</h3>
                    <p>{item.summary}</p>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
